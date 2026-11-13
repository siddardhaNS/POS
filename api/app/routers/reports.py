"""Reports: sales overview, item mix, channels & payments, staff, exceptions, tax, end of day and CSV export.

Every aggregation takes a list of tenant ids plus a Period (dates + time zone) so the same functions can
build consolidated multi-location reports. Endpoints pass [ctx.tenant_id] and the restaurant's time zone.

Definitions (shared by every report):
- A sale is a check with status paid or refunded, recognised on its close time in the restaurant's time zone.
- Gross sales = menu value of every line, comped lines included (unit price already includes modifiers).
- Comps = value of comped lines. Discounts = check-level discounts.
- Net sales = gross - comps - discounts (= subtotal - discount), before tax and tips.
- Refunds and total collected come from the payments ledger, dated when the money moved.
"""
import csv
import io
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import Ctx, require
from ..models import AuditLog, CashSession, DiningTable, MenuCategory, MenuItem, Order, OrderItem, Payment, User
from .cash import summarize as summarize_drawer
from .pos import money, tenant_tz

router = APIRouter(tags=["reports"])

SALE_STATUSES = ("paid", "refunded")
EXCEPTION_ACTIONS = ("discount", "comp", "void", "refund", "item_removed", "reopen")
MAX_DAYS = 731
ZERO = Decimal(0)


@dataclass(frozen=True)
class Period:
    """Inclusive local dates [start, end] in time zone `tz`."""
    start: date
    end: date
    tz: str = "UTC"

    @property
    def zone(self) -> ZoneInfo:
        try:
            return ZoneInfo(self.tz)
        except Exception:
            return ZoneInfo("UTC")

    @property
    def start_at(self) -> datetime:
        return datetime(self.start.year, self.start.month, self.start.day, tzinfo=self.zone)

    @property
    def end_at(self) -> datetime:
        """Exclusive upper bound: local midnight after `end`."""
        e = self.end + timedelta(days=1)
        return datetime(e.year, e.month, e.day, tzinfo=self.zone)

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def previous(self) -> "Period":
        """The equal-length period right before this one."""
        return Period(self.start - timedelta(days=self.days), self.start - timedelta(days=1), self.tz)

    def out(self) -> dict:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(), "days": self.days, "tz": self.tz}


def _sum(col):
    return func.coalesce(func.sum(col), 0)


def _local(col, p: Period):
    """timestamptz -> restaurant-local timestamp (Postgres AT TIME ZONE)."""
    return func.timezone(p.tz, col)


def _sales(tenant_ids: list[str], p: Period):
    return and_(Order.tenant_id.in_(tenant_ids), Order.status.in_(SALE_STATUSES),
                Order.closed_at >= p.start_at, Order.closed_at < p.end_at)


NET = Order.subtotal - Order.discount_amount
LINE = OrderItem.unit_price * OrderItem.qty
COMPED = OrderItem.comp_reason != ""


def _div(a, b) -> float:
    return money(Decimal(a) / Decimal(b)) if b else 0.0


def _pct(a, b) -> float:
    return round(float(a) / float(b) * 100, 1) if b else 0.0


# ---------- Sales overview ----------

def sales_overview(db: Session, tenant_ids: list[str], p: Period) -> dict:
    """Headline totals for the period."""
    r = db.execute(select(
        func.count(Order.id), _sum(Order.subtotal), _sum(Order.discount_amount), _sum(Order.tax), _sum(Order.tip),
        _sum(Order.guests), _sum(case((Order.guests > 0, NET), else_=0)),
    ).where(_sales(tenant_ids, p))).one()
    orders, subtotal, discounts, tax, tips, guests, guest_net = r
    comps = db.scalar(select(_sum(LINE)).join(Order, Order.id == OrderItem.order_id)
                      .where(_sales(tenant_ids, p), COMPED)) or ZERO
    pay = {k: (a, t, n) for k, a, t, n in db.execute(
        select(Payment.kind, _sum(Payment.amount), _sum(Payment.tip), func.count(Payment.id))
        .where(Payment.tenant_id.in_(tenant_ids), Payment.created_at >= p.start_at, Payment.created_at < p.end_at)
        .group_by(Payment.kind))}
    paid_amt, paid_tip, _ = pay.get("payment", (ZERO, ZERO, 0))
    refunds, _, refund_count = pay.get("refund", (ZERO, ZERO, 0))
    net = Decimal(subtotal) - Decimal(discounts)
    return {
        "gross_sales": money(Decimal(subtotal) + Decimal(comps)), "comps": money(comps), "discounts": money(discounts),
        "net_sales": money(net), "tax": money(tax), "tips": money(tips), "refunds": money(refunds),
        "refund_count": refund_count, "total_collected": money(Decimal(paid_amt) + Decimal(paid_tip) - Decimal(refunds)),
        "orders": orders, "avg_check": _div(net, orders), "guests": int(guests or 0),
        "per_guest": _div(guest_net, guests),
    }


