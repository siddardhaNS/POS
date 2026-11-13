"""Reservations and the walk-in waitlist. Optional module "reservations".

Bookings hold a time, party size and (optionally) a table; seating one opens the table's check with the party
size and guest name filled in. Waitlist quotes come from the floor timeline's clear-time estimates.
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Ctx, needs, require
from ..live import audit
from ..models import DiningTable, Order, Reservation, now
from .pos import floor_timeline, next_number, tenant_tz

router = APIRouter(tags=["reservations"], dependencies=[Depends(needs("reservations"))])

ACTIVE_BOOKING = ("booked", "confirmed")
ACTIVE_WAIT = ("waiting", "notified")
HOLDS_TABLE = ("booked", "confirmed", "seated")
RESET_MIN = 5  # minutes to clear and reset a table before the next party
SOON_MIN = 20  # a booking this close blocks a free table for walk-ins


def default_duration(party: int) -> int:
    return 75 if party <= 2 else 90 if party <= 4 else 120


def res_out(r: Reservation, tables: dict[str, str]) -> dict:
    return {
        "id": r.id, "kind": r.kind, "name": r.name, "phone": r.phone, "email": r.email, "party_size": r.party_size,
        "at": r.at.isoformat(), "duration_min": r.duration_min, "ends_at": (r.at + timedelta(minutes=r.duration_min)).isoformat(),
        "table_id": r.table_id, "table": tables.get(r.table_id or "", ""), "section": r.section, "notes": r.notes,
        "source": r.source, "status": r.status, "quoted_min": r.quoted_min,
        "notified_at": r.notified_at.isoformat() if r.notified_at else None,
        "seated_at": r.seated_at.isoformat() if r.seated_at else None, "order_id": r.order_id,
        "created_by": r.created_by, "created_at": r.created_at.isoformat(),
    }


def table_names(db: Session, ctx: Ctx) -> dict[str, str]:
    return dict(db.execute(select(DiningTable.id, DiningTable.name).where(DiningTable.tenant_id == ctx.tenant_id)).all())


def get_res(db: Session, ctx: Ctx, rid: str) -> Reservation:
    r = db.scalar(select(Reservation).where(Reservation.id == rid, Reservation.tenant_id == ctx.tenant_id))
    if not r:
        raise HTTPException(404, "Reservation not found")
    return r


def local_day(ctx: Ctx, d: date) -> tuple[datetime, datetime]:
    tz = tenant_tz(ctx.tenant)
    start = datetime(d.year, d.month, d.day, tzinfo=tz)
    return start, start + timedelta(days=1)


def occupied_tables(db: Session, ctx: Ctx) -> set[str]:
    return set(db.scalars(select(Order.table_id).where(Order.tenant_id == ctx.tenant_id, Order.status == "open",
                                                       Order.table_id.is_not(None))))


def clashes(db: Session, ctx: Ctx, start: datetime, end: datetime, skip: str | None = None) -> dict[str, Reservation]:
    """Bookings holding a table during [start, end) (plus reset time)."""
    q = select(Reservation).where(
        Reservation.tenant_id == ctx.tenant_id, Reservation.kind == "booking", Reservation.status.in_(HOLDS_TABLE),
        Reservation.table_id.is_not(None), Reservation.at < end + timedelta(minutes=RESET_MIN))
    if skip:
        q = q.where(Reservation.id != skip)
    out = {}
    for r in db.scalars(q):
        if r.at + timedelta(minutes=r.duration_min + RESET_MIN) > start:
            out[r.table_id] = r
    return out


def fit_tables(db: Session, ctx: Ctx, at: datetime, duration: int, party: int, skip: str | None = None) -> list[dict]:
    """Tables a party could have at `at`: big enough, not held by another booking, and free if it's about now."""
    end = at + timedelta(minutes=duration)
    held = clashes(db, ctx, at, end, skip)
    busy = occupied_tables(db, ctx) if at <= now() + timedelta(minutes=SOON_MIN) else set()
    out = []
    for t in db.scalars(select(DiningTable).where(DiningTable.tenant_id == ctx.tenant_id).order_by(DiningTable.sort)):
        if t.seats < party:
            continue
        reason = "booked" if t.id in held else "occupied" if t.id in busy else None
        out.append({"id": t.id, "name": t.name, "seats": t.seats, "section": t.section, "free": reason is None,
                    "reason": reason, "booked_by": held[t.id].name if t.id in held else None})
    out.sort(key=lambda x: (not x["free"], x["seats"] - party, x["name"]))
    return out


