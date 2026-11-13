"""Staff time clock: PIN punches from the shared device, timesheets with breaks and overtime, labour cost,
tip pooling and a payroll export."""
import csv
import io
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import Ctx, has_module, needs, require, tenant_user
from ..live import audit
from ..models import Order, Payment, Tenant, TimeBreak, TimeEntry, User, now
from ..security import verify_secret
from .pos import money, tenant_tz

router = APIRouter(tags=["timeclock"], dependencies=[Depends(needs("timeclock"))])

MISSED_AFTER = timedelta(hours=16)  # a shift longer than this almost always means a forgotten clock-out
OT_MULTIPLIER = Decimal("1.5")
ZERO = Decimal(0)
HOUR = Decimal(3600)


def hrs(v: Decimal | float) -> float:
    return float(Decimal(v).quantize(Decimal("0.01"), ROUND_HALF_UP))


def secs(td: timedelta) -> Decimal:
    return Decimal(max(0.0, td.total_seconds()))


def local_midnight(d: date, tz: ZoneInfo) -> datetime:
    return datetime.combine(d, time(0), tzinfo=tz)


def as_aware(dt: datetime, tz: ZoneInfo) -> datetime:
    """Times without an offset are read as the restaurant's local time."""
    return dt.replace(tzinfo=tz) if dt.tzinfo is None else dt


def fmt_local(dt: datetime | None, tz: ZoneInfo) -> str:
    if dt is None:
        return "open"
    return dt.astimezone(tz).strftime("%a %d %b %H:%M")


# ---------- Hours maths ----------

def entry_calc(e: TimeEntry, at: datetime, lo: datetime | None = None, hi: datetime | None = None) -> dict:
    """Worked time for one shift, optionally clipped to [lo, hi). Unpaid breaks are deducted; paid ones are not.

    An open shift counts up to now, but never more than MISSED_AFTER, so a forgotten clock-out
    doesn't run up labour cost until a manager fixes it."""
    start = e.clock_in
    end = e.clock_out or min(at, e.clock_in + MISSED_AFTER)
    if lo is not None:
        start = max(start, lo)
    if hi is not None:
        end = min(end, hi)
    gross = secs(end - start) if end > start else ZERO
    unpaid = paid = ZERO
    for b in e.breaks:
        bs, be = max(b.start, start), min(b.end or end, end)
        if be > bs:
            if b.paid:
                paid += secs(be - bs)
            else:
                unpaid += secs(be - bs)
    long_shift = (e.clock_out or at) - e.clock_in > MISSED_AFTER
    return {
        "gross": gross / HOUR, "unpaid_break": unpaid / HOUR, "paid_break": paid / HOUR,
        "worked": max(ZERO, gross - unpaid) / HOUR,
        # Open too long, or closed after a very long shift nobody has reviewed yet.
        "missed": long_shift and (e.clock_out is None or e.edited_at is None),
    }


def split_overtime(entries: list[TimeEntry], at: datetime, tz: ZoneInfo, daily: Decimal, weekly: Decimal) -> dict[str, dict]:
    """Walk one person's shifts in order and split each into regular and overtime hours.

    Daily overtime (hours past `daily` in a local day, when set) is counted first; the remaining regular
    hours then count toward the weekly threshold (Monday-start weeks). 0 turns either rule off."""
    out: dict[str, dict] = {}
    day_total: dict[date, Decimal] = {}
    week_regular: dict[date, Decimal] = {}
    for e in sorted(entries, key=lambda x: x.clock_in):
        c = entry_calc(e, at)
        h = c["worked"]
        d = e.clock_in.astimezone(tz).date()
        wk = d - timedelta(days=d.weekday())
        so_far = day_total.get(d, ZERO)
        reg = min(h, max(ZERO, daily - so_far)) if daily > 0 else h
        daily_ot = h - reg
        if weekly > 0:
            room = max(ZERO, weekly - week_regular.get(wk, ZERO))
            weekly_ot = max(ZERO, reg - room)
            reg -= weekly_ot
        else:
            weekly_ot = ZERO
        day_total[d] = so_far + h
        week_regular[wk] = week_regular.get(wk, ZERO) + reg
        rate = Decimal(e.hourly_rate or 0)
        ot = daily_ot + weekly_ot
        premium = rate * (OT_MULTIPLIER - 1) * ot
        out[e.id] = {**c, "regular": reg, "overtime": ot, "cost": rate * h + premium, "premium": premium}
    return out