def sales_by_day(db: Session, tenant_ids: list[str], p: Period) -> list[dict]:
    """One row per local day (gap days included as zero)."""
    day = func.date(_local(Order.closed_at, p))
    rows = {d: r for d, *r in db.execute(
        select(day, func.count(Order.id), _sum(Order.subtotal), _sum(Order.discount_amount), _sum(Order.tax),
               _sum(Order.tip), _sum(Order.guests))
        .where(_sales(tenant_ids, p)).group_by(day))}
    comp_rows = dict(db.execute(select(day, _sum(LINE)).join(Order, Order.id == OrderItem.order_id)
                                .where(_sales(tenant_ids, p), COMPED).group_by(day)).all())
    pday = func.date(_local(Payment.created_at, p))
    refunds = dict(db.execute(select(pday, _sum(Payment.amount)).where(
        Payment.tenant_id.in_(tenant_ids), Payment.kind == "refund",
        Payment.created_at >= p.start_at, Payment.created_at < p.end_at).group_by(pday)).all())
    out = []
    for i in range(p.days):
        d = p.start + timedelta(days=i)
        n, sub, disc, tax, tip, guests = rows.get(d, (0, ZERO, ZERO, ZERO, ZERO, 0))
        comps = comp_rows.get(d, ZERO)
        net = Decimal(sub) - Decimal(disc)
        out.append({"date": d.isoformat(), "orders": n, "gross_sales": money(Decimal(sub) + Decimal(comps)),
                    "comps": money(comps), "discounts": money(disc), "net_sales": money(net), "tax": money(tax),
                    "tips": money(tip), "refunds": money(refunds.get(d, ZERO)), "guests": int(guests or 0),
                    "avg_check": _div(net, n)})
    return out


def sales_heatmap(db: Session, tenant_ids: list[str], p: Period) -> dict:
    """Net sales and check counts by weekday (0 = Monday) x hour of day (0-23), by close time."""
    local = _local(Order.closed_at, p)
    dow, hour = func.extract("isodow", local), func.extract("hour", local)
    net = [[0.0] * 24 for _ in range(7)]
    orders = [[0] * 24 for _ in range(7)]
    for d, h, n, v in db.execute(select(dow, hour, func.count(Order.id), _sum(NET))
                                 .where(_sales(tenant_ids, p)).group_by(dow, hour)):
        net[int(d) - 1][int(h)] = money(v)
        orders[int(d) - 1][int(h)] = n
    return {"net": net, "orders": orders}


# ---------- Item & category mix ----------

