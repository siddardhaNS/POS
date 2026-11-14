"""Stock transfers between locations of one business. Needs the inventory module at both ends.

Items are matched across locations by name; a destination that doesn't stock the item yet gets it created
(same unit and category) when it receives."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Ctx, has_module, needs
from ..live import audit
from ..models import AuditLog, StockItem, StockTransfer, Tenant
from ..stock import D, apply_movement, compatible, from_base, sync_auto86, to_base
from .inventory import MANAGE, q3
from .pos import money

router = APIRouter(prefix="/inventory", tags=["transfers"], dependencies=[Depends(needs("inventory"))])


def label(t: Tenant | None) -> str:
    return (t.location_name or t.name) if t else "Removed location"


def transfer_out(x: StockTransfer, names: dict[str, Tenant], here: str) -> dict:
    value = sum((D(ln["qty"]) * D(ln["unit_cost"]) for ln in x.lines), Decimal(0))
    return {"id": x.id, "number": x.number, "status": x.status, "direction": "out" if x.from_tenant_id == here else "in",
            "from_id": x.from_tenant_id, "from": label(names.get(x.from_tenant_id)), "to_id": x.to_tenant_id,
            "to": label(names.get(x.to_tenant_id)), "note": x.note, "sent_by": x.sent_by, "received_by": x.received_by,
            "sent_at": x.sent_at.isoformat(), "received_at": x.received_at.isoformat() if x.received_at else None,
            "value": money(value),
            "lines": [{"i": k, "name": ln["name"], "unit": ln["unit"], "qty": q3(from_base(ln["qty"], ln["unit"])),
                       "received": q3(from_base(ln.get("received", 0), ln["unit"])) if x.status == "received" else None,
                       "cost": money(D(ln["unit_cost"]) * D(ln["qty"]))} for k, ln in enumerate(x.lines)]}


def brand_sites(db: Session, ctx: Ctx) -> dict[str, Tenant]:
    if not ctx.tenant.brand_id:
        return {ctx.tenant_id: ctx.tenant}
    return {t.id: t for t in db.scalars(select(Tenant).where(Tenant.brand_id == ctx.tenant.brand_id))}


@router.get("/transfers")
def list_transfers(ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    sites = brand_sites(db, ctx)
    rows = db.scalars(select(StockTransfer).where(or_(StockTransfer.from_tenant_id == ctx.tenant_id,
                                                      StockTransfer.to_tenant_id == ctx.tenant_id))
                      .order_by(StockTransfer.sent_at.desc()).limit(200)).all()
    return {"locations": [{"id": t.id, "name": label(t), "inventory": has_module(t, "inventory")}
                          for t in sites.values() if t.id != ctx.tenant_id],
            "transfers": [transfer_out(x, sites, ctx.tenant_id) for x in rows]}


class LineIn(BaseModel):
    stock_item_id: str = Field(max_length=36)
    qty: float = Field(gt=0, le=1e9)
    unit: str | None = Field(default=None, max_length=10)


class TransferIn(BaseModel):
    to_tenant_id: str = Field(max_length=36)
    lines: list[LineIn] = Field(min_length=1, max_length=100)
    note: str = Field(default="", max_length=300)


@router.post("/transfers", status_code=201)
def send(body: TransferIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    if not ctx.tenant.brand_id:
        raise HTTPException(409, "Transfers need a second location. Add one under Locations.")
    dst = db.get(Tenant, body.to_tenant_id)
    if dst is None or dst.brand_id != ctx.tenant.brand_id or dst.id == ctx.tenant_id:
        raise HTTPException(404, "Location not found")
    if not has_module(dst, "inventory"):
        raise HTTPException(409, f"{label(dst)} doesn't have inventory turned on")
    lines, touched = [], set()
    for ln in body.lines:
        s = db.scalar(select(StockItem).where(StockItem.id == ln.stock_item_id, StockItem.tenant_id == ctx.tenant_id))
        if not s:
            raise HTTPException(404, "Stock item not found")
        unit = ln.unit or s.unit
        if not compatible(unit, s.unit):
            raise HTTPException(422, f"{s.name} is counted in {s.unit}")
        qty = to_base(ln.qty, unit)
        if qty > D(s.on_hand):
            raise HTTPException(409, f"Only {q3(from_base(s.on_hand, s.unit))} {s.unit} of {s.name} on hand")
        lines.append({"name": s.name, "unit": s.unit, "category": s.category, "qty": str(qty), "unit_cost": str(D(s.avg_cost)),
                      "from_item_id": s.id, "to_item_id": None, "received": "0"})
        touched.add(s.id)
    n = (db.scalar(select(func.max(StockTransfer.number)).where(StockTransfer.brand_id == ctx.tenant.brand_id)) or 0) + 1
    x = StockTransfer(brand_id=ctx.tenant.brand_id, number=n, from_tenant_id=ctx.tenant_id, to_tenant_id=dst.id, lines=lines,
                      note=body.note.strip(), sent_by=ctx.user.name)
    db.add(x)
    db.flush()
    for ln in lines:
        s = db.get(StockItem, ln["from_item_id"])
        apply_movement(db, s, "transfer_out", -D(ln["qty"]), user_id=ctx.user.id, ref_id=x.id,
                       reason=f"Transfer {n} to {label(dst)}")
    value = sum((D(ln["qty"]) * D(ln["unit_cost"]) for ln in lines), Decimal(0))
    audit(db, ctx, "stock_transfer", amount=value, detail=f"Transfer {n} sent to {label(dst)}")
    sync_auto86(db, ctx.tenant_id, touched)
    db.commit()
    return transfer_out(x, brand_sites(db, ctx), ctx.tenant_id)


def own(db: Session, ctx: Ctx, xid: str) -> StockTransfer:
    x = db.get(StockTransfer, xid)
    if x is None or ctx.tenant_id not in (x.from_tenant_id, x.to_tenant_id):
        raise HTTPException(404, "Transfer not found")
    return x


class ReceiveIn(BaseModel):
    received: list[float] = Field(default_factory=list, max_length=100)  # per line in its unit; empty = all of it


@router.post("/transfers/{xid}/receive")
def receive(xid: str, body: ReceiveIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    x = own(db, ctx, xid)
    if x.to_tenant_id != ctx.tenant_id:
        raise HTTPException(403, "Only the receiving location can receive this")
    if x.status != "sent":
        raise HTTPException(409, f"This transfer is {x.status}")
    src = db.get(Tenant, x.from_tenant_id)
    lines, touched, short = [], set(), []
    for k, ln in enumerate(x.lines):
        got = to_base(body.received[k], ln["unit"]) if k < len(body.received) else D(ln["qty"])
        if got < 0 or got > D(ln["qty"]):
            raise HTTPException(422, f"{ln['name']}: received can't be more than was sent")
        it = db.scalar(select(StockItem).where(StockItem.tenant_id == ctx.tenant_id, func.lower(StockItem.name) == ln["name"].lower()))
        if it is None:
            it = StockItem(tenant_id=ctx.tenant_id, name=ln["name"], unit=ln["unit"], category=ln.get("category", ""),
                           on_hand=Decimal(0), avg_cost=D(ln["unit_cost"]))
            db.add(it)
            db.flush()
        elif not compatible(it.unit, ln["unit"]):
            raise HTTPException(409, f"{it.name} here is counted in {it.unit}, not {ln['unit']}")
        if got > 0:
            apply_movement(db, it, "transfer_in", got, unit_cost=D(ln["unit_cost"]), user_id=ctx.user.id, ref_id=x.id,
                           reason=f"Transfer {x.number} from {label(src)}")
            touched.add(it.id)
        if got < D(ln["qty"]):
            short.append(f"{q3(from_base(D(ln['qty']) - got, ln['unit']))} {ln['unit']} {ln['name']}")
        lines.append({**ln, "to_item_id": it.id, "received": str(got)})
    x.lines, x.status, x.received_at, x.received_by = lines, "received", func.now(), ctx.user.name
    audit(db, ctx, "stock_transfer", detail=f"Transfer {x.number} received from {label(src)}"
          + (f" · short: {', '.join(short)}" if short else ""))
    if short and src is not None:  # tell the sender what didn't arrive
        db.add(AuditLog(tenant_id=src.id, user_id=ctx.user.id, user_name=ctx.user.name, action="stock_transfer",
                        detail=f"Transfer {x.number} arrived short at {label(ctx.tenant)}: {', '.join(short)}"))
    sync_auto86(db, ctx.tenant_id, touched)
    db.commit()
    db.refresh(x)
    return transfer_out(x, brand_sites(db, ctx), ctx.tenant_id)


@router.post("/transfers/{xid}/cancel")
def cancel(xid: str, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    """Call back a transfer that hasn't been received: the stock goes back to the sender."""
    x = own(db, ctx, xid)
    if x.from_tenant_id != ctx.tenant_id:
        raise HTTPException(403, "Only the sending location can cancel this")
    if x.status != "sent":
        raise HTTPException(409, f"This transfer is {x.status}")
    touched = set()
    for ln in x.lines:
        s = db.scalar(select(StockItem).where(StockItem.id == ln["from_item_id"], StockItem.tenant_id == ctx.tenant_id))
        if s:
            apply_movement(db, s, "transfer_in", D(ln["qty"]), unit_cost=D(ln["unit_cost"]), user_id=ctx.user.id, ref_id=x.id,
                           reason=f"Transfer {x.number} cancelled")
            touched.add(s.id)
    x.status = "cancelled"
    audit(db, ctx, "stock_transfer", detail=f"Transfer {x.number} cancelled")
    sync_auto86(db, ctx.tenant_id, touched)
    db.commit()
    return transfer_out(x, brand_sites(db, ctx), ctx.tenant_id)