# ---------- Shared lookups ----------

def open_entry(db: Session, tenant_id: str, user_id: str) -> TimeEntry | None:
    return db.scalar(select(TimeEntry).where(TimeEntry.tenant_id == tenant_id, TimeEntry.user_id == user_id,
                                             TimeEntry.clock_out.is_(None)).options(selectinload(TimeEntry.breaks)))


def open_break(e: TimeEntry | None) -> TimeBreak | None:
    return next((b for b in e.breaks if b.end is None), None) if e else None


def clock_in_required(db: Session, tenant: Tenant, u: User) -> None:
    """Called by /auth/pin: when the restaurant requires it, staff must be on the clock to use the POS."""
    if not has_module(tenant, "timeclock") or not tenant.require_clock_in or u.role in ("owner", "manager"):
        return
    if not open_entry(db, tenant.id, u.id):
        raise HTTPException(403, "You're not clocked in. Tap Clock in / out on this screen to start your shift.")


def hours_today(db: Session, ctx: Ctx, user_id: str, at: datetime) -> float:
    tz = tenant_tz(ctx.tenant)
    lo = local_midnight(at.astimezone(tz).date(), tz)
    rows = db.scalars(select(TimeEntry).where(
        TimeEntry.tenant_id == ctx.tenant_id, TimeEntry.user_id == user_id, TimeEntry.clock_in < lo + timedelta(days=1),
        (TimeEntry.clock_out.is_(None)) | (TimeEntry.clock_out > lo)).options(selectinload(TimeEntry.breaks))).all()
    return hrs(sum((entry_calc(e, at, lo, lo + timedelta(days=1))["worked"] for e in rows), ZERO))


def clock_state(e: TimeEntry | None) -> str:
    return "off" if e is None else ("break" if open_break(e) else "on")


# ---------- Punch clock (shared device) ----------

class PunchIn(BaseModel):
    user_id: str
    pin: str = Field(pattern=r"^\d{4}$")
    # status = verify the PIN and report where this person stands, without changing anything
    action: str = Field(pattern=r"^(in|out|break_start|break_end|status)$")


@router.post("/timeclock/punch")
def punch(body: PunchIn, ctx: Ctx = Depends(tenant_user), db: Session = Depends(get_db)):
    """Clock in/out or take a break with a PIN, from a device that holds a session for this restaurant.
    It does not sign the person in to the POS."""
    u = db.get(User, body.user_id)
    if not u or u.tenant_id != ctx.tenant_id or not u.is_active or not verify_secret(body.pin, u.pin_hash):
        raise HTTPException(403, "Wrong PIN")
    tz = tenant_tz(ctx.tenant)
    at = now()
    e = open_entry(db, ctx.tenant_id, u.id)
    b = open_break(e)
    if body.action == "in":
        if e:
            raise HTTPException(409, f"Already clocked in since {fmt_local(e.clock_in, tz)}")
        e = TimeEntry(tenant_id=ctx.tenant_id, user_id=u.id, clock_in=at, role=u.role,
                      hourly_rate=Decimal(u.hourly_rate or 0))
        db.add(e)
    elif body.action != "status" and not e:
        raise HTTPException(409, "You're not clocked in")
    elif body.action == "break_start":
        if b:
            raise HTTPException(409, "You're already on a break")
        e.breaks.append(TimeBreak(tenant_id=ctx.tenant_id, start=at, paid=False))
    elif body.action == "break_end":
        if not b:
            raise HTTPException(409, "You're not on a break")
        b.end = at
    elif body.action == "out":
        if b:
            b.end = at
        e.clock_out = at
    db.commit()
    e = open_entry(db, ctx.tenant_id, u.id)
    return {
        "user": {"id": u.id, "name": u.name, "role": u.role}, "action": body.action, "at": at.isoformat(),
        "status": clock_state(e), "since": e.clock_in.isoformat() if e else None,
        "break_since": b2.start.isoformat() if (b2 := open_break(e)) else None,
        "missed_clock_out": bool(e and at - e.clock_in > MISSED_AFTER),
        "hours_today": hours_today(db, ctx, u.id, at),
    }


