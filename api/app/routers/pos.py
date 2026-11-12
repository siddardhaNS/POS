"""Service-side endpoints: floor, orders, KOTs, kitchen display, online orders, payments."""
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import PERMISSIONS, Ctx, require
from ..models import DiningTable, Kot, MenuItem, Order, OrderItem, now

router = APIRouter(tags=["pos"])
CENT = Decimal("0.01")
ONLINE_CHANNELS = {"swiggy", "zomato", "doordash", "ubereats", "website"}


def money(v: Decimal) -> float:
    return float(Decimal(v or 0).quantize(CENT, ROUND_HALF_UP))


def recompute(o: Order, tax_rate: Decimal) -> None:
    sub = sum((i.unit_price * i.qty for i in o.items), Decimal(0))
    o.subtotal = sub.quantize(CENT, ROUND_HALF_UP)
    o.tax = (sub * tax_rate).quantize(CENT, ROUND_HALF_UP)
    o.total = o.subtotal + o.tax + (o.tip or 0)


def order_out(o: Order) -> dict:
    return {
        "id": o.id, "number": o.number, "table_id": o.table_id, "table": o.table.name if o.table else None,
        "channel": o.channel, "status": o.status, "customer_name": o.customer_name,
        "subtotal": money(o.subtotal), "tax": money(o.tax), "tip": money(o.tip), "total": money(o.total),
        "payment_method": o.payment_method, "opened_at": o.opened_at.isoformat(),
        "items": [{"id": i.id, "menu_item_id": i.menu_item_id, "name": i.name, "unit_price": money(i.unit_price),
                   "qty": i.qty, "note": i.note, "sent": i.kot_id is not None, "done": i.done} for i in o.items],
    }


def load_order(db: Session, ctx: Ctx, oid: str) -> Order:
    o = db.scalar(select(Order).where(Order.id == oid, Order.tenant_id == ctx.tenant_id)
                  .options(selectinload(Order.items), selectinload(Order.table)))
    if not o:
        raise HTTPException(404, "Order not found")
    return o


def next_number(db: Session, model, tenant_id: str) -> int:
    return (db.scalar(select(func.max(model.number)).where(model.tenant_id == tenant_id)) or 0) + 1


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
            "id": t.id, "name": t.name, "seats": t.seats, "state": state,
            "order_id": o.id if o else None, "total": money(o.total) if o else 0,
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


