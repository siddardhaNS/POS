"""Catering and event orders: booked ahead with a menu, quoted, confirmed with an advance, settled after the event.

They are ordinary checks with channel "catering": items, taxes, offers and payments all work the same, and
advances are part payments that stay on the check until the balance is settled."""
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import Ctx, require
from ..live import audit
from ..models import CreditNote, Order, Payment, now
from .pos import METHODS, load_order, next_number, order_out, save, tenant_tz

router = APIRouter(tags=["events"])


@router.get("/events")
def events(when: str = "upcoming", ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    """upcoming: open events from today on (and any still unsettled); past: the last 90 days."""
    tz = tenant_tz(ctx.tenant)
    d = datetime.now(tz).date()
    start = datetime(d.year, d.month, d.day, tzinfo=tz)
    stmt = select(Order).where(Order.tenant_id == ctx.tenant_id, Order.channel == "catering", Order.status != "merged") \
        .options(selectinload(Order.items), selectinload(Order.payments), selectinload(Order.table))
    if when == "past":
        stmt = stmt.where(Order.event_at < start, Order.event_at >= start - timedelta(days=90),
                          Order.status.notin_(("open",))).order_by(Order.event_at.desc())
    else:
        stmt = stmt.where((Order.event_at >= start) | (Order.status == "open")).order_by(Order.event_at)
    return [order_out(o) for o in db.scalars(stmt.limit(300)).all()]


class EventPatch(BaseModel):
    at: datetime | None = None
    venue: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=2000)
    guests: int | None = Field(default=None, ge=0, le=100_000)
    status: str | None = Field(default=None, pattern=r"^(quote|confirmed|done)$")


@router.patch("/orders/{oid}/event")
def edit_event(oid: str, body: EventPatch, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if o.channel != "catering":
        raise HTTPException(409, "Not an event order")
    if o.status not in ("open", "paid"):
        raise HTTPException(409, f"This event is {o.status}")
    if body.at is not None:
        o.event_at = body.at
    if body.venue is not None:
        o.event_venue = body.venue.strip()
    if body.note is not None:
        o.event_note = body.note.strip()
    if body.guests is not None:
        o.guests = body.guests
    if body.status is not None and body.status != o.event_status:
        if body.status == "confirmed" and not o.items:
            raise HTTPException(409, "Add the menu before confirming")
        audit(db, ctx, "event", order=o, detail=f"{o.event_status or 'new'} → {body.status}")
        o.event_status = body.status
    if o.status == "open":
        return save(db, ctx, o)
    db.commit()
    return order_out(load_order(db, ctx, oid))


class CancelIn(BaseModel):
    reason: str = Field(min_length=2, max_length=200)
    refund_method: str = Field(default="cash", pattern=METHODS)


@router.post("/orders/{oid}/event/cancel")
def cancel_event(oid: str, body: CancelIn, ctx: Ctx = Depends(require("refund")), db: Session = Depends(get_db)):
    """Cancel an event: any advance is refunded in full (with a credit note) and the check is voided, so it never
    counts as a sale while the advance in and refund out both stay on record."""
    o = load_order(db, ctx, oid)
    if o.channel != "catering" or o.status != "open":
        raise HTTPException(409, "Only open event orders can be cancelled")
    advance = Decimal(o.paid or 0) + Decimal(o.tip or 0)
    back = advance
    if back > 0:
        pay = Payment(tenant_id=ctx.tenant_id, order_id=o.id, kind="refund", method=body.refund_method, amount=back,
                      reason=f"Event cancelled · {body.reason.strip()}", user_id=ctx.user.id)
        o.payments.append(pay)
        o.refunded = Decimal(o.refunded or 0) + back
        db.flush()
        tax = (back * Decimal(o.tax) / advance).quantize(Decimal("0.01")) if advance and o.tax else Decimal(0)
        db.add(CreditNote(tenant_id=ctx.tenant_id, number=next_number(db, CreditNote, ctx.tenant_id), order_id=o.id,
                          payment_id=pay.id, amount=back, tax=min(tax, Decimal(o.tax or 0)), method=body.refund_method,
                          reason=f"Event cancelled · {body.reason.strip()}", user_name=ctx.user.name))
    o.event_status = "cancelled"
    o.status, o.void_reason = "void", f"Event cancelled · {body.reason.strip()}"
    o.closed_at = now()
    audit(db, ctx, "event", order=o, amount=back, detail=f"Cancelled · {body.reason.strip()}")
    db.commit()
    return order_out(load_order(db, ctx, oid))
