"""Service-side endpoints: floor, orders, modifiers, discounts, KOTs, kitchen display, online orders,
split payments, refunds and order history."""
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import PERMISSIONS, Ctx, require
from ..models import DiningTable, Kot, MenuItem, ModifierGroup, Order, OrderItem, Payment, Tenant, now

router = APIRouter(tags=["pos"])
CENT = Decimal("0.01")
ONLINE_CHANNELS = {"swiggy", "zomato", "doordash", "ubereats", "website"}
METHODS = r"^(cash|card|upi|tap|online|other)$"


def money(v: Decimal | float | int | None) -> float:
    return float(Decimal(v or 0).quantize(CENT, ROUND_HALF_UP))


def q(v: Decimal) -> Decimal:
    return Decimal(v).quantize(CENT, ROUND_HALF_UP)


def tenant_tz(t: Tenant) -> ZoneInfo:
    try:
        return ZoneInfo(t.timezone or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def line_total(i: OrderItem) -> Decimal:
    return Decimal(0) if i.comp_reason else i.unit_price * i.qty


def recompute(o: Order, tax_rate: Decimal) -> None:
    sub = sum((line_total(i) for i in o.items), Decimal(0))
    if o.discount_kind == "percent":
        disc = sub * Decimal(o.discount_value or 0) / 100
    elif o.discount_kind == "amount":
        disc = min(Decimal(o.discount_value or 0), sub)
    else:
        disc = Decimal(0)
    o.subtotal, o.discount_amount = q(sub), q(disc)
    o.tax = q((o.subtotal - o.discount_amount) * tax_rate)
    o.tip = q(sum((p.tip for p in o.payments if p.kind == "payment"), Decimal(0)))
    o.total = o.subtotal - o.discount_amount + o.tax + o.tip


def due(o: Order) -> Decimal:
    """What the guest owes for food: after discount, with tax, before tips."""
    return Decimal(o.subtotal) - Decimal(o.discount_amount or 0) + Decimal(o.tax)


def balance(o: Order) -> Decimal:
    return due(o) - Decimal(o.paid or 0)


def payment_out(p: Payment) -> dict:
    return {"id": p.id, "kind": p.kind, "method": p.method, "amount": money(p.amount), "tip": money(p.tip),
            "tendered": money(p.tendered), "change": money(p.change), "reason": p.reason,
            "line_ids": p.line_ids or [], "created_at": p.created_at.isoformat()}


def order_out(o: Order) -> dict:
    paid_lines = {lid for p in o.payments if p.kind == "payment" for lid in (p.line_ids or [])}
    return {
        "id": o.id, "number": o.number, "table_id": o.table_id, "table": o.table.name if o.table else None,
        "channel": o.channel, "status": o.status, "customer_name": o.customer_name,
        "customer_phone": o.customer_phone, "guests": o.guests,
        "subtotal": money(o.subtotal), "tax": money(o.tax), "tip": money(o.tip), "total": money(o.total),
        "discount": {"kind": o.discount_kind, "value": money(o.discount_value), "amount": money(o.discount_amount),
                     "reason": o.discount_reason},
        "due": money(due(o)), "paid": money(o.paid), "refunded": money(o.refunded), "balance": money(balance(o)),
        "payment_method": o.payment_method, "void_reason": o.void_reason,
        "opened_at": o.opened_at.isoformat(), "closed_at": o.closed_at.isoformat() if o.closed_at else None,
        "items": [{"id": i.id, "menu_item_id": i.menu_item_id, "name": i.name, "unit_price": money(i.unit_price),
                   "qty": i.qty, "note": i.note, "modifiers": i.modifiers or [], "comp_reason": i.comp_reason,
                   "line_total": money(line_total(i)), "sent": i.kot_id is not None, "done": i.done,
                   "paid": i.id in paid_lines} for i in o.items],
        "payments": [payment_out(p) for p in o.payments],
    }


def load_order(db: Session, ctx: Ctx, oid: str) -> Order:
    o = db.scalar(select(Order).where(Order.id == oid, Order.tenant_id == ctx.tenant_id)
                  .options(selectinload(Order.items), selectinload(Order.payments), selectinload(Order.table)))
    if not o:
        raise HTTPException(404, "Order not found")
    return o


def open_order(db: Session, ctx: Ctx, oid: str) -> Order:
    o = load_order(db, ctx, oid)
    if o.status != "open":
        raise HTTPException(409, "This check is closed")
    return o


def next_number(db: Session, model, tenant_id: str) -> int:
    return (db.scalar(select(func.max(model.number)).where(model.tenant_id == tenant_id)) or 0) + 1


def save(db: Session, ctx: Ctx, o: Order) -> dict:
    db.flush()
    recompute(o, ctx.tenant.tax_rate)
    db.commit()
    return order_out(load_order(db, ctx, o.id))


# ---------- Floor ----------

@router.get("/tables")
def tables(ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    ts = db.scalars(select(DiningTable).where(DiningTable.tenant_id == ctx.tenant_id).order_by(DiningTable.sort)).all()
    open_orders = db.scalars(select(Order).where(Order.tenant_id == ctx.tenant_id, Order.status == "open",
                                                 Order.table_id.is_not(None)).options(selectinload(Order.items))).all()
    by_table = {o.table_id: o for o in open_orders}
    kot_age = dict(db.execute(select(Kot.order_id, func.min(Kot.created_at)).where(
        Kot.tenant_id == ctx.tenant_id, Kot.bumped.is_(False)).group_by(Kot.order_id)).all())
    out = []
    for t in ts:
        o = by_table.get(t.id)
        state = "free"
        if o and o.items:
            if any(i.kot_id is None for i in o.items):
                state = "unsent"
            elif o.id in kot_age:
                state = "kitchen"
            else:
                state = "served"
        out.append({
            "id": t.id, "name": t.name, "seats": t.seats, "section": t.section, "state": state,
            "order_id": o.id if o else None, "total": money(due(o)) if o else 0,
            "paid": money(o.paid) if o else 0, "guests": o.guests if o else 0,
            "items": sum(i.qty for i in o.items) if o else 0,
            "kitchen_since": kot_age[o.id].isoformat() if o and o.id in kot_age else None,
            "opened_at": o.opened_at.isoformat() if o else None,
        })
    return out


@router.post("/tables/{table_id}/order")
def open_table(table_id: str, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    """Return the open check for a table, creating one if the table is free."""
    t = db.scalar(select(DiningTable).where(DiningTable.id == table_id, DiningTable.tenant_id == ctx.tenant_id))
    if not t:
        raise HTTPException(404, "Table not found")
    o = db.scalar(select(Order).where(Order.tenant_id == ctx.tenant_id, Order.table_id == t.id, Order.status == "open"))
    if not o:
        o = Order(tenant_id=ctx.tenant_id, number=next_number(db, Order, ctx.tenant_id), table_id=t.id,
                  channel="dine_in", opened_by=ctx.user.id)
        db.add(o)
        db.commit()
    return order_out(load_order(db, ctx, o.id))


# ---------- Orders: takeaway, history, details ----------

class NewOrderIn(BaseModel):
    channel: str = Field(default="takeaway", pattern=r"^takeaway$")
    customer_name: str = Field(default="", max_length=120)
    customer_phone: str = Field(default="", max_length=40)


@router.post("/orders", status_code=201)
def new_order(body: NewOrderIn, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = Order(tenant_id=ctx.tenant_id, number=next_number(db, Order, ctx.tenant_id), channel=body.channel,
              customer_name=body.customer_name.strip(), customer_phone=body.customer_phone.strip(), opened_by=ctx.user.id)
    db.add(o)
    db.commit()
    return order_out(load_order(db, ctx, o.id))


@router.get("/orders/open")
def open_orders(channel: str = "takeaway", ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    os_ = db.scalars(select(Order).where(Order.tenant_id == ctx.tenant_id, Order.status == "open", Order.channel == channel)
                     .options(selectinload(Order.items), selectinload(Order.payments), selectinload(Order.table))
                     .order_by(Order.opened_at)).all()
    return [order_out(o) for o in os_]


@router.get("/orders")
def history(day: date | None = None, status: str = "all", search: str = Query("", alias="q", max_length=80),
            ctx: Ctx = Depends(require("history")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    d = day or datetime.now(tz).date()
    start = datetime(d.year, d.month, d.day, tzinfo=tz)
    stmt = (select(Order).where(Order.tenant_id == ctx.tenant_id, Order.opened_at >= start,
                                Order.opened_at < start + timedelta(days=1), Order.status != "merged")
            .options(selectinload(Order.items), selectinload(Order.table)).order_by(Order.opened_at.desc()))
    if status != "all":
        stmt = stmt.where(Order.status == status)
    if search.strip():
        s = search.strip()
        conds = [Order.customer_name.ilike(f"%{s}%"), Order.customer_phone.ilike(f"%{s}%"),
                 Order.table.has(DiningTable.name.ilike(s))]
        if s.lstrip("#").isdigit():
            conds.append(Order.number == int(s.lstrip("#")))
        stmt = stmt.where(or_(*conds))
    rows = db.scalars(stmt).all()
    return [{"id": o.id, "number": o.number, "table": o.table.name if o.table else None, "channel": o.channel,
             "status": o.status, "customer_name": o.customer_name, "total": money(o.total), "refunded": money(o.refunded),
             "payment_method": o.payment_method, "items": sum(i.qty for i in o.items),
             "opened_at": o.opened_at.isoformat(), "closed_at": o.closed_at.isoformat() if o.closed_at else None}
            for o in rows]


@router.get("/orders/{oid}")
def get_order(oid: str, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    return order_out(load_order(db, ctx, oid))


class OrderPatch(BaseModel):
    customer_name: str | None = Field(default=None, max_length=120)
    customer_phone: str | None = Field(default=None, max_length=40)
    guests: int | None = Field(default=None, ge=0, le=99)


@router.patch("/orders/{oid}")
def edit_order(oid: str, body: OrderPatch, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(o, k, v.strip() if isinstance(v, str) else v)
    return save(db, ctx, o)


# ---------- Items & modifiers ----------

class AddItemIn(BaseModel):
    menu_item_id: str
    qty: int = Field(default=1, ge=1, le=99)
    note: str = Field(default="", max_length=200)
    modifier_ids: list[str] = Field(default_factory=list, max_length=30)


def resolve_modifiers(db: Session, ctx: Ctx, m: MenuItem, ids: list[str]) -> list[dict]:
    groups = db.scalars(select(ModifierGroup).where(ModifierGroup.menu_item_id == m.id, ModifierGroup.tenant_id == ctx.tenant_id)
                        .options(selectinload(ModifierGroup.options)).order_by(ModifierGroup.sort)).all()
    chosen = set(ids)
    known = {o.id for g in groups for o in g.options}
    if chosen - known:
        raise HTTPException(422, "Unknown option for this item")
    out = []
    for g in groups:
        picks = [o for o in g.options if o.id in chosen]
        if len(picks) < g.min_select:
            raise HTTPException(422, f"Choose {g.name.lower()} for {m.name}")
        if g.max_select and len(picks) > g.max_select:
            raise HTTPException(422, f"Pick at most {g.max_select} for {g.name.lower()}")
        out += [{"group": g.name, "name": o.name, "price": money(o.price)} for o in picks]
    return out


@router.post("/orders/{oid}/items")
def add_item(oid: str, body: AddItemIn, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    m = db.scalar(select(MenuItem).where(MenuItem.id == body.menu_item_id, MenuItem.tenant_id == ctx.tenant_id))
    if not m:
        raise HTTPException(404, "Menu item not found")
    if not m.available:
        raise HTTPException(409, f"{m.name} is out of stock")
    mods = resolve_modifiers(db, ctx, m, body.modifier_ids)
    unit = m.price + sum((Decimal(str(x["price"])) for x in mods), Decimal(0))
    note = body.note.strip()
    line = next((i for i in o.items if i.menu_item_id == m.id and i.kot_id is None and not i.comp_reason
                 and i.note == note and (i.modifiers or []) == mods), None)
    if line:
        line.qty += body.qty
    else:
        o.items.append(OrderItem(tenant_id=ctx.tenant_id, menu_item_id=m.id, name=m.name, unit_price=unit,
                                 qty=body.qty, note=note, modifiers=mods))
    return save(db, ctx, o)


class LinePatch(BaseModel):
    qty: int | None = Field(default=None, ge=0, le=99)
    note: str | None = Field(default=None, max_length=200)


@router.patch("/orders/{oid}/items/{item_id}")
def edit_line(oid: str, item_id: str, body: LinePatch, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    line = next((i for i in o.items if i.id == item_id), None)
    if not line:
        raise HTTPException(404, "Line not found")
    if line.kot_id is not None and "pay" not in PERMISSIONS[ctx.user.role]:
        raise HTTPException(403, "Only a cashier or manager can change items already sent to the kitchen")
    if body.note is not None:
        if line.kot_id is not None:
            raise HTTPException(409, "This item is already in the kitchen")
        line.note = body.note.strip()
    if body.qty is not None:
        if body.qty == 0:
            o.items.remove(line)
        else:
            line.qty = body.qty
    return save(db, ctx, o)


class CompIn(BaseModel):
    reason: str = Field(default="", max_length=120)


@router.post("/orders/{oid}/items/{item_id}/comp")
def comp_line(oid: str, item_id: str, body: CompIn, ctx: Ctx = Depends(require("discount")), db: Session = Depends(get_db)):
    """Comp (make free) a line with a reason; an empty reason removes the comp."""
    o = open_order(db, ctx, oid)
    line = next((i for i in o.items if i.id == item_id), None)
    if not line:
        raise HTTPException(404, "Line not found")
    line.comp_reason = body.reason.strip()
    recompute(o, ctx.tenant.tax_rate)
    if balance(o) < 0:
        raise HTTPException(409, "This check is already partly paid. Refund first.")
    return save(db, ctx, o)


class DiscountIn(BaseModel):
    kind: str = Field(pattern=r"^(|percent|amount)$")
    value: float = Field(default=0, ge=0, le=1_000_000)
    reason: str = Field(default="", max_length=120)


@router.post("/orders/{oid}/discount")
def discount(oid: str, body: DiscountIn, ctx: Ctx = Depends(require("discount")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    if body.kind == "percent" and body.value > 100:
        raise HTTPException(422, "A discount can't be more than 100%")
    if body.kind and not body.reason.strip():
        raise HTTPException(422, "Pick a reason for the discount")
    o.discount_kind = body.kind
    o.discount_value = Decimal(str(body.value)) if body.kind else Decimal(0)
    o.discount_reason = body.reason.strip() if body.kind else ""
    recompute(o, ctx.tenant.tax_rate)
    if balance(o) < 0:
        raise HTTPException(409, "This check is already partly paid. Refund first.")
    return save(db, ctx, o)


# ---------- Move & merge ----------

class MoveIn(BaseModel):
    table_id: str


@router.post("/orders/{oid}/move")
def move(oid: str, body: MoveIn, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    t = db.scalar(select(DiningTable).where(DiningTable.id == body.table_id, DiningTable.tenant_id == ctx.tenant_id))
    if not t:
        raise HTTPException(404, "Table not found")
    if db.scalar(select(Order.id).where(Order.tenant_id == ctx.tenant_id, Order.table_id == t.id, Order.status == "open")):
        raise HTTPException(409, f"{t.name} already has an open check. Merge instead.")
    if o.channel not in ("dine_in", "takeaway"):
        raise HTTPException(409, "Online orders can't be seated")
    o.table_id, o.channel = t.id, "dine_in"
    db.commit()
    db.expire(o)  # sessions don't expire on commit; reload the table relationship
    return order_out(load_order(db, ctx, oid))


class MergeIn(BaseModel):
    source_order_id: str


@router.post("/orders/{oid}/merge")
def merge(oid: str, body: MergeIn, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    """Bring every item from another open check onto this one."""
    o = open_order(db, ctx, oid)
    src = open_order(db, ctx, body.source_order_id)
    if src.id == o.id:
        raise HTTPException(422, "Pick a different check")
    if src.paid or o.paid:
        raise HTTPException(409, "Checks with payments can't be merged")
    db.execute(update(OrderItem).where(OrderItem.order_id == src.id).values(order_id=o.id))
    db.execute(update(Kot).where(Kot.order_id == src.id).values(order_id=o.id))
    o.guests = (o.guests or 0) + (src.guests or 0)
    src.status, src.closed_at, src.void_reason = "merged", now(), f"Merged into #{o.number}"
    db.commit()
    db.expire_all()
    o = load_order(db, ctx, oid)
    return save(db, ctx, o)


# ---------- Kitchen tickets ----------

@router.post("/orders/{oid}/kot")
def send_kot(oid: str, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    pending = [i for i in o.items if i.kot_id is None]
    if not pending:
        raise HTTPException(409, "Nothing new to send")
    k = Kot(tenant_id=ctx.tenant_id, order_id=o.id, number=next_number(db, Kot, ctx.tenant_id))
    db.add(k)
    db.flush()
    for i in pending:
        i.kot_id = k.id
    db.commit()
    return {"kot_number": k.number, "created_at": k.created_at.isoformat(),
            "items": [{"name": i.name, "qty": i.qty, "note": i.note, "modifiers": i.modifiers or []} for i in pending],
            "order": order_out(load_order(db, ctx, oid))}


# ---------- Payments, voids, refunds ----------

class PaymentIn(BaseModel):
    method: str = Field(pattern=METHODS)
    amount: float = Field(gt=0, le=10_000_000)
    tip: float = Field(default=0, ge=0, le=1_000_000)
    tendered: float = Field(default=0, ge=0, le=10_000_000)
    line_ids: list[str] = Field(default_factory=list, max_length=200)


def take_payment(db: Session, ctx: Ctx, o: Order, body: PaymentIn) -> dict:
    if o.status != "open":
        raise HTTPException(409, "This check is already closed")
    if not o.items:
        raise HTTPException(409, "Nothing to pay for")
    if balance(o) <= CENT / 2:  # fully comped or discounted: nothing to collect, just close it
        o.status, o.closed_at, o.payment_method = "paid", now(), o.payment_method or "comp"
        db.commit()
        return {**order_out(load_order(db, ctx, o.id)), "change": 0}
    amount = q(Decimal(str(body.amount)))
    if amount > balance(o) + CENT / 2:
        raise HTTPException(409, "That's more than the balance due")
    tip = q(Decimal(str(body.tip))) if ctx.tenant.tips_enabled else Decimal(0)
    tendered, change = q(Decimal(str(body.tendered))), Decimal(0)
    if body.method == "cash" and tendered:
        if tendered < amount + tip:
            raise HTTPException(422, "Cash received is less than the amount")
        change = tendered - amount - tip
    valid_lines = {i.id for i in o.items}
    o.payments.append(Payment(tenant_id=ctx.tenant_id, order_id=o.id, kind="payment", method=body.method, amount=amount, tip=tip,
                              tendered=tendered, change=change, user_id=ctx.user.id,
                              line_ids=[x for x in body.line_ids if x in valid_lines]))
    o.paid = Decimal(o.paid or 0) + amount
    recompute(o, ctx.tenant.tax_rate)
    if balance(o) <= CENT / 2:
        methods = {p.method for p in o.payments if p.kind == "payment"}
        o.status, o.closed_at = "paid", now()
        o.payment_method = methods.pop() if len(methods) == 1 else "split"
    db.commit()
    out = order_out(load_order(db, ctx, o.id))
    out["change"] = money(change)
    return out


@router.post("/orders/{oid}/payments")
def add_payment(oid: str, body: PaymentIn, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    return take_payment(db, ctx, load_order(db, ctx, oid), body)


class PayIn(BaseModel):
    method: str = Field(pattern=METHODS)
    tip: float = Field(default=0, ge=0)


@router.post("/orders/{oid}/pay")
def pay(oid: str, body: PayIn, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    """Pay the whole remaining balance with one method."""
    o = load_order(db, ctx, oid)
    return take_payment(db, ctx, o, PaymentIn(method=body.method, amount=max(money(balance(o)), 0.01), tip=body.tip))


class VoidIn(BaseModel):
    reason: str = Field(default="", max_length=200)


@router.post("/orders/{oid}/void")
def void(oid: str, body: VoidIn | None = None, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if o.status not in ("open", "new"):
        raise HTTPException(409, "Only open checks can be voided. Use a refund instead.")
    if o.paid:
        raise HTTPException(409, "This check has payments. Refund them first.")
    if any(i.kot_id for i in o.items) and ctx.user.role not in ("owner", "manager"):
        raise HTTPException(403, "A manager must void checks with fired items")
    o.status, o.closed_at, o.void_reason = "void", now(), (body.reason.strip() if body else "")
    db.commit()
    return {"ok": True}


@router.post("/orders/{oid}/reopen")
def reopen(oid: str, ctx: Ctx = Depends(require("refund")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if o.status != "paid" or o.refunded:
        raise HTTPException(409, "Only paid checks without refunds can be reopened")
    if o.table_id and db.scalar(select(Order.id).where(Order.tenant_id == ctx.tenant_id, Order.table_id == o.table_id,
                                                       Order.status == "open")):
        raise HTTPException(409, "That table already has a new open check")
    o.status, o.closed_at = "open", None
    db.commit()
    return order_out(load_order(db, ctx, oid))


class RefundIn(BaseModel):
    amount: float = Field(gt=0, le=10_000_000)
    method: str = Field(pattern=METHODS)
    reason: str = Field(min_length=2, max_length=200)


@router.post("/orders/{oid}/refund")
def refund(oid: str, body: RefundIn, ctx: Ctx = Depends(require("refund")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if o.status not in ("paid", "refunded"):
        raise HTTPException(409, "Only paid checks can be refunded")
    amount = q(Decimal(str(body.amount)))
    collected = Decimal(o.paid or 0) + Decimal(o.tip or 0)
    if amount > collected - Decimal(o.refunded or 0) + CENT / 2:
        raise HTTPException(409, "That's more than what's left to refund")
    o.payments.append(Payment(tenant_id=ctx.tenant_id, order_id=o.id, kind="refund", method=body.method,
                              amount=amount, reason=body.reason.strip(), user_id=ctx.user.id))
    o.refunded = Decimal(o.refunded or 0) + amount
    if o.refunded >= collected - CENT / 2:
        o.status = "refunded"
    db.commit()
    return order_out(load_order(db, ctx, oid))


# ---------- Kitchen display ----------

def kds_title(o: Order) -> str:
    if o.table:
        return f"{o.table.name} · Dine-in"
    if o.channel == "takeaway":
        return f"Takeaway · #{o.number}" + (f" · {o.customer_name}" if o.customer_name else "")
    return f"{o.channel.title()} · #{o.number}"


@router.get("/kds")
def kds(ctx: Ctx = Depends(require("kds")), db: Session = Depends(get_db)):
    ks = db.scalars(select(Kot).where(Kot.tenant_id == ctx.tenant_id, Kot.bumped.is_(False))
                    .options(selectinload(Kot.items), selectinload(Kot.order).selectinload(Order.table))
                    .order_by(Kot.created_at)).all()
    return [{
        "id": k.id, "number": k.number, "created_at": k.created_at.isoformat(), "title": kds_title(k.order),
        "channel": k.order.channel,
        "items": [{"id": i.id, "name": i.name, "qty": i.qty, "note": i.note, "done": i.done,
                   "modifiers": [m["name"] for m in (i.modifiers or [])]} for i in k.items],
    } for k in ks if k.order.status not in ("void", "merged")]


@router.post("/kds/items/{item_id}/toggle")
def toggle_item(item_id: str, ctx: Ctx = Depends(require("kds")), db: Session = Depends(get_db)):
    i = db.scalar(select(OrderItem).where(OrderItem.id == item_id, OrderItem.tenant_id == ctx.tenant_id))
    if not i:
        raise HTTPException(404, "Item not found")
    i.done = not i.done
    db.commit()
    return {"done": i.done}


@router.post("/kds/{kot_id}/bump")
def bump(kot_id: str, ctx: Ctx = Depends(require("kds")), db: Session = Depends(get_db)):
    k = db.scalar(select(Kot).where(Kot.id == kot_id, Kot.tenant_id == ctx.tenant_id).options(selectinload(Kot.items)))
    if not k:
        raise HTTPException(404, "Ticket not found")
    k.bumped = True
    for i in k.items:
        i.done = True
    db.commit()
    return {"ok": True}


# ---------- Online orders (aggregators / website) ----------

@router.get("/online")
def online(ctx: Ctx = Depends(require("online")), db: Session = Depends(get_db)):
    os_ = db.scalars(select(Order).where(Order.tenant_id == ctx.tenant_id, Order.channel.in_(ONLINE_CHANNELS),
                                         Order.status.in_(("new", "open")))
                     .options(selectinload(Order.items), selectinload(Order.payments), selectinload(Order.table))
                     .order_by(Order.opened_at.desc())).all()
    return [order_out(o) for o in os_]


class OnlineIn(BaseModel):
    channel: str
    customer_name: str = ""
    items: list[AddItemIn]


@router.post("/online/inbound", status_code=201)
def inbound(body: OnlineIn, ctx: Ctx = Depends(require("online")), db: Session = Depends(get_db)):
    """Ingest an aggregator order. Real delivery-partner webhooks map onto this."""
    if body.channel not in ONLINE_CHANNELS:
        raise HTTPException(422, "Unknown channel")
    o = Order(tenant_id=ctx.tenant_id, number=next_number(db, Order, ctx.tenant_id), channel=body.channel,
              status="new", customer_name=body.customer_name)
    db.add(o)
    for it in body.items:
        m = db.scalar(select(MenuItem).where(MenuItem.id == it.menu_item_id, MenuItem.tenant_id == ctx.tenant_id))
        if m:
            o.items.append(OrderItem(tenant_id=ctx.tenant_id, menu_item_id=m.id, name=m.name, unit_price=m.price,
                                     qty=it.qty, modifiers=[]))
    return save(db, ctx, o)


@router.post("/online/{oid}/accept")
def accept(oid: str, ctx: Ctx = Depends(require("online")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if o.status != "new":
        raise HTTPException(409, "Already handled")
    o.status = "open"
    db.flush()
    k = Kot(tenant_id=ctx.tenant_id, order_id=o.id, number=next_number(db, Kot, ctx.tenant_id))
    db.add(k)
    db.flush()
    for i in o.items:
        i.kot_id = k.id
    db.commit()
    return order_out(load_order(db, ctx, oid))


@router.post("/online/{oid}/reject")
def reject_online(oid: str, ctx: Ctx = Depends(require("online")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if o.status != "new":
        raise HTTPException(409, "Already handled")
    o.status, o.closed_at = "rejected", now()
    db.commit()
    return {"ok": True}


@router.post("/online/{oid}/complete")
def complete_online(oid: str, ctx: Ctx = Depends(require("online")), db: Session = Depends(get_db)):
    """Handed to the rider: the partner already collected payment, so settle the check as paid online."""
    o = load_order(db, ctx, oid)
    if o.channel not in ONLINE_CHANNELS:
        raise HTTPException(409, "Not an online order")
    return take_payment(db, ctx, o, PaymentIn(method="online", amount=max(money(balance(o)), 0.01)))