def quote(db: Session, ctx: Ctx, party: int, ahead: int = 0) -> dict:
    """Minutes until a table for this party is likely free, from the floor timeline's clear-time estimates."""
    t_now = now()
    fits = fit_tables(db, ctx, t_now, default_duration(party), party)
    if any(f["free"] for f in fits) and ahead == 0:
        return {"minutes": 0, "basis": "A table is free now"}
    tl = floor_timeline(ctx=ctx, db=db)
    big_enough = {t["id"] for t in tl["tables"] if t["seats"] >= party}
    soon = []
    for t in tl["tables"]:
        if t["id"] not in big_enough:
            continue
        for c in t["checks"]:
            if c["status"] == "open" and c.get("clears_at"):
                left = (datetime.fromisoformat(c["clears_at"]) - t_now).total_seconds() / 60
                soon.append(max(5.0, left) + RESET_MIN)
    soon.sort()
    if not big_enough:
        return {"minutes": None, "basis": f"No table seats {party}"}
    if not soon:
        return {"minutes": 30 + 15 * ahead, "basis": "Typical wait (no tables are timed yet)"}
    idx = min(ahead, len(soon) - 1)
    extra = 15 * max(0, ahead - (len(soon) - 1))
    return {"minutes": int(round(soon[idx] + extra)), "basis": f"Based on {len(soon)} table{'s' if len(soon) != 1 else ''} that will clear"}


# ---------- Day view ----------