def item_mix(db: Session, tenant_ids: list[str], p: Period, limit: int = 10) -> dict:
    """Per item: qty, gross, comps and net (check discounts spread across lines pro rata); categories; modifiers."""
    share = case((Order.subtotal > 0, 1 - Order.discount_amount / Order.subtotal), else_=0)
    line_net = case((COMPED, 0), else_=LINE * share)
    cat = func.coalesce(MenuCategory.name, "Uncategorised")
    rows = db.execute(
        select(OrderItem.menu_item_id, OrderItem.name, cat, _sum(OrderItem.qty),
               _sum(case((COMPED, OrderItem.qty), else_=0)), _sum(LINE), _sum(case((COMPED, LINE), else_=0)),
               _sum(line_net), func.count(func.distinct(OrderItem.order_id)))
        .join(Order, Order.id == OrderItem.order_id)
        .outerjoin(MenuItem, MenuItem.id == OrderItem.menu_item_id)
        .outerjoin(MenuCategory, MenuCategory.id == MenuItem.category_id)
        .where(_sales(tenant_ids, p))
        .group_by(OrderItem.menu_item_id, OrderItem.name, cat)).all()
    total_net = sum((Decimal(r[7]) for r in rows), ZERO)
    total_qty = sum((int(r[3]) for r in rows), 0)
    items = [{"menu_item_id": mid, "name": name, "category": c, "qty": int(qty), "comp_qty": int(cq),
              "gross_sales": money(gross), "comps": money(comps), "net_sales": money(net), "orders": n,
              "avg_price": _div(Decimal(gross) - Decimal(comps), int(qty) - int(cq)),
              "pct_sales": _pct(net, total_net), "pct_qty": _pct(qty, total_qty)}
             for mid, name, c, qty, cq, gross, comps, net, n in rows]
    items.sort(key=lambda i: (-i["net_sales"], -i["qty"], i["name"]))
    cats: dict[str, dict] = {}
    for i in items:
        c = cats.setdefault(i["category"], {"category": i["category"], "items": 0, "qty": 0, "gross_sales": 0.0,
                                            "comps": 0.0, "net_sales": 0.0})
        c["items"] += 1
        c["qty"] += i["qty"]
        for k in ("gross_sales", "comps", "net_sales"):
            c[k] = round(c[k] + i[k], 2)
    categories = sorted(cats.values(), key=lambda c: -c["net_sales"])
    for c in categories:
        c["pct_sales"] = _pct(c["net_sales"], total_net)

    mods: dict[tuple[str, str], dict] = {}
    for m_list, qty in db.execute(
            select(OrderItem.modifiers, OrderItem.qty).join(Order, Order.id == OrderItem.order_id)
            .where(_sales(tenant_ids, p), func.json_array_length(OrderItem.modifiers) > 0)):
        for m in m_list or []:
            key = (str(m.get("group", "")), str(m.get("name", "")))
            row = mods.setdefault(key, {"group": key[0], "name": key[1], "qty": 0, "revenue": 0.0})
            row["qty"] += qty
            row["revenue"] = round(row["revenue"] + float(m.get("price") or 0) * qty, 2)
    by_qty = sorted(items, key=lambda i: (-i["qty"], -i["net_sales"]))
    return {"total_net": money(total_net), "total_qty": total_qty, "items": items, "categories": categories,
            "top": by_qty[:limit], "bottom": list(reversed(by_qty[-limit:])) if len(by_qty) > limit else [],
            "modifiers": sorted(mods.values(), key=lambda m: (-m["qty"], m["group"], m["name"]))}


# ---------- Channels & payments ----------

def channel_mix(db: Session, tenant_ids: list[str], p: Period) -> list[dict]:
    rows = db.execute(select(Order.channel, func.count(Order.id), _sum(NET), _sum(Order.guests), _sum(Order.tip))
                      .where(_sales(tenant_ids, p)).group_by(Order.channel)).all()
    total = sum((Decimal(r[2]) for r in rows), ZERO)
    out = [{"channel": ch, "orders": n, "net_sales": money(net), "guests": int(g or 0), "tips": money(tip),
            "avg_check": _div(net, n), "pct_sales": _pct(net, total)} for ch, n, net, g, tip in rows]
    return sorted(out, key=lambda r: -r["net_sales"])


def payment_methods(db: Session, tenant_ids: list[str], p: Period) -> list[dict]:
    """Per tender: payments taken, tips, refunds given back and the net collected (dated by the payment)."""
    rows = db.execute(
        select(Payment.method, Payment.kind, func.count(Payment.id), _sum(Payment.amount), _sum(Payment.tip))
        .where(Payment.tenant_id.in_(tenant_ids), Payment.created_at >= p.start_at, Payment.created_at < p.end_at)
        .group_by(Payment.method, Payment.kind)).all()
    by: dict[str, dict] = {}
    for method, kind, n, amt, tip in rows:
        r = by.setdefault(method, {"method": method, "count": 0, "amount": 0.0, "tips": 0.0, "refund_count": 0,
                                   "refunds": 0.0})
        if kind == "refund":
            r["refund_count"], r["refunds"] = n, money(amt)
        else:
            r["count"], r["amount"], r["tips"] = n, money(amt), money(tip)
    total = sum(r["amount"] + r["tips"] - r["refunds"] for r in by.values())
    for r in by.values():
        r["net"] = round(r["amount"] + r["tips"] - r["refunds"], 2)
        r["pct"] = _pct(r["net"], total)
    return sorted(by.values(), key=lambda r: -r["net"])