@router.get("/timeclock/status")
def status(ctx: Ctx = Depends(tenant_user), db: Session = Depends(get_db)):
    """Who's on the clock right now, for the staff tiles on the lock screen."""
    staff = db.scalars(select(User).where(User.tenant_id == ctx.tenant_id, User.is_active, User.pin_hash.is_not(None))
                       .order_by(User.created_at)).all()
    opens = {e.user_id: e for e in db.scalars(select(TimeEntry).where(
        TimeEntry.tenant_id == ctx.tenant_id, TimeEntry.clock_out.is_(None)).options(selectinload(TimeEntry.breaks)))}
    at = now()
    out = []
    for u in staff:
        e = opens.get(u.id)
        b = open_break(e)
        out.append({"user_id": u.id, "name": u.name, "role": u.role, "status": clock_state(e),
                    "since": (b.start if b else e.clock_in).isoformat() if e else None,
                    "missed_clock_out": bool(e and at - e.clock_in > MISSED_AFTER)})
    return out


# ---------- Timesheets ----------

def period(ctx: Ctx, start: date | None, end: date | None) -> tuple[date, date]:
    today = datetime.now(tenant_tz(ctx.tenant)).date()
    start = start or today - timedelta(days=today.weekday())
    end = end or max(start, today if start <= today else start)
    if end < start:
        raise HTTPException(422, "End date is before start date")
    if (end - start).days > 92:
        raise HTTPException(422, "Pick a range of three months or less")
    return start, end


def net_sales(db: Session, ctx: Ctx, lo: datetime, hi: datetime) -> Decimal:
    """Sales after discounts and refunds, before tax and tips (same basis as the sales reports)."""
    total = ZERO
    for o in db.scalars(select(Order).where(Order.tenant_id == ctx.tenant_id, Order.status.in_(("paid", "refunded")),
                                            Order.closed_at >= lo, Order.closed_at < hi)):
        taxable = o.subtotal - o.discount_amount
        gross = taxable + o.tax + o.tip
        total += taxable - (o.refunded * taxable / gross if gross else 0)
    return total


