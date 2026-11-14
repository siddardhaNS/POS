"""The desktop counter app: it downloads what it needs to bill without the internet, and sends offline sales back.

Sales rung up offline arrive with the device's own id (client_id), so sending the same sale twice never creates two
checks. Prices and tax come from what the guest was actually charged at the counter; the server re-totals the check
and closes it when the payments cover it (otherwise it stays open with a note for a manager)."""
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import crm, loyalty, taxes
from ..db import get_db
from ..deps import Ctx, has_module, require
from ..live import audit
from ..models import Kot, MenuItem, Order, OrderItem, Payment, User, now
from ..stock import deduct_for_order
from .auth import tenant_out
from .backoffice import _menu
from .pos import CENT, PAY_METHODS, balance, load_order, next_number, q, settle

router = APIRouter(prefix="/counter", tags=["counter"])


@router.get("/bootstrap")
def bootstrap(ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    """Everything to sell offline: the takeaway menu with prices and each dish's tax, the restaurant's settings and
    the staff who can use the counter."""
    menu = _menu(ctx, db, "takeaway")
    res = taxes.Resolver(db, ctx.tenant)
    tax: dict[str, dict] = {}
    for m in db.scalars(select(MenuItem).where(MenuItem.tenant_id == ctx.tenant_id)):
        r = res.for_item(m)
        rate = Decimal(r.rate) if r else Decimal(ctx.tenant.tax_rate)
        name = r.name if r else (ctx.tenant.tax_label or "Tax")
        tax[m.id] = {"rate": float(rate), "name": name, "parts": taxes.parts_of(name, rate, r.components if r else None)}
    staff = db.scalars(select(User).where(User.tenant_id == ctx.tenant_id, User.is_active.is_(True), User.pin_hash.is_not(None))
                       .order_by(User.created_at)).all()
    return {"tenant": tenant_out(ctx.tenant), "menu": menu, "tax": tax, "server_time": now().isoformat(),
            "staff": [{"id": u.id, "name": u.name, "role": u.role} for u in staff]}


class SyncLine(BaseModel):
    menu_item_id: str | None = Field(default=None, max_length=36)
    name: str = Field(min_length=1, max_length=160)
    qty: int = Field(ge=1, le=999)
    unit_price: float = Field(ge=0, le=1_000_000)  # what was charged, options included
    modifiers: list[dict] = Field(default_factory=list, max_length=30)  # [{"group", "name", "price"}]
    note: str = Field(default="", max_length=200)


class SyncPayment(BaseModel):
    method: str = Field(pattern=PAY_METHODS)
    amount: float = Field(gt=0, le=10_000_000)
    tendered: float = Field(default=0, ge=0, le=10_000_000)
    at: datetime | None = None


class SyncOrder(BaseModel):
    client_id: str = Field(min_length=8, max_length=40)
    client_ref: str = Field(default="", max_length=20)  # the token number given to the guest
    created_at: datetime
    closed_at: datetime | None = None
    customer_name: str = Field(default="", max_length=120)
    customer_phone: str = Field(default="", max_length=40)
    tax_inclusive: bool = False
    discount_kind: str = Field(default="", pattern=r"^(|percent|amount)$")
    discount_value: float = Field(default=0, ge=0, le=1_000_000)
    discount_reason: str = Field(default="", max_length=120)
    lines: list[SyncLine] = Field(min_length=1, max_length=200)
    payments: list[SyncPayment] = Field(default_factory=list, max_length=20)
    void_reason: str = Field(default="", max_length=200)  # cancelled at the counter before syncing


class SyncIn(BaseModel):
    orders: list[SyncOrder] = Field(min_length=1, max_length=200)


def aware(d: datetime | None) -> datetime | None:
    return d.replace(tzinfo=timezone.utc) if d and d.tzinfo is None else d


def take(db: Session, ctx: Ctx, x: SyncOrder) -> dict:
    hit = db.scalar(select(Order).where(Order.tenant_id == ctx.tenant_id, Order.client_id == x.client_id))
    if hit:
        return {"client_id": x.client_id, "status": "exists", "order_id": hit.id, "number": hit.number, "state": hit.status}
    created = aware(x.created_at) or now()
    o = Order(tenant_id=ctx.tenant_id, number=next_number(db, Order, ctx.tenant_id), channel="takeaway", opened_by=ctx.user.id,
              opened_at=min(created, now()), customer_name=x.customer_name.strip(), customer_phone=x.customer_phone.strip(),
              client_id=x.client_id, client_ref=x.client_ref.strip(), tax_inclusive=x.tax_inclusive,
              discount_kind=x.discount_kind, discount_value=Decimal(str(x.discount_value)) if x.discount_kind else Decimal(0),
              discount_reason=x.discount_reason.strip(), promotion_auto_off=True)  # the counter already priced it
    db.add(o)
    db.flush()
    o = load_order(db, ctx, o.id)
    res = taxes.Resolver(db, ctx.tenant)
    known = {m.id: m for m in db.scalars(select(MenuItem).where(MenuItem.tenant_id == ctx.tenant_id,
                                                                MenuItem.id.in_([ln.menu_item_id for ln in x.lines if ln.menu_item_id] or [""])))}
    for ln in x.lines:
        m = known.get(ln.menu_item_id or "")
        line = OrderItem(tenant_id=ctx.tenant_id, menu_item_id=m.id if m else None, name=ln.name.strip(), qty=ln.qty,
                         unit_price=Decimal(str(ln.unit_price)).quantize(CENT), note=ln.note.strip(), station=m.station if m else "",
                         modifiers=[{"group": str(md.get("group", ""))[:80], "name": str(md.get("name", ""))[:80],
                                     "price": float(md.get("price", 0) or 0)} for md in ln.modifiers], created_at=created)
        if m:
            res.stamp(line, m)
        o.items.append(line)
    if o.customer_phone:
        crm.link(db, ctx.tenant, o)
    settle(db, ctx.tenant, o)
    if x.void_reason:
        o.status, o.closed_at, o.void_reason = "void", aware(x.closed_at) or now(), f"Cancelled at the counter · {x.void_reason.strip()}"
        audit(db, ctx, "void", order=o, detail=o.void_reason)
        db.commit()
        return {"client_id": x.client_id, "status": "created", "order_id": o.id, "number": o.number, "state": o.status}
    # Already handed over at the counter: the kitchen ticket is history, not a new job for the kitchen screen.
    k = Kot(tenant_id=ctx.tenant_id, order_id=o.id, number=next_number(db, Kot, ctx.tenant_id), bumped=True, created_at=created,
            bumped_at=aware(x.closed_at) or created)
    db.add(k)
    db.flush()
    for i in o.items:
        i.kot_id, i.done = k.id, True
    paid = Decimal(0)
    for p in x.payments:
        amt = q(Decimal(str(p.amount)))
        tendered = q(Decimal(str(p.tendered)))
        o.payments.append(Payment(tenant_id=ctx.tenant_id, order_id=o.id, kind="payment", method=p.method, amount=amt,
                                  tendered=tendered, change=max(tendered - amt, Decimal(0)) if p.method == "cash" and tendered else Decimal(0),
                                  user_id=ctx.user.id, created_at=aware(p.at) or created))
        if p.method == "points" and o.customer_id:
            loyalty.redeem(db, ctx.tenant, o, amt, ctx.user.name)
        paid += amt
    o.paid = paid
    db.flush()
    gap = balance(o)
    if abs(gap) <= Decimal("1.00"):  # rounding between the counter and the server: close it
        methods = {p.method for p in o.payments}
        o.status, o.closed_at = "paid", aware(x.closed_at) or now()
        o.payment_method = methods.pop() if len(methods) == 1 else "split" if methods else "comp"
        taxes.assign_invoice(db, ctx.tenant, o, o.closed_at)
        loyalty.earn(db, ctx.tenant, o)
        if has_module(ctx.tenant, "inventory"):
            deduct_for_order(db, o, ctx.user.id)
    else:
        audit(db, ctx, "offline_mismatch", order=o, amount=gap,
              detail=f"Counter sale {x.client_ref or x.client_id}: collected {paid}, check comes to {paid + gap}. Left open to settle.")
    db.commit()
    return {"client_id": x.client_id, "status": "created", "order_id": o.id, "number": o.number, "state": o.status,
            "invoice_no": o.invoice_no, "gap": float(gap)}


@router.post("/sync")
def sync(body: SyncIn, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    """Send sales made at the counter (online or offline). Each one is saved on its own, so one bad sale doesn't hold
    up the rest; repeating a sync is safe."""
    out = []
    for x in body.orders:
        try:
            out.append(take(db, ctx, x))
        except Exception as e:  # keep going; the counter keeps that sale queued and shows the reason
            db.rollback()
            out.append({"client_id": x.client_id, "status": "error", "message": str(e)[:300]})
    return {"results": out}