# ---------- Staff ----------

def staff_performance(db: Session, tenant_ids: list[str], p: Period) -> list[dict]:
    """Per user: checks opened (server), what they rang up, tips, payments they took and exceptions they made."""
    names = {u.id: (u.name, u.role) for u in db.scalars(select(User).where(User.tenant_id.in_(tenant_ids)))}
    staff: dict[str | None, dict] = {}

    def row(uid: str | None) -> dict:
        if uid not in staff:
            name, role = names.get(uid, ("Online / unassigned" if uid is None else "Former staff", ""))
            staff[uid] = {"user_id": uid, "name": name, "role": role, "orders": 0, "guests": 0, "net_sales": 0.0,
                          "avg_check": 0.0, "tips": 0.0, "payments": 0, "collected": 0.0, "discount_count": 0,
                          "discounts": 0.0, "comp_count": 0, "comps": 0.0, "void_count": 0, "voids": 0.0,
                          "refund_count": 0, "refunds": 0.0}
        return staff[uid]

    for uid, n, net, g, tip in db.execute(
            select(Order.opened_by, func.count(Order.id), _sum(NET), _sum(Order.guests), _sum(Order.tip))
            .where(_sales(tenant_ids, p)).group_by(Order.opened_by)):
        r = row(uid)
        r.update(orders=n, net_sales=money(net), guests=int(g or 0), tips=money(tip), avg_check=_div(net, n))
    for uid, n, amt in db.execute(
            select(Payment.user_id, func.count(Payment.id), _sum(Payment.amount + Payment.tip))
            .where(Payment.tenant_id.in_(tenant_ids), Payment.kind == "payment",
                   Payment.created_at >= p.start_at, Payment.created_at < p.end_at).group_by(Payment.user_id)):
        r = row(uid)
        r.update(payments=n, collected=money(amt))
    for uid, action, n, amt in db.execute(
            select(AuditLog.user_id, AuditLog.action, func.count(AuditLog.id), _sum(AuditLog.amount))
            .where(AuditLog.tenant_id.in_(tenant_ids), AuditLog.action.in_(("discount", "comp", "void", "refund")),
                   AuditLog.created_at >= p.start_at, AuditLog.created_at < p.end_at)
            .group_by(AuditLog.user_id, AuditLog.action)):
        r = row(uid)
        r[f"{action}_count"], r[f"{action}s"] = n, money(amt)
    return sorted(staff.values(), key=lambda r: (-r["net_sales"], -r["collected"], r["name"]))


# ---------- Exceptions ----------

def exceptions(db: Session, tenant_ids: list[str], p: Period, limit: int = 1000) -> dict:
    """Discounts, comps, voids, refunds, removed items and reopened checks: who, when, how much, why."""
    where = and_(AuditLog.tenant_id.in_(tenant_ids), AuditLog.action.in_(EXCEPTION_ACTIONS),
                 AuditLog.created_at >= p.start_at, AuditLog.created_at < p.end_at)
    summary = {a: {"count": 0, "amount": 0.0} for a in EXCEPTION_ACTIONS}
    for action, n, amt in db.execute(select(AuditLog.action, func.count(AuditLog.id), _sum(AuditLog.amount))
                                     .where(where).group_by(AuditLog.action)):
        summary[action] = {"count": n, "amount": money(amt)}
    rows = db.scalars(select(AuditLog).where(where).order_by(AuditLog.created_at.desc()).limit(limit)).all()
    return {"summary": summary, "rows": [
        {"id": a.id, "action": a.action, "user": a.user_name, "order_id": a.order_id, "order_number": a.order_number,
         "detail": a.detail, "amount": money(a.amount) if a.amount is not None else None,
         "created_at": a.created_at.isoformat()} for a in rows]}


# ---------- Tax ----------