def build_timesheet(db: Session, ctx: Ctx, start: date, end: date, user_id: str | None = None) -> dict:
    t = ctx.tenant
    tz = tenant_tz(t)
    at = now()
    lo, hi = local_midnight(start, tz), local_midnight(end + timedelta(days=1), tz)
    # Load from the Monday of the first week so weekly overtime counts hours worked before the range began.
    week_lo = local_midnight(start - timedelta(days=start.weekday()), tz)
    q = select(TimeEntry).where(TimeEntry.tenant_id == ctx.tenant_id, TimeEntry.clock_in >= week_lo, TimeEntry.clock_in < hi)
    if user_id:
        q = q.where(TimeEntry.user_id == user_id)
    entries = db.scalars(q.options(selectinload(TimeEntry.breaks)).order_by(TimeEntry.clock_in)).all()
    users = {u.id: u for u in db.scalars(select(User).where(User.tenant_id == ctx.tenant_id))}
    by_user: dict[str, list[TimeEntry]] = {}
    for e in entries:
        by_user.setdefault(e.user_id, []).append(e)

    pq = (select(Payment.user_id, func.coalesce(func.sum(Payment.tip), 0), func.coalesce(func.sum(Payment.amount), 0))
          .where(Payment.tenant_id == ctx.tenant_id, Payment.kind == "payment", Payment.created_at >= lo, Payment.created_at < hi)
          .group_by(Payment.user_id))
    tips = {uid: (Decimal(tip), Decimal(amt)) for uid, tip, amt in db.execute(pq).all()}

    daily, weekly = Decimal(t.ot_daily_hours or 0), Decimal(t.ot_weekly_hours or 0)
    rows = []
    tot = {k: ZERO for k in ("hours", "regular", "overtime", "break", "cost", "premium", "tips")}
    missed = 0
    for uid in sorted(set(by_user) | {k for k in tips if k and (not user_id or k == user_id)},
                      key=lambda k: (users[k].name.lower() if k in users else "")):
        u = users.get(uid)
        if not u:
            continue
        calc = split_overtime(by_user.get(uid, []), at, tz, daily, weekly)
        in_range = [e for e in by_user.get(uid, []) if e.clock_in >= lo]
        s = {k: ZERO for k in ("hours", "regular", "overtime", "break", "cost", "premium")}
        out_entries = []
        for e in in_range:
            c = calc[e.id]
            s["hours"] += c["worked"]
            s["regular"] += c["regular"]
            s["overtime"] += c["overtime"]
            s["break"] += c["unpaid_break"]
            s["cost"] += c["cost"]
            s["premium"] += c["premium"]
            missed += c["missed"]
            out_entries.append(entry_out(e, c, users))
        tip, sales = tips.get(uid, (ZERO, ZERO))
        for k in s:
            tot[k] += s[k]
        tot["tips"] += tip
        rows.append({
            "user_id": u.id, "name": u.name, "role": u.role, "hourly_rate": money(u.hourly_rate),
            "is_active": u.is_active, "on_clock": any(e.clock_out is None for e in by_user.get(uid, [])),
            "hours": hrs(s["hours"]), "regular_hours": hrs(s["regular"]), "overtime_hours": hrs(s["overtime"]),
            "break_hours": hrs(s["break"]), "labour_cost": money(s["cost"]), "ot_premium": money(s["premium"]),
            "tips": money(tip), "sales": money(sales),
            "sales_per_hour": money(sales / s["hours"]) if s["hours"] else 0,
            "missed_clock_outs": sum(1 for x in out_entries if x["missed_clock_out"]),
            "entries": out_entries,
        })
    net = net_sales(db, ctx, lo, hi)
    return {
        "start": start.isoformat(), "end": end.isoformat(), "timezone": t.timezone,
        "settings": settings_out(t),
        "net_sales": money(net),
        "labour_pct": hrs(tot["cost"] / net * 100) if net else None,
        "sales_per_labour_hour": money(net / tot["hours"]) if tot["hours"] else None,
        "missed_clock_outs": missed,
        "totals": {"hours": hrs(tot["hours"]), "regular_hours": hrs(tot["regular"]), "overtime_hours": hrs(tot["overtime"]),
                   "break_hours": hrs(tot["break"]), "labour_cost": money(tot["cost"]), "ot_premium": money(tot["premium"]),
                   "tips": money(tot["tips"])},
        "users": rows,
    }