@router.get("/reservations")
def day(day: date | None = Query(None, alias="date"), ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    d = day or datetime.now(tz).date()
    start, end = local_day(ctx, d)
    names = table_names(db, ctx)
    bookings = db.scalars(select(Reservation).where(Reservation.tenant_id == ctx.tenant_id, Reservation.kind == "booking",
                                                    Reservation.at >= start, Reservation.at < end).order_by(Reservation.at)).all()
    waitlist = db.scalars(select(Reservation).where(Reservation.tenant_id == ctx.tenant_id, Reservation.kind == "waitlist",
                                                    or_(Reservation.status.in_(ACTIVE_WAIT),
                                                        and_(Reservation.at >= start, Reservation.at < end)))
                          .order_by(Reservation.at)).all()
    live = [b for b in bookings if b.status not in ("cancelled", "no_show")]
    return {
        "date": d.isoformat(), "timezone": tz.key,
        "bookings": [res_out(r, names) for r in bookings],
        "waitlist": [res_out(r, names) for r in waitlist],
        "summary": {"bookings": len(live), "covers": sum(b.party_size for b in live),
                    "seated": sum(1 for b in bookings if b.status in ("seated", "completed")),
                    "no_shows": sum(1 for b in bookings if b.status == "no_show"),
                    "waiting": sum(1 for w in waitlist if w.status in ACTIVE_WAIT)},
        "tables": [{"id": t.id, "name": t.name, "seats": t.seats, "section": t.section}
                   for t in db.scalars(select(DiningTable).where(DiningTable.tenant_id == ctx.tenant_id).order_by(DiningTable.sort))],
    }


@router.get("/reservations/upcoming")
def upcoming(minutes: int = Query(120, ge=15, le=720), ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    """Bookings with a table in the next few hours, for badges on the floor plan."""
    t = now()
    rows = db.scalars(select(Reservation).where(
        Reservation.tenant_id == ctx.tenant_id, Reservation.kind == "booking", Reservation.status.in_(ACTIVE_BOOKING),
        Reservation.at >= t - timedelta(minutes=30), Reservation.at <= t + timedelta(minutes=minutes)).order_by(Reservation.at)).all()
    return [res_out(r, table_names(db, ctx)) for r in rows]


@router.get("/reservations/availability")
def availability(at: datetime, party: int = Query(ge=1, le=60), duration: int | None = Query(None, ge=15, le=480),
                 skip: str | None = None, ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    at = at if at.tzinfo else at.replace(tzinfo=tz)
    return {"tables": fit_tables(db, ctx, at, duration or default_duration(party), party, skip)}


@router.get("/reservations/quote")
def get_quote(party: int = Query(ge=1, le=60), ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    waiting = db.scalar(select(func.count()).select_from(Reservation).where(
        Reservation.tenant_id == ctx.tenant_id, Reservation.kind == "waitlist", Reservation.status.in_(ACTIVE_WAIT))) or 0
    return {**quote(db, ctx, party, waiting), "ahead": waiting}


# ---------- Create & edit ----------

class ResIn(BaseModel):
    kind: str = Field(default="booking", pattern=r"^(booking|waitlist)$")
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=200)
    party_size: int = Field(ge=1, le=60)
    at: datetime | None = None  # bookings: restaurant-local time if no offset
    duration_min: int | None = Field(default=None, ge=15, le=480)
    table_id: str | None = Field(default=None, max_length=36)
    section: str = Field(default="", max_length=40)
    notes: str = Field(default="", max_length=1000)
    source: str = Field(default="phone", pattern=r"^(phone|walk_in|online|other)$")
    quoted_min: int | None = Field(default=None, ge=0, le=600)


def check_table(db: Session, ctx: Ctx, tid: str | None, at: datetime, duration: int, party: int, skip: str | None = None) -> None:
    if not tid:
        return
    t = db.scalar(select(DiningTable).where(DiningTable.id == tid, DiningTable.tenant_id == ctx.tenant_id))
    if not t:
        raise HTTPException(404, "Table not found")
    hit = clashes(db, ctx, at, at + timedelta(minutes=duration), skip).get(tid)
    if hit:
        raise HTTPException(409, f"{t.name} is booked for {hit.name} at {hit.at.astimezone(tenant_tz(ctx.tenant)):%H:%M}")
    if t.seats < party:
        raise HTTPException(422, f"{t.name} seats {t.seats}; this party is {party}")


@router.post("/reservations", status_code=201)
def create(body: ResIn, ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    if body.kind == "booking":
        if not body.at:
            raise HTTPException(422, "Pick a date and time")
        at = body.at if body.at.tzinfo else body.at.replace(tzinfo=tz)
        if at < now() - timedelta(hours=12):
            raise HTTPException(422, "That time has already passed")
    else:
        at = now()
    duration = body.duration_min or default_duration(body.party_size)
    if body.kind == "booking":
        check_table(db, ctx, body.table_id, at, duration, body.party_size)
    r = Reservation(tenant_id=ctx.tenant_id, kind=body.kind, name=body.name.strip(), phone=body.phone.strip(), email=body.email.strip(),
                    party_size=body.party_size, at=at, duration_min=duration, table_id=body.table_id if body.kind == "booking" else None,
                    section=body.section.strip(), notes=body.notes.strip(), source=body.source if body.kind == "booking" else "walk_in",
                    status="booked" if body.kind == "booking" else "waiting", created_by=ctx.user.name)
    if body.kind == "waitlist":
        r.quoted_min = body.quoted_min if body.quoted_min is not None else quote(db, ctx, body.party_size)["minutes"]
    db.add(r)
    db.commit()
    return res_out(r, table_names(db, ctx))


class ResPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=200)
    party_size: int | None = Field(default=None, ge=1, le=60)
    at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=15, le=480)
    table_id: str | None = Field(default=None, max_length=36)
    clear_table: bool = False
    section: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=1000)
    quoted_min: int | None = Field(default=None, ge=0, le=600)
    status: str | None = Field(default=None, pattern=r"^(booked|confirmed|completed|cancelled|no_show|waiting|notified|left)$")


@router.patch("/reservations/{rid}")
def edit(rid: str, body: ResPatch, ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    r = get_res(db, ctx, rid)
    tz = tenant_tz(ctx.tenant)
    data = body.model_dump(exclude_unset=True)
    for k in ("name", "phone", "email", "section", "notes"):
        if data.get(k) is not None:
            setattr(r, k, data[k].strip())
    if body.party_size is not None:
        r.party_size = body.party_size
    if body.at is not None:
        r.at = body.at if body.at.tzinfo else body.at.replace(tzinfo=tz)
    if body.duration_min is not None:
        r.duration_min = body.duration_min
    if body.quoted_min is not None:
        r.quoted_min = body.quoted_min
    if body.clear_table:
        r.table_id = None
    elif body.table_id is not None:
        r.table_id = body.table_id
    if r.kind == "booking" and r.table_id and r.status in ACTIVE_BOOKING:
        check_table(db, ctx, r.table_id, r.at, r.duration_min, r.party_size, skip=r.id)
    if body.status:
        allowed = {"booking": {"booked", "confirmed", "completed", "cancelled", "no_show"}, "waitlist": {"waiting", "notified", "left"}}[r.kind]
        if body.status not in allowed:
            raise HTTPException(422, f"A {r.kind} can't be {body.status.replace('_', '-')}")
        if body.status in ("cancelled", "no_show") and r.status != body.status:
            audit(db, ctx, f"reservation_{body.status}", detail=f"{r.name}, party of {r.party_size}, {r.at.astimezone(tz):%d %b %H:%M}")
        r.status = body.status
        if body.status == "notified":
            r.notified_at = now()
    r.updated_at = now()
    db.commit()
    return res_out(r, table_names(db, ctx))


class SeatIn(BaseModel):
    table_id: str = Field(max_length=36)


@router.post("/reservations/{rid}/seat")
def seat(rid: str, body: SeatIn, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    """Seat the party: opens the table's check with the party size and name, or joins an empty open check."""
    r = get_res(db, ctx, rid)
    if r.status in ("seated", "completed", "cancelled", "no_show", "left"):
        raise HTTPException(409, f"This party is already {r.status.replace('_', '-')}")
    t = db.scalar(select(DiningTable).where(DiningTable.id == body.table_id, DiningTable.tenant_id == ctx.tenant_id))
    if not t:
        raise HTTPException(404, "Table not found")
    o = db.scalar(select(Order).where(Order.tenant_id == ctx.tenant_id, Order.table_id == t.id, Order.status == "open"))
    if o and (o.items or o.customer_name):
        raise HTTPException(409, f"{t.name} still has a check open")
    if not o:
        o = Order(tenant_id=ctx.tenant_id, number=next_number(db, Order, ctx.tenant_id), table_id=t.id, channel="dine_in", opened_by=ctx.user.id)
        db.add(o)
    o.guests, o.customer_name, o.customer_phone = r.party_size, r.name, r.phone
    db.flush()
    r.status, r.table_id, r.seated_at, r.order_id, r.updated_at = "seated", t.id, now(), o.id, now()
    db.commit()
    return {**res_out(r, table_names(db, ctx)), "order_id": o.id}