def tax_report(db: Session, tenant_ids: list[str], p: Period) -> dict:
    days = [{"date": d["date"], "orders": d["orders"], "taxable": d["net_sales"], "tax": d["tax"]}
            for d in sales_by_day(db, tenant_ids, p)]
    taxable, tax = sum(d["taxable"] for d in days), sum(d["tax"] for d in days)
    return {"taxable": round(taxable, 2), "tax": round(tax, 2),
            "effective_rate": round(tax / taxable * 100, 3) if taxable else 0.0, "days": days}


# ---------- Orders (for CSV and the end-of-day list) ----------

def order_rows(db: Session, tenant_ids: list[str], p: Period) -> list[dict]:
    """Every check closed in the period (sales, voids and rejections; merged checks are skipped)."""
    names = {u.id: u.name for u in db.scalars(select(User).where(User.tenant_id.in_(tenant_ids)))}
    orders = db.execute(
        select(Order, DiningTable.name).outerjoin(DiningTable, DiningTable.id == Order.table_id)
        .where(Order.tenant_id.in_(tenant_ids), Order.status.in_(SALE_STATUSES + ("void", "rejected")),
               Order.closed_at >= p.start_at, Order.closed_at < p.end_at).order_by(Order.closed_at)).all()
    z = p.zone
    return [{"number": o.number, "opened_at": o.opened_at.astimezone(z).strftime("%Y-%m-%d %H:%M"),
             "closed_at": o.closed_at.astimezone(z).strftime("%Y-%m-%d %H:%M"), "channel": o.channel,
             "table": table or "", "status": o.status, "guests": o.guests, "server": names.get(o.opened_by, ""),
             "subtotal": money(o.subtotal), "discount": money(o.discount_amount), "discount_reason": o.discount_reason,
             "tax": money(o.tax), "tip": money(o.tip), "total": money(o.total), "paid": money(o.paid),
             "refunded": money(o.refunded), "payment_method": o.payment_method, "void_reason": o.void_reason}
            for o, table in orders]


# ---------- End of day (Z report) ----------

def end_of_day(db: Session, tenant_ids: list[str], day: date, tz: str) -> dict:
    p = Period(day, day, tz)
    first_last = db.execute(select(func.min(Order.opened_at), func.max(Order.closed_at))
                            .where(_sales(tenant_ids, p))).one()
    first_opened = db.scalar(select(func.min(Order.opened_at)).where(
        Order.tenant_id.in_(tenant_ids), Order.opened_at >= p.start_at, Order.opened_at < p.end_at))
    voids = db.execute(select(func.count(Order.id)).where(
        Order.tenant_id.in_(tenant_ids), Order.status.in_(("void", "rejected")),
        Order.closed_at >= p.start_at, Order.closed_at < p.end_at)).scalar() or 0
    still_open = db.execute(select(func.count(Order.id), _sum(Order.subtotal - Order.discount_amount + Order.tax)).where(
        Order.tenant_id.in_(tenant_ids), Order.status.in_(("open", "new")), Order.opened_at < p.end_at)).one()
    sessions = db.scalars(
        select(CashSession).where(CashSession.tenant_id.in_(tenant_ids), CashSession.opened_at < p.end_at,
                                  or_(CashSession.closed_at.is_(None), CashSession.closed_at >= p.start_at))
        .options(selectinload(CashSession.movements)).order_by(CashSession.opened_at)).all()
    drawers = [summarize_drawer(db, SimpleNamespace(tenant_id=s.tenant_id), s) for s in sessions]
    first = min((t for t in (first_opened, first_last[0]) if t), default=None)
    return {
        "date": day.isoformat(), "tz": tz, "totals": sales_overview(db, tenant_ids, p),
        "payments": payment_methods(db, tenant_ids, p), "channels": channel_mix(db, tenant_ids, p),
        "exceptions": exceptions(db, tenant_ids, p)["summary"],
        "voided_checks": voids, "open_checks": still_open[0], "open_value": money(still_open[1]),
        "first_order_at": first.isoformat() if first else None,
        "last_order_at": first_last[1].isoformat() if first_last[1] else None,
        "hours": [sum(c) for c in zip(*sales_heatmap(db, tenant_ids, p)["net"])],
        "drawers": drawers,
        "drawer_totals": {
            "expected": round(sum(d["expected_cash"] for d in drawers), 2),
            "counted": round(sum(d["counted_cash"] or 0 for d in drawers if d["closed_at"]), 2),
            "over_short": round(sum(d["difference"] or 0 for d in drawers if d["closed_at"]), 2),
        },
    }