def entry_out(e: TimeEntry, c: dict, users: dict[str, User]) -> dict:
    editor = users.get(e.edited_by) if e.edited_by else None
    return {
        "id": e.id, "user_id": e.user_id, "role": e.role, "hourly_rate": money(e.hourly_rate), "note": e.note,
        "clock_in": e.clock_in.isoformat(), "clock_out": e.clock_out.isoformat() if e.clock_out else None,
        "open": e.clock_out is None, "missed_clock_out": bool(c["missed"]),
        "hours": hrs(c["worked"]), "regular_hours": hrs(c.get("regular", c["worked"])),
        "overtime_hours": hrs(c.get("overtime", 0)), "break_hours": hrs(c["unpaid_break"]),
        "paid_break_hours": hrs(c["paid_break"]), "labour_cost": money(c.get("cost", 0)),
        "edited_by": editor.name if editor else None, "edited_at": e.edited_at.isoformat() if e.edited_at else None,
        "breaks": [{"id": b.id, "start": b.start.isoformat(), "end": b.end.isoformat() if b.end else None, "paid": b.paid}
                   for b in e.breaks],
    }


@router.get("/timesheets")
def timesheets(start: date | None = None, end: date | None = None, user_id: str | None = None,
               ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    start, end = period(ctx, start, end)
    return build_timesheet(db, ctx, start, end, user_id)


@router.get("/timesheets/export.csv")
def export_csv(start: date | None = None, end: date | None = None,
               ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    start, end = period(ctx, start, end)
    data = build_timesheet(db, ctx, start, end)
    buf = io.StringIO()
    w = csv.writer(buf)
    cur = ctx.tenant.currency
    w.writerow(["Name", "Role", f"Hourly rate ({cur})", "Regular hours", "Overtime hours", "Unpaid break hours",
                "Total hours", f"Labour cost ({cur})", f"Tips ({cur})"])
    for r in data["users"]:
        w.writerow([r["name"], r["role"], f'{r["hourly_rate"]:.2f}', f'{r["regular_hours"]:.2f}', f'{r["overtime_hours"]:.2f}',
                    f'{r["break_hours"]:.2f}', f'{r["hours"]:.2f}', f'{r["labour_cost"]:.2f}', f'{r["tips"]:.2f}'])
    tt = data["totals"]
    w.writerow(["Total", "", "", f'{tt["regular_hours"]:.2f}', f'{tt["overtime_hours"]:.2f}', f'{tt["break_hours"]:.2f}',
                f'{tt["hours"]:.2f}', f'{tt["labour_cost"]:.2f}', f'{tt["tips"]:.2f}'])
    name = f"timesheet_{start.isoformat()}_{end.isoformat()}.csv"
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/timesheets/tips")
def tips(start: date | None = None, end: date | None = None, mode: str = Query("individual", pattern=r"^(individual|pooled)$"),
         roles: str = "cashier,captain", ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    """Individual: tips as collected by whoever took the payment. Pooled: all tips in the period, shared by
    hours worked among the chosen roles (role at the time of the shift)."""
    start, end = period(ctx, start, end)
    tz = tenant_tz(ctx.tenant)
    lo, hi = local_midnight(start, tz), local_midnight(end + timedelta(days=1), tz)
    at = now()
    users = {u.id: u for u in db.scalars(select(User).where(User.tenant_id == ctx.tenant_id))}
    collected = dict(db.execute(
        select(Payment.user_id, func.coalesce(func.sum(Payment.tip), 0))
        .where(Payment.tenant_id == ctx.tenant_id, Payment.kind == "payment", Payment.created_at >= lo, Payment.created_at < hi)
        .group_by(Payment.user_id)).all())
    total = sum((Decimal(v) for v in collected.values()), ZERO)
    chosen = [r for r in (x.strip() for x in roles.split(",")) if r]
    hours: dict[str, Decimal] = {}
    for e in db.scalars(select(TimeEntry).where(TimeEntry.tenant_id == ctx.tenant_id, TimeEntry.clock_in >= lo,
                                                TimeEntry.clock_in < hi).options(selectinload(TimeEntry.breaks))):
        if mode == "individual" or e.role in chosen:
            hours[e.user_id] = hours.get(e.user_id, ZERO) + entry_calc(e, at)["worked"]
    pool_hours = sum(hours.values(), ZERO)
    ids = set(hours) | {k for k in collected if k}
    rows = []
    for uid in ids:
        u = users.get(uid)
        if not u:
            continue
        got = Decimal(collected.get(uid, 0))
        h = hours.get(uid, ZERO)
        share = got if mode == "individual" else (total * h / pool_hours if pool_hours else ZERO)
        if mode == "pooled" and not h and not got:
            continue
        rows.append({"user_id": uid, "name": u.name, "role": u.role, "hours": hrs(h), "collected": money(got),
                     "share": money(share), "eligible": mode == "individual" or h > 0})
    rows.sort(key=lambda r: (-r["share"], r["name"].lower()))
    unassigned = Decimal(collected.get(None, 0))
    return {"start": start.isoformat(), "end": end.isoformat(), "mode": mode, "roles": chosen,
            "total_tips": money(total), "pool_hours": hrs(pool_hours),
            # Individual mode: tips on payments with no staff member attached aren't anyone's.
            "unassigned": money(unassigned if mode == "individual" else (ZERO if pool_hours else total)),
            "rows": rows}


# ---------- Manager edits ----------

def own_entry(db: Session, ctx: Ctx, eid: str) -> TimeEntry:
    e = db.scalar(select(TimeEntry).where(TimeEntry.id == eid, TimeEntry.tenant_id == ctx.tenant_id)
                  .options(selectinload(TimeEntry.breaks)))
    if not e:
        raise HTTPException(404, "Time entry not found")
    return e


def check_window(db: Session, ctx: Ctx, user_id: str, cin: datetime, cout: datetime | None, skip: str | None = None) -> None:
    if cout is not None and cout <= cin:
        raise HTTPException(422, "Clock-out must be after clock-in")
    if cin > now() + timedelta(minutes=5):
        raise HTTPException(422, "Clock-in can't be in the future")
    q = select(TimeEntry.id).where(TimeEntry.tenant_id == ctx.tenant_id, TimeEntry.user_id == user_id,
                                   (TimeEntry.clock_out.is_(None)) | (TimeEntry.clock_out > cin))
    if cout is not None:
        q = q.where(TimeEntry.clock_in < cout)
    if skip:
        q = q.where(TimeEntry.id != skip)
    if db.scalar(q.limit(1)):
        raise HTTPException(409, "This overlaps another shift for the same person")


def touch(e: TimeEntry, ctx: Ctx) -> None:
    e.edited_by, e.edited_at = ctx.user.id, now()


def who(db: Session, e: TimeEntry) -> str:
    u = db.get(User, e.user_id)
    return u.name if u else "Staff"


class BreakIn(BaseModel):
    start: datetime
    end: datetime | None = None
    paid: bool = False


class EntryIn(BaseModel):
    user_id: str
    clock_in: datetime
    clock_out: datetime | None = None
    note: str = Field(default="", max_length=200)
    breaks: list[BreakIn] = []


def check_break(e: TimeEntry, bs: datetime, be: datetime | None, skip: TimeBreak | None = None) -> None:
    if be is not None and be <= bs:
        raise HTTPException(422, "A break must end after it starts")
    if bs < e.clock_in or (e.clock_out and (bs >= e.clock_out or (be or e.clock_out) > e.clock_out)):
        raise HTTPException(422, "Breaks must fall inside the shift")
    if be is None and e.clock_out is not None:
        raise HTTPException(422, "Give the break an end time (the shift is closed)")
    for b in e.breaks:
        if b is skip:
            continue
        if bs < (b.end or datetime.max.replace(tzinfo=bs.tzinfo)) and (be is None or be > b.start):
            raise HTTPException(409, "Breaks can't overlap")


@router.post("/timesheets/entries", status_code=201)
def add_entry(body: EntryIn, ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    u = db.get(User, body.user_id)
    if not u or u.tenant_id != ctx.tenant_id:
        raise HTTPException(404, "Staff member not found")
    cin = as_aware(body.clock_in, tz)
    cout = as_aware(body.clock_out, tz) if body.clock_out else None
    check_window(db, ctx, u.id, cin, cout)
    e = TimeEntry(tenant_id=ctx.tenant_id, user_id=u.id, clock_in=cin, clock_out=cout, role=u.role,
                  hourly_rate=Decimal(u.hourly_rate or 0), note=body.note.strip())
    touch(e, ctx)
    db.add(e)
    for b in body.breaks:
        bs, be = as_aware(b.start, tz), as_aware(b.end, tz) if b.end else None
        check_break(e, bs, be)
        e.breaks.append(TimeBreak(tenant_id=ctx.tenant_id, start=bs, end=be, paid=b.paid))
    audit(db, ctx, "time_added", detail=f"{u.name}: {fmt_local(cin, tz)} → {fmt_local(cout, tz)}")
    db.commit()
    return entry_out(e, entry_calc(e, now()), {ctx.user.id: ctx.user})


class EntryPatch(BaseModel):
    clock_in: datetime | None = None
    clock_out: datetime | None = None
    reopen: bool = False  # clear the clock-out (put the person back on the clock)
    note: str | None = Field(default=None, max_length=200)
    hourly_rate: float | None = Field(default=None, ge=0, le=100000)


@router.patch("/timesheets/entries/{eid}")
def edit_entry(eid: str, body: EntryPatch, ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    e = own_entry(db, ctx, eid)
    cin = as_aware(body.clock_in, tz) if body.clock_in else e.clock_in
    cout = None if body.reopen else (as_aware(body.clock_out, tz) if body.clock_out else e.clock_out)
    check_window(db, ctx, e.user_id, cin, cout, skip=e.id)
    changes = []
    if cin != e.clock_in:
        changes.append(f"in {fmt_local(e.clock_in, tz)} → {fmt_local(cin, tz)}")
    if cout != e.clock_out:
        changes.append(f"out {fmt_local(e.clock_out, tz)} → {fmt_local(cout, tz)}")
    if body.hourly_rate is not None and Decimal(str(body.hourly_rate)).quantize(Decimal("0.01")) != e.hourly_rate:
        changes.append(f"rate {money(e.hourly_rate):g} → {body.hourly_rate:g}")
        e.hourly_rate = Decimal(str(body.hourly_rate))
    if body.note is not None and body.note.strip() != e.note:
        changes.append("note")
        e.note = body.note.strip()
    e.clock_in, e.clock_out = cin, cout
    if cout is not None:
        for b in e.breaks:  # keep breaks inside the shift
            if b.end is None or b.end > cout:
                b.end = max(b.start, cout)
    if changes:
        touch(e, ctx)
        audit(db, ctx, "time_edited", detail=f"{who(db, e)}: " + ", ".join(changes))
    db.commit()
    return entry_out(e, entry_calc(e, now()), {ctx.user.id: ctx.user})


@router.delete("/timesheets/entries/{eid}")
def delete_entry(eid: str, ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    e = own_entry(db, ctx, eid)
    audit(db, ctx, "time_deleted", detail=f"{who(db, e)}: {fmt_local(e.clock_in, tz)} → {fmt_local(e.clock_out, tz)}")
    db.delete(e)
    db.commit()
    return {"ok": True}


@router.post("/timesheets/entries/{eid}/breaks", status_code=201)
def add_break(eid: str, body: BreakIn, ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    e = own_entry(db, ctx, eid)
    bs, be = as_aware(body.start, tz), as_aware(body.end, tz) if body.end else None
    check_break(e, bs, be)
    e.breaks.append(TimeBreak(tenant_id=ctx.tenant_id, start=bs, end=be, paid=body.paid))
    touch(e, ctx)
    audit(db, ctx, "break_added", detail=f"{who(db, e)}: {'paid' if body.paid else 'unpaid'} break "
                                         f"{fmt_local(bs, tz)} → {fmt_local(be, tz)}")
    db.commit()
    return entry_out(e, entry_calc(e, now()), {ctx.user.id: ctx.user})


def own_break(db: Session, ctx: Ctx, bid: str) -> tuple[TimeEntry, TimeBreak]:
    b = db.scalar(select(TimeBreak).where(TimeBreak.id == bid, TimeBreak.tenant_id == ctx.tenant_id))
    if not b:
        raise HTTPException(404, "Break not found")
    e = own_entry(db, ctx, b.entry_id)
    return e, next(x for x in e.breaks if x.id == bid)


class BreakPatch(BaseModel):
    start: datetime | None = None
    end: datetime | None = None
    paid: bool | None = None


@router.patch("/timesheets/breaks/{bid}")
def edit_break(bid: str, body: BreakPatch, ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    e, b = own_break(db, ctx, bid)
    bs = as_aware(body.start, tz) if body.start else b.start
    be = as_aware(body.end, tz) if body.end else b.end
    check_break(e, bs, be, skip=b)
    changes = []
    if bs != b.start or be != b.end:
        changes.append(f"{fmt_local(b.start, tz)}–{fmt_local(b.end, tz)} → {fmt_local(bs, tz)}–{fmt_local(be, tz)}")
    if body.paid is not None and body.paid != b.paid:
        changes.append("paid" if body.paid else "unpaid")
        b.paid = body.paid
    b.start, b.end = bs, be
    if changes:
        touch(e, ctx)
        audit(db, ctx, "break_edited", detail=f"{who(db, e)}: break " + ", ".join(changes))
    db.commit()
    return entry_out(e, entry_calc(e, now()), {ctx.user.id: ctx.user})


@router.delete("/timesheets/breaks/{bid}")
def delete_break(bid: str, ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    e, b = own_break(db, ctx, bid)
    audit(db, ctx, "break_deleted", detail=f"{who(db, e)}: break {fmt_local(b.start, tz)} → {fmt_local(b.end, tz)}")
    e.breaks.remove(b)
    touch(e, ctx)
    db.commit()
    return entry_out(e, entry_calc(e, now()), {ctx.user.id: ctx.user})


# ---------- Settings ----------

def settings_out(t: Tenant) -> dict:
    return {"require_clock_in": bool(t.require_clock_in), "ot_daily_hours": float(t.ot_daily_hours or 0),
            "ot_weekly_hours": float(t.ot_weekly_hours or 0), "ot_multiplier": float(OT_MULTIPLIER)}


class ClockSettingsIn(BaseModel):
    require_clock_in: bool | None = None
    ot_daily_hours: float | None = Field(default=None, ge=0, le=24)
    ot_weekly_hours: float | None = Field(default=None, ge=0, le=168)


@router.get("/timesheets/settings")
def get_clock_settings(ctx: Ctx = Depends(require("timesheets"))):
    return settings_out(ctx.tenant)


@router.patch("/timesheets/settings")
def update_clock_settings(body: ClockSettingsIn, ctx: Ctx = Depends(require("timesheets")), db: Session = Depends(get_db)):
    t = ctx.tenant
    before = settings_out(t)
    if body.require_clock_in is not None:
        t.require_clock_in = body.require_clock_in
    if body.ot_daily_hours is not None:
        t.ot_daily_hours = Decimal(str(body.ot_daily_hours)).quantize(Decimal("0.1"))
    if body.ot_weekly_hours is not None:
        t.ot_weekly_hours = Decimal(str(body.ot_weekly_hours)).quantize(Decimal("0.1"))
    after = settings_out(t)
    diff = [f"{k}: {before[k]} → {after[k]}" for k in after if before[k] != after[k]]
    if diff:
        audit(db, ctx, "timeclock_settings", detail=", ".join(diff))
    db.commit()
    return after