@router.get("/orders/{oid}")
def get_order(oid: str, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    return order_out(load_order(db, ctx, oid))


class AddItemIn(BaseModel):
    menu_item_id: str
    qty: int = Field(default=1, ge=1, le=99)
    note: str = Field(default="", max_length=200)


@router.post("/orders/{oid}/items")
def add_item(oid: str, body: AddItemIn, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if o.status != "open":
        raise HTTPException(409, "This check is closed")
    m = db.scalar(select(MenuItem).where(MenuItem.id == body.menu_item_id, MenuItem.tenant_id == ctx.tenant_id))
    if not m:
        raise HTTPException(404, "Menu item not found")
    if not m.available:
        raise HTTPException(409, f"{m.name} is out of stock")
    line = next((i for i in o.items if i.menu_item_id == m.id and i.kot_id is None and i.note == body.note), None)
    if line:
        line.qty += body.qty
    else:
        o.items.append(OrderItem(tenant_id=ctx.tenant_id, menu_item_id=m.id, name=m.name,
                                 unit_price=m.price, qty=body.qty, note=body.note))
    db.flush()
    recompute(o, ctx.tenant.tax_rate)
    db.commit()
    return order_out(load_order(db, ctx, oid))


class QtyIn(BaseModel):
    qty: int = Field(ge=0, le=99)


@router.patch("/orders/{oid}/items/{item_id}")
def set_qty(oid: str, item_id: str, body: QtyIn, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    line = next((i for i in o.items if i.id == item_id), None)
    if not line:
        raise HTTPException(404, "Line not found")
    if line.kot_id is not None and "pay" not in PERMISSIONS[ctx.user.role]:
        raise HTTPException(403, "Only a cashier or manager can change items already sent to the kitchen")
    if body.qty == 0:
        o.items.remove(line)
    else:
        line.qty = body.qty
    db.flush()
    recompute(o, ctx.tenant.tax_rate)
    db.commit()
    return order_out(load_order(db, ctx, oid))


@router.post("/orders/{oid}/kot")
def send_kot(oid: str, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    pending = [i for i in o.items if i.kot_id is None]
    if not pending:
        raise HTTPException(409, "Nothing new to send")
    k = Kot(tenant_id=ctx.tenant_id, order_id=o.id, number=next_number(db, Kot, ctx.tenant_id))
    db.add(k)
    db.flush()
    for i in pending:
        i.kot_id = k.id
    db.commit()
    return {"kot_number": k.number, "order": order_out(load_order(db, ctx, oid))}


class PayIn(BaseModel):
    method: str = Field(pattern=r"^(upi|card|cash|tap)$")
    tip: float = Field(default=0, ge=0)


@router.post("/orders/{oid}/pay")
def pay(oid: str, body: PayIn, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if o.status != "open":
        raise HTTPException(409, "This check is already closed")
    if not o.items:
        raise HTTPException(409, "Nothing to pay for")
    o.tip = Decimal(str(body.tip)).quantize(CENT) if ctx.tenant.market == "US" else Decimal(0)
    recompute(o, ctx.tenant.tax_rate)
    o.status, o.payment_method, o.closed_at = "paid", body.method, now()
    db.commit()
    return order_out(o)


@router.post("/orders/{oid}/void")
def void(oid: str, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    if any(i.kot_id for i in o.items) and ctx.user.role not in ("owner", "manager"):
        raise HTTPException(403, "A manager must void checks with fired items")
    o.status, o.closed_at = "void", now()
    db.commit()
    return {"ok": True}


# ---------- Kitchen display ----------

@router.get("/kds")
def kds(ctx: Ctx = Depends(require("kds")), db: Session = Depends(get_db)):
    ks = db.scalars(select(Kot).where(Kot.tenant_id == ctx.tenant_id, Kot.bumped.is_(False))
                    .options(selectinload(Kot.items), selectinload(Kot.order).selectinload(Order.table))
                    .order_by(Kot.created_at)).all()
    labels = {"dine_in": "Dine-in", "takeaway": "Takeaway"}
    return [{
        "id": k.id, "number": k.number, "created_at": k.created_at.isoformat(),
        "title": f"{k.order.table.name} · Dine-in" if k.order.table else f"{labels.get(k.order.channel, k.order.channel.title())} · #{k.order.number}",
        "channel": k.order.channel,
        "items": [{"id": i.id, "name": i.name, "qty": i.qty, "note": i.note, "done": i.done} for i in k.items],
    } for k in ks]


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
                     .options(selectinload(Order.items), selectinload(Order.table)).order_by(Order.opened_at.desc())).all()
    return [order_out(o) for o in os_]


class OnlineIn(BaseModel):
    channel: str
    customer_name: str = ""
    items: list[AddItemIn]


@router.post("/online/inbound", status_code=201)
def inbound(body: OnlineIn, ctx: Ctx = Depends(require("online")), db: Session = Depends(get_db)):
    """Ingest an aggregator order. Real Swiggy/Zomato/DoorDash/Uber Eats webhooks map onto this."""
    if body.channel not in ONLINE_CHANNELS:
        raise HTTPException(422, "Unknown channel")
    o = Order(tenant_id=ctx.tenant_id, number=next_number(db, Order, ctx.tenant_id), channel=body.channel,
              status="new", customer_name=body.customer_name)
    db.add(o)
    for it in body.items:
        m = db.scalar(select(MenuItem).where(MenuItem.id == it.menu_item_id, MenuItem.tenant_id == ctx.tenant_id))
        if m:
            o.items.append(OrderItem(tenant_id=ctx.tenant_id, menu_item_id=m.id, name=m.name, unit_price=m.price, qty=it.qty))
    db.flush()
    recompute(o, ctx.tenant.tax_rate)
    db.commit()
    return order_out(load_order(db, ctx, o.id))


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