# ---------- Endpoints ----------

def period(ctx: Ctx, start: date | None, end: date | None) -> Period:
    tz = tenant_tz(ctx.tenant)
    today = datetime.now(tz).date()
    s, e = start or end or today, end or start or today
    if e < s:
        raise HTTPException(422, "End date is before the start date")
    if (e - s).days + 1 > MAX_DAYS:
        raise HTTPException(422, f"Pick a range of at most {MAX_DAYS} days")
    return Period(s, e, tz.key)


def _with_compare(fn, db, ids, p: Period, compare: bool, key: str) -> dict:
    out = {"period": p.out(), key: fn(db, ids, p)}
    if compare:
        out["previous_period"] = p.previous().out()
        out["previous"] = fn(db, ids, p.previous())
    return out


@router.get("/reports/overview")
def overview(start: date | None = None, end: date | None = None, compare: bool = False,
             ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    p, ids = period(ctx, start, end), [ctx.tenant_id]
    out = _with_compare(sales_overview, db, ids, p, compare, "totals")
    out["by_day"] = sales_by_day(db, ids, p)
    if compare:
        out["previous_by_day"] = sales_by_day(db, ids, p.previous())
    out["heatmap"] = sales_heatmap(db, ids, p)
    return out


@router.get("/reports/items")
def items(start: date | None = None, end: date | None = None, compare: bool = False,
          ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    p, ids = period(ctx, start, end), [ctx.tenant_id]
    out = {"period": p.out(), **item_mix(db, ids, p)}
    if compare:
        prev = item_mix(db, ids, p.previous())
        out["previous_period"] = p.previous().out()
        out["previous"] = {"total_net": prev["total_net"], "total_qty": prev["total_qty"],
                           "items": {f"{i['menu_item_id']}|{i['name']}": {"qty": i["qty"], "net_sales": i["net_sales"]}
                                     for i in prev["items"]},
                           "categories": {c["category"]: {"qty": c["qty"], "net_sales": c["net_sales"]}
                                          for c in prev["categories"]}}
    return out


@router.get("/reports/payments")
def payments(start: date | None = None, end: date | None = None, compare: bool = False,
             ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    p, ids = period(ctx, start, end), [ctx.tenant_id]
    out = {"period": p.out(), "methods": payment_methods(db, ids, p), "channels": channel_mix(db, ids, p)}
    if compare:
        q = p.previous()
        out["previous_period"] = q.out()
        out["previous"] = {"methods": payment_methods(db, ids, q), "channels": channel_mix(db, ids, q)}
    return out


@router.get("/reports/staff")
def staff(start: date | None = None, end: date | None = None, compare: bool = False,
          ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    return _with_compare(staff_performance, db, [ctx.tenant_id], period(ctx, start, end), compare, "staff")


@router.get("/reports/exceptions")
def exceptions_report(start: date | None = None, end: date | None = None, compare: bool = False,
                      ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    p, ids = period(ctx, start, end), [ctx.tenant_id]
    out = {"period": p.out(), **exceptions(db, ids, p)}
    if compare:
        out["previous_period"] = p.previous().out()
        out["previous"] = exceptions(db, ids, p.previous(), limit=0)["summary"]
    return out


@router.get("/reports/tax")
def tax(start: date | None = None, end: date | None = None, compare: bool = False,
        ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    p, ids = period(ctx, start, end), [ctx.tenant_id]
    out = {"period": p.out(), "label": ctx.tenant.tax_label, "rate": float(ctx.tenant.tax_rate) * 100,
           **tax_report(db, ids, p)}
    if compare:
        prev = tax_report(db, ids, p.previous())
        out["previous_period"] = p.previous().out()
        out["previous"] = {"taxable": prev["taxable"], "tax": prev["tax"]}
    return out


@router.get("/reports/eod")
def eod(day: date | None = Query(None, alias="date"), ctx: Ctx = Depends(require("reports")),
        db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    return {**end_of_day(db, [ctx.tenant_id], day or datetime.now(tz).date(), tz.key),
            "tax_label": ctx.tenant.tax_label}


# ---------- CSV export ----------

def _csv(header: list[tuple[str, str]], rows):
    """Stream rows (dicts) as CSV with the given (key, column title) header."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([t for _, t in header])
    yield "﻿" + buf.getvalue()  # BOM so spreadsheet apps detect UTF-8
    for r in rows:
        buf.seek(0)
        buf.truncate()
        w.writerow([r.get(k, "") for k, _ in header])
        yield buf.getvalue()


EXPORTS: dict[str, tuple[list[tuple[str, str]], object]] = {
    "sales_by_day": ([("date", "Date"), ("orders", "Orders"), ("guests", "Guests"), ("gross_sales", "Gross sales"),
                      ("comps", "Comps"), ("discounts", "Discounts"), ("net_sales", "Net sales"), ("tax", "Tax"),
                      ("tips", "Tips"), ("refunds", "Refunds"), ("avg_check", "Average check")], sales_by_day),
    "items": ([("name", "Item"), ("category", "Category"), ("qty", "Qty sold"), ("comp_qty", "Qty comped"),
               ("gross_sales", "Gross sales"), ("comps", "Comps"), ("net_sales", "Net sales"),
               ("pct_sales", "% of net sales"), ("avg_price", "Average price"), ("orders", "Checks")],
              lambda db, ids, p: item_mix(db, ids, p)["items"]),
    "staff": ([("name", "Staff"), ("role", "Role"), ("orders", "Checks"), ("guests", "Guests"),
               ("net_sales", "Net sales"), ("avg_check", "Average check"), ("tips", "Tips"),
               ("payments", "Payments taken"), ("collected", "Collected"), ("discount_count", "Discounts given"),
               ("discounts", "Discount amount"), ("comp_count", "Comps given"), ("comps", "Comp amount"),
               ("void_count", "Voids"), ("voids", "Void amount"), ("refund_count", "Refunds"),
               ("refunds", "Refund amount")], staff_performance),
    "payments": ([("method", "Method"), ("count", "Payments"), ("amount", "Amount"), ("tips", "Tips"),
                  ("refund_count", "Refunds"), ("refunds", "Refunded"), ("net", "Net collected"), ("pct", "% of net")],
                 payment_methods),
    "orders": ([("number", "Check"), ("opened_at", "Opened"), ("closed_at", "Closed"), ("status", "Status"),
                ("channel", "Channel"), ("table", "Table"), ("guests", "Guests"), ("server", "Server"),
                ("subtotal", "Subtotal"), ("discount", "Discount"), ("discount_reason", "Discount reason"),
                ("tax", "Tax"), ("tip", "Tip"), ("total", "Total"), ("paid", "Paid"), ("refunded", "Refunded"),
                ("payment_method", "Payment method"), ("void_reason", "Void reason")], order_rows),
    "exceptions": ([("created_at", "When"), ("action", "Type"), ("order_number", "Check"), ("user", "By"),
                    ("amount", "Amount"), ("detail", "Detail")],
                   lambda db, ids, p: [{**r, "created_at": datetime.fromisoformat(r["created_at"]).astimezone(p.zone)
                                        .strftime("%Y-%m-%d %H:%M")}
                                       for r in exceptions(db, ids, p, limit=100_000)["rows"]]),
    "tax": ([("date", "Date"), ("orders", "Orders"), ("taxable", "Taxable amount"), ("tax", "Tax collected")],
            lambda db, ids, p: tax_report(db, ids, p)["days"]),
    "channels": ([("channel", "Channel"), ("orders", "Orders"), ("guests", "Guests"), ("net_sales", "Net sales"),
                  ("avg_check", "Average check"), ("tips", "Tips"), ("pct_sales", "% of net sales")], channel_mix),
}


@router.get("/reports/export.csv")
def export_csv(report: str, start: date | None = None, end: date | None = None,
               ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    if report not in EXPORTS:
        raise HTTPException(422, f"Unknown report. Use one of: {', '.join(EXPORTS)}")
    p = period(ctx, start, end)
    header, fn = EXPORTS[report]
    rows = fn(db, [ctx.tenant_id], p)  # type: ignore[operator]
    name = f"{ctx.tenant.slug}-{report}-{p.start}" + (f"-to-{p.end}" if p.end != p.start else "") + ".csv"
    return StreamingResponse(_csv(header, rows), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})
