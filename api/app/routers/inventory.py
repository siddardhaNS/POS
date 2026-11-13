"""Inventory: stock items, receiving / waste / adjustments, recipes and food cost, suppliers, purchase orders,
stock counts and inventory reports. Optional module "inventory".

Quantities and costs go over the API in each stock item's display unit (kg, l, dozen...); the ledger stores
base units (g, ml, pc). Stock only changes through movements (see app/stock.py).
"""
from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import PERMISSIONS, Ctx, needs, tenant_user
from ..live import audit
from ..models import (MenuCategory, MenuItem, ModifierGroup, PurchaseOrder, PurchaseOrderLine, RecipeLine, StockCount,
                      StockItem, StockMovement, Supplier, User, now)
from ..stock import (D, UNIT_PATTERN, UNITS, apply_movement, compatible, factor, from_base, sync_auto86, to_base)
from .pos import money
from .reports import period as report_period, sales_overview

router = APIRouter(prefix="/inventory", tags=["inventory"], dependencies=[Depends(needs("inventory"))])


def allow(*perms: str):
    """Any of these permissions (e.g. chefs may record waste without managing inventory)."""
    def dep(ctx: Ctx = Depends(tenant_user)) -> Ctx:
        if not set(perms) & PERMISSIONS.get(ctx.user.role, set()):
            raise HTTPException(403, "Your role can't do that in inventory")
        return ctx
    return dep


MANAGE = allow("inventory")
VIEW = allow("inventory", "inventory_waste")


def q3(v: Decimal) -> float:
    return float(D(v).quantize(Decimal("0.001")))


# ---------- Stock items ----------

def item_out(i: StockItem, suppliers: dict[str, str] | None = None, recipes: int = 0) -> dict:
    f = factor(i.unit)
    on_hand, par, cost = from_base(i.on_hand, i.unit), from_base(i.par_level, i.unit), D(i.avg_cost) * f
    return {
        "id": i.id, "name": i.name, "category": i.category, "unit": i.unit, "on_hand": q3(on_hand), "par_level": q3(par),
        "cost": money(cost), "value": money(D(i.on_hand) * D(i.avg_cost)), "low": D(i.on_hand) <= D(i.par_level),
        "out": D(i.on_hand) <= 0, "supplier_id": i.supplier_id, "supplier": (suppliers or {}).get(i.supplier_id or "", ""),
        "active": i.active, "recipes": recipes,
    }


def get_item(db: Session, ctx: Ctx, iid: str) -> StockItem:
    i = db.scalar(select(StockItem).where(StockItem.id == iid, StockItem.tenant_id == ctx.tenant_id))
    if not i:
        raise HTTPException(404, "Stock item not found")
    return i


def supplier_names(db: Session, ctx: Ctx) -> dict[str, str]:
    return dict(db.execute(select(Supplier.id, Supplier.name).where(Supplier.tenant_id == ctx.tenant_id)).all())


@router.get("/units")
def units():
    return [{"unit": u, "base": b} for u, (b, _) in UNITS.items()]


@router.get("/items")
def list_items(all: bool = False, ctx: Ctx = Depends(VIEW), db: Session = Depends(get_db)):
    q = select(StockItem).where(StockItem.tenant_id == ctx.tenant_id)
    if not all:
        q = q.where(StockItem.active.is_(True))
    used = dict(db.execute(select(RecipeLine.stock_item_id, func.count(func.distinct(RecipeLine.menu_item_id)))
                           .where(RecipeLine.tenant_id == ctx.tenant_id).group_by(RecipeLine.stock_item_id)).all())
    names = supplier_names(db, ctx)
    items = db.scalars(q.order_by(StockItem.category, StockItem.name)).all()
    out = [item_out(i, names, used.get(i.id, 0)) for i in items]
    return {"items": out, "value": round(sum(i["value"] for i in out if i["active"]), 2),
            "low": sum(1 for i in out if i["active"] and i["low"]), "auto_86": ctx.tenant.inventory_auto_86}


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    category: str = Field(default="", max_length=80)
    unit: str = Field(default="kg", pattern=UNIT_PATTERN)
    par_level: float = Field(default=0, ge=0, le=1e9)
    cost: float = Field(default=0, ge=0, le=1e9)  # per display unit
    on_hand: float = Field(default=0, ge=0, le=1e9)  # opening stock (new items only)
    supplier_id: str | None = Field(default=None, max_length=36)


class ItemPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    category: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, pattern=UNIT_PATTERN)
    par_level: float | None = Field(default=None, ge=0, le=1e9)
    cost: float | None = Field(default=None, ge=0, le=1e9)
    supplier_id: str | None = Field(default=None, max_length=36)
    active: bool | None = None


def check_supplier(db: Session, ctx: Ctx, sid: str | None) -> str | None:
    if not sid:
        return None
    if not db.scalar(select(Supplier.id).where(Supplier.id == sid, Supplier.tenant_id == ctx.tenant_id)):
        raise HTTPException(404, "Supplier not found")
    return sid


@router.post("/items", status_code=201)
def create_item(body: ItemIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    f = factor(body.unit)
    i = StockItem(tenant_id=ctx.tenant_id, name=body.name.strip(), category=body.category.strip(), unit=body.unit,
                  par_level=to_base(body.par_level, body.unit), avg_cost=(D(body.cost) / f).quantize(Decimal("0.000001")),
                  supplier_id=check_supplier(db, ctx, body.supplier_id), on_hand=Decimal(0))
    db.add(i)
    db.flush()
    if body.on_hand:
        apply_movement(db, i, "adjust", to_base(body.on_hand, body.unit), user_id=ctx.user.id, reason="Opening stock")
    db.commit()
    return item_out(i, supplier_names(db, ctx))


@router.patch("/items/{iid}")
def edit_item(iid: str, body: ItemPatch, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    i = get_item(db, ctx, iid)
    data = body.model_dump(exclude_unset=True)
    if "unit" in data and data["unit"] != i.unit:
        if not compatible(i.unit, data["unit"]):
            raise HTTPException(422, f"Can't switch {i.unit} to {data['unit']}: pick a unit of the same kind")
        i.unit = data["unit"]  # base quantities stay the same; only the display unit changes
    if "name" in data:
        i.name = data["name"].strip()
    if "category" in data:
        i.category = (data["category"] or "").strip()
    if data.get("par_level") is not None:
        i.par_level = to_base(data["par_level"], i.unit)
    if data.get("cost") is not None:
        i.avg_cost = (D(data["cost"]) / factor(i.unit)).quantize(Decimal("0.000001"))
    if "supplier_id" in data:
        i.supplier_id = check_supplier(db, ctx, data["supplier_id"])
    if data.get("active") is not None:
        i.active = data["active"]
    db.commit()
    return item_out(i, supplier_names(db, ctx))


class MoveIn(BaseModel):
    kind: str = Field(pattern=r"^(received|waste|adjust)$")
    qty: float = Field(gt=-1e9, lt=1e9)  # received / waste: positive amount; adjust: signed change
    unit: str | None = Field(default=None, pattern=UNIT_PATTERN)
    cost: float | None = Field(default=None, ge=0, le=1e9)  # received: per unit entered
    reason: str = Field(default="", max_length=200)


@router.post("/items/{iid}/movements", status_code=201)
def move(iid: str, body: MoveIn, ctx: Ctx = Depends(VIEW), db: Session = Depends(get_db)):
    perms = PERMISSIONS.get(ctx.user.role, set())
    if body.kind != "waste" and "inventory" not in perms:
        raise HTTPException(403, "Your role can only record waste")
    i = get_item(db, ctx, iid)
    unit = body.unit or i.unit
    if not compatible(unit, i.unit):
        raise HTTPException(422, f"{i.name} is counted in {i.unit}; use a unit of the same kind")
    if body.kind in ("received", "waste") and body.qty <= 0:
        raise HTTPException(422, "Enter a quantity above zero")
    if body.kind == "adjust" and not body.qty:
        raise HTTPException(422, "Enter the change, e.g. -2 or 5")
    if body.kind == "adjust" and not body.reason.strip():
        raise HTTPException(422, "Say why the stock is being adjusted")
    qty = to_base(abs(body.qty), unit)
    signed = qty if body.kind == "received" else -qty if body.kind == "waste" else to_base(body.qty, unit)
    cost = (D(body.cost) / factor(unit)) if body.kind == "received" and body.cost is not None else None
    m = apply_movement(db, i, body.kind, signed, unit_cost=cost, reason=body.reason.strip(), user_id=ctx.user.id)
    label = {"received": "stock_received", "waste": "stock_waste", "adjust": "stock_adjust"}[body.kind]
    audit(db, ctx, label, detail=f"{i.name}: {'+' if signed > 0 else ''}{q3(from_base(signed, i.unit))} {i.unit}"
          + (f" · {body.reason.strip()}" if body.reason.strip() else ""),
          amount=money(abs(D(m.qty)) * D(m.unit_cost)))
    sync_auto86(db, ctx.tenant_id, {i.id})
    db.commit()
    return item_out(i, supplier_names(db, ctx))


@router.get("/items/{iid}/movements")
def history(iid: str, ctx: Ctx = Depends(VIEW), db: Session = Depends(get_db)):
    i = get_item(db, ctx, iid)
    names = dict(db.execute(select(User.id, User.name).where(User.tenant_id == ctx.tenant_id)).all())
    rows = db.scalars(select(StockMovement).where(StockMovement.stock_item_id == i.id, StockMovement.tenant_id == ctx.tenant_id)
                      .order_by(StockMovement.created_at.desc()).limit(100)).all()
    return [{"id": m.id, "kind": m.kind, "qty": q3(from_base(m.qty, i.unit)), "unit": i.unit,
             "cost": money(D(m.unit_cost) * factor(i.unit)), "value": money(D(m.qty) * D(m.unit_cost)), "reason": m.reason,
             "user": names.get(m.user_id or "", ""), "created_at": m.created_at.isoformat()} for m in rows]


# ---------- Recipes & food cost ----------

def recipe_out(m: MenuItem, lines: list[RecipeLine], stock: dict[str, StockItem]) -> dict:
    base, opts = [], []
    cost = Decimal(0)
    for r in lines:
        s = stock.get(r.stock_item_id)
        if not s:
            continue
        line_cost = D(r.qty) * D(s.avg_cost)
        row = {"id": r.id, "stock_item_id": s.id, "stock_item": s.name, "qty": q3(from_base(r.qty, r.unit)), "unit": r.unit,
               "cost": money(line_cost), "modifier_group": r.modifier_group, "modifier_option": r.modifier_option}
        if r.modifier_option:
            opts.append(row)
        else:
            base.append(row)
            cost += line_cost
    price = D(m.price)
    return {"menu_item_id": m.id, "name": m.name, "price": money(price), "cost": money(cost),
            "food_cost_pct": round(float(cost / price * 100), 1) if price else 0.0, "lines": base, "option_lines": opts}


@router.get("/recipes")
def recipes(ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    items = db.execute(select(MenuItem, MenuCategory.name).join(MenuCategory, MenuCategory.id == MenuItem.category_id)
                       .where(MenuItem.tenant_id == ctx.tenant_id).order_by(MenuCategory.sort, MenuItem.sort)).all()
    lines: dict[str, list[RecipeLine]] = defaultdict(list)
    for r in db.scalars(select(RecipeLine).where(RecipeLine.tenant_id == ctx.tenant_id)):
        lines[r.menu_item_id].append(r)
    stock = {s.id: s for s in db.scalars(select(StockItem).where(StockItem.tenant_id == ctx.tenant_id))}
    groups: dict[str, list[dict]] = defaultdict(list)
    for g in db.scalars(select(ModifierGroup).where(ModifierGroup.tenant_id == ctx.tenant_id)
                        .options(selectinload(ModifierGroup.options)).order_by(ModifierGroup.sort)):
        groups[g.menu_item_id].append({"group": g.name, "options": [o.name for o in g.options]})
    return [{**recipe_out(m, lines.get(m.id, []), stock), "category": cat, "modifiers": groups.get(m.id, [])}
            for m, cat in items]


class RecipeLineIn(BaseModel):
    stock_item_id: str = Field(max_length=36)
    qty: float = Field(gt=0, le=1e6)
    unit: str = Field(pattern=UNIT_PATTERN)
    modifier_group: str = Field(default="", max_length=80)
    modifier_option: str = Field(default="", max_length=80)


class RecipeIn(BaseModel):
    lines: list[RecipeLineIn] = Field(default_factory=list, max_length=60)


@router.put("/recipes/{mid}")
def save_recipe(mid: str, body: RecipeIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    m = db.scalar(select(MenuItem).where(MenuItem.id == mid, MenuItem.tenant_id == ctx.tenant_id))
    if not m:
        raise HTTPException(404, "Menu item not found")
    stock = {s.id: s for s in db.scalars(select(StockItem).where(StockItem.tenant_id == ctx.tenant_id))}
    for old in db.scalars(select(RecipeLine).where(RecipeLine.menu_item_id == m.id, RecipeLine.tenant_id == ctx.tenant_id)):
        db.delete(old)
    for ln in body.lines:
        s = stock.get(ln.stock_item_id)
        if not s:
            raise HTTPException(404, "Stock item not found")
        if not compatible(ln.unit, s.unit):
            raise HTTPException(422, f"{s.name} is measured in {s.unit}; use a unit of the same kind")
        db.add(RecipeLine(tenant_id=ctx.tenant_id, menu_item_id=m.id, stock_item_id=s.id, qty=to_base(ln.qty, ln.unit),
                          unit=ln.unit, modifier_group=ln.modifier_group.strip() if ln.modifier_option else "",
                          modifier_option=ln.modifier_option.strip()))
    db.flush()
    sync_auto86(db, ctx.tenant_id, None)
    db.commit()
    lines = list(db.scalars(select(RecipeLine).where(RecipeLine.menu_item_id == m.id, RecipeLine.tenant_id == ctx.tenant_id)))
    return recipe_out(m, lines, stock)


# ---------- Suppliers ----------

def supplier_out(s: Supplier) -> dict:
    return {"id": s.id, "name": s.name, "phone": s.phone, "email": s.email, "notes": s.notes, "active": s.active}


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)
    active: bool = True


@router.get("/suppliers")
def suppliers(ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    return [supplier_out(s) for s in db.scalars(select(Supplier).where(Supplier.tenant_id == ctx.tenant_id).order_by(Supplier.name))]


@router.post("/suppliers", status_code=201)
def create_supplier(body: SupplierIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    s = Supplier(tenant_id=ctx.tenant_id, **body.model_dump())
    s.name = s.name.strip()
    db.add(s)
    db.commit()
    return supplier_out(s)


@router.put("/suppliers/{sid}")
def edit_supplier(sid: str, body: SupplierIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    s = db.scalar(select(Supplier).where(Supplier.id == sid, Supplier.tenant_id == ctx.tenant_id))
    if not s:
        raise HTTPException(404, "Supplier not found")
    for k, v in body.model_dump().items():
        setattr(s, k, v.strip() if isinstance(v, str) and k == "name" else v)
    db.commit()
    return supplier_out(s)


# ---------- Purchase orders ----------

def po_out(po: PurchaseOrder, stock: dict[str, StockItem], suppliers: dict[str, str]) -> dict:
    lines, total = [], Decimal(0)
    for ln in po.lines:
        s = stock.get(ln.stock_item_id)
        unit = s.unit if s else "pc"
        f = factor(unit)
        total += D(ln.qty) * D(ln.unit_cost)
        lines.append({"id": ln.id, "stock_item_id": ln.stock_item_id, "stock_item": s.name if s else "Removed item", "unit": unit,
                      "qty": q3(from_base(ln.qty, unit)), "cost": money(D(ln.unit_cost) * f),
                      "received_qty": q3(from_base(ln.received_qty, unit)), "total": money(D(ln.qty) * D(ln.unit_cost))})
    return {"id": po.id, "number": po.number, "supplier_id": po.supplier_id, "supplier": suppliers.get(po.supplier_id or "", ""),
            "status": po.status, "expected_on": po.expected_on.isoformat() if po.expected_on else None, "note": po.note,
            "lines": lines, "total": money(total), "created_at": po.created_at.isoformat(),
            "sent_at": po.sent_at.isoformat() if po.sent_at else None,
            "received_at": po.received_at.isoformat() if po.received_at else None}


def get_po(db: Session, ctx: Ctx, pid: str) -> PurchaseOrder:
    po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.id == pid, PurchaseOrder.tenant_id == ctx.tenant_id)
                   .options(selectinload(PurchaseOrder.lines)))
    if not po:
        raise HTTPException(404, "Purchase order not found")
    return po


def stock_map(db: Session, ctx: Ctx) -> dict[str, StockItem]:
    return {s.id: s for s in db.scalars(select(StockItem).where(StockItem.tenant_id == ctx.tenant_id))}


@router.get("/purchase-orders")
def list_pos(ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    pos = db.scalars(select(PurchaseOrder).where(PurchaseOrder.tenant_id == ctx.tenant_id)
                     .options(selectinload(PurchaseOrder.lines)).order_by(PurchaseOrder.created_at.desc()).limit(100)).all()
    stock, names = stock_map(db, ctx), supplier_names(db, ctx)
    return [po_out(p, stock, names) for p in pos]


class POLineIn(BaseModel):
    stock_item_id: str = Field(max_length=36)
    qty: float = Field(gt=0, le=1e9)  # in the stock item's unit
    cost: float = Field(default=0, ge=0, le=1e9)  # per unit


class POIn(BaseModel):
    supplier_id: str | None = Field(default=None, max_length=36)
    expected_on: date | None = None
    note: str = Field(default="", max_length=2000)
    lines: list[POLineIn] = Field(min_length=1, max_length=200)


def set_lines(db: Session, ctx: Ctx, po: PurchaseOrder, lines: list[POLineIn]) -> None:
    stock = stock_map(db, ctx)
    po.lines.clear()
    for n, ln in enumerate(lines):
        s = stock.get(ln.stock_item_id)
        if not s:
            raise HTTPException(404, "Stock item not found")
        po.lines.append(PurchaseOrderLine(tenant_id=ctx.tenant_id, stock_item_id=s.id, qty=to_base(ln.qty, s.unit),
                                          unit_cost=(D(ln.cost) / factor(s.unit)).quantize(Decimal("0.000001")), sort=n))


@router.post("/purchase-orders", status_code=201)
def create_po(body: POIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    n = (db.scalar(select(func.max(PurchaseOrder.number)).where(PurchaseOrder.tenant_id == ctx.tenant_id)) or 0) + 1
    po = PurchaseOrder(tenant_id=ctx.tenant_id, number=n, supplier_id=check_supplier(db, ctx, body.supplier_id),
                       expected_on=body.expected_on, note=body.note, created_by=ctx.user.id)
    db.add(po)
    set_lines(db, ctx, po, body.lines)
    db.commit()
    return po_out(get_po(db, ctx, po.id), stock_map(db, ctx), supplier_names(db, ctx))


@router.put("/purchase-orders/{pid}")
def edit_po(pid: str, body: POIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    po = get_po(db, ctx, pid)
    if po.status not in ("draft", "sent"):
        raise HTTPException(409, f"This order is {po.status}")
    po.supplier_id, po.expected_on, po.note = check_supplier(db, ctx, body.supplier_id), body.expected_on, body.note
    set_lines(db, ctx, po, body.lines)
    db.commit()
    return po_out(get_po(db, ctx, pid), stock_map(db, ctx), supplier_names(db, ctx))


class POStatusIn(BaseModel):
    status: str = Field(pattern=r"^(sent|cancelled)$")


@router.post("/purchase-orders/{pid}/status")
def po_status(pid: str, body: POStatusIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    po = get_po(db, ctx, pid)
    if po.status not in ("draft", "sent"):
        raise HTTPException(409, f"This order is already {po.status}")
    po.status = body.status
    if body.status == "sent":
        po.sent_at = now()
    db.commit()
    return po_out(po, stock_map(db, ctx), supplier_names(db, ctx))


class ReceiveLineIn(BaseModel):
    line_id: str = Field(max_length=36)
    qty: float = Field(ge=0, le=1e9)  # what actually arrived, in the stock item's unit
    cost: float | None = Field(default=None, ge=0, le=1e9)  # per unit, if the invoice price differs


class ReceiveIn(BaseModel):
    lines: list[ReceiveLineIn] = Field(max_length=200)


@router.post("/purchase-orders/{pid}/receive")
def receive(pid: str, body: ReceiveIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    po = get_po(db, ctx, pid)
    if po.status not in ("draft", "sent"):
        raise HTTPException(409, f"This order is already {po.status}")
    stock, by_id = stock_map(db, ctx), {ln.id: ln for ln in po.lines}
    touched, value = set(), Decimal(0)
    for r in body.lines:
        ln = by_id.get(r.line_id)
        s = stock.get(ln.stock_item_id) if ln else None
        if not ln or not s or r.qty <= 0:
            continue
        qty = to_base(r.qty, s.unit)
        cost = (D(r.cost) / factor(s.unit)) if r.cost is not None else D(ln.unit_cost)
        ln.received_qty, ln.unit_cost = qty, cost.quantize(Decimal("0.000001"))
        apply_movement(db, s, "received", qty, unit_cost=cost, user_id=ctx.user.id, ref_id=po.id, reason=f"PO #{po.number}")
        touched.add(s.id)
        value += qty * cost
    po.status, po.received_at = "received", now()
    audit(db, ctx, "stock_received", detail=f"Purchase order #{po.number}", amount=money(value))
    sync_auto86(db, ctx.tenant_id, touched)
    db.commit()
    return po_out(get_po(db, ctx, pid), stock_map(db, ctx), supplier_names(db, ctx))


# ---------- Stock counts ----------

class CountLineIn(BaseModel):
    stock_item_id: str = Field(max_length=36)
    counted: float = Field(ge=0, le=1e9)  # in the stock item's unit


class CountIn(BaseModel):
    lines: list[CountLineIn] = Field(min_length=1, max_length=1000)
    note: str = Field(default="", max_length=200)


@router.post("/counts", status_code=201)
def submit_count(body: CountIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    stock = stock_map(db, ctx)
    c = StockCount(tenant_id=ctx.tenant_id, note=body.note, user_id=ctx.user.id, user_name=ctx.user.name)
    db.add(c)
    db.flush()
    rows, total, touched = [], Decimal(0), set()
    for ln in body.lines:
        s = stock.get(ln.stock_item_id)
        if not s:
            continue
        expected, counted = D(s.on_hand), to_base(ln.counted, s.unit)
        diff = counted - expected
        value = diff * D(s.avg_cost)
        if diff:
            apply_movement(db, s, "count", diff, user_id=ctx.user.id, ref_id=c.id, reason=body.note or "Stock count")
            touched.add(s.id)
        total += value
        rows.append({"stock_item_id": s.id, "name": s.name, "unit": s.unit, "expected": q3(from_base(expected, s.unit)),
                     "counted": q3(from_base(counted, s.unit)), "variance": q3(from_base(diff, s.unit)), "value": money(value)})
    c.lines, c.variance_value = rows, total.quantize(Decimal("0.01"))
    audit(db, ctx, "stock_count", detail=f"{len(rows)} items counted" + (f" · {body.note}" if body.note else ""), amount=money(total))
    sync_auto86(db, ctx.tenant_id, touched)
    db.commit()
    return {"id": c.id, "lines": rows, "variance_value": money(total), "created_at": c.created_at.isoformat()}


@router.get("/counts")
def counts(ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    rows = db.scalars(select(StockCount).where(StockCount.tenant_id == ctx.tenant_id).order_by(StockCount.created_at.desc()).limit(30))
    return [{"id": c.id, "note": c.note, "user": c.user_name, "lines": c.lines, "variance_value": money(c.variance_value),
             "created_at": c.created_at.isoformat()} for c in rows]


# ---------- Settings & reports ----------

class SettingsIn(BaseModel):
    auto_86: bool


@router.put("/settings")
def settings(body: SettingsIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    ctx.tenant.inventory_auto_86 = body.auto_86
    db.flush()
    if body.auto_86:
        sync_auto86(db, ctx.tenant_id, None)
    db.commit()
    return {"auto_86": body.auto_86}


@router.get("/report")
def report(start: date | None = None, end: date | None = None, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    """Usage, waste and purchases for a period, food cost against net sales, and today's stock value."""
    p = report_period(ctx, start, end)
    stock = stock_map(db, ctx)
    rows = db.execute(select(StockMovement.stock_item_id, StockMovement.kind, func.sum(StockMovement.qty),
                             func.sum(StockMovement.qty * StockMovement.unit_cost))
                      .where(StockMovement.tenant_id == ctx.tenant_id, StockMovement.created_at >= p.start_at,
                             StockMovement.created_at < p.end_at)
                      .group_by(StockMovement.stock_item_id, StockMovement.kind)).all()
    per: dict[str, dict] = {}
    totals = defaultdict(Decimal)
    for sid, kind, qty, value in rows:
        s = stock.get(sid)
        if not s:
            continue
        r = per.setdefault(sid, {"stock_item_id": sid, "name": s.name, "unit": s.unit, "used": 0.0, "used_value": 0.0,
                                 "waste": 0.0, "waste_value": 0.0, "received": 0.0, "received_value": 0.0, "variance_value": 0.0})
        if kind == "sale":
            r["used"], r["used_value"] = q3(-from_base(qty, s.unit)), money(-D(value))
        elif kind == "waste":
            r["waste"], r["waste_value"] = q3(-from_base(qty, s.unit)), money(-D(value))
        elif kind in ("received", "transfer_in"):
            r["received"], r["received_value"] = q3(from_base(qty, s.unit)), money(value)
        elif kind == "count":
            r["variance_value"] = money(value)
        totals[kind] += D(value)
    waste_reasons = [{"reason": reason or "No reason given", "count": n, "value": money(-D(v))} for reason, n, v in db.execute(
        select(StockMovement.reason, func.count(StockMovement.id), func.sum(StockMovement.qty * StockMovement.unit_cost))
        .where(StockMovement.tenant_id == ctx.tenant_id, StockMovement.kind == "waste",
               StockMovement.created_at >= p.start_at, StockMovement.created_at < p.end_at)
        .group_by(StockMovement.reason))]
    net = D(sales_overview(db, [ctx.tenant_id], p)["net_sales"])
    used = -totals["sale"]
    return {
        "period": p.out(), "net_sales": money(net), "cost_of_sales": money(used),
        "food_cost_pct": round(float(used / net * 100), 1) if net else 0.0,
        "waste_value": money(-totals["waste"]), "received_value": money(totals["received"] + totals["transfer_in"]),
        "count_variance_value": money(totals["count"]),
        "stock_value": money(sum((D(s.on_hand) * D(s.avg_cost) for s in stock.values() if s.active), Decimal(0))),
        "items": sorted(per.values(), key=lambda r: -r["used_value"]),
        "waste_reasons": sorted(waste_reasons, key=lambda r: -r["value"]),
    }
