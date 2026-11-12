"""Back office: menu management, staff, reports, restaurant settings."""
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import Ctx, require
from ..live import audit
from ..models import AuditLog, DiningTable, MenuCategory, MenuItem, ModifierGroup, ModifierOption, Order, User
from ..security import hash_secret
from .pos import money, tenant_tz

router = APIRouter(tags=["backoffice"])


# ---------- Menu ----------

def group_out(g: ModifierGroup) -> dict:
    return {"id": g.id, "name": g.name, "min": g.min_select, "max": g.max_select,
            "options": [{"id": o.id, "name": o.name, "price": money(o.price)} for o in g.options]}


def item_out(m: MenuItem, groups: list[ModifierGroup] | None = None) -> dict:
    return {"id": m.id, "category_id": m.category_id, "name": m.name, "price": money(m.price),
            "is_veg": m.is_veg, "station": m.station, "available": m.available,
            "modifiers": [group_out(g) for g in (groups or [])]}


@router.get("/menu")
def menu(ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    return _menu(ctx, db)


@router.get("/menu/manage")
def menu_manage(ctx: Ctx = Depends(require("menu")), db: Session = Depends(get_db)):
    return _menu(ctx, db)


def _menu(ctx: Ctx, db: Session):
    cats = db.scalars(select(MenuCategory).where(MenuCategory.tenant_id == ctx.tenant_id).order_by(MenuCategory.sort)).all()
    items = db.scalars(select(MenuItem).where(MenuItem.tenant_id == ctx.tenant_id).order_by(MenuItem.sort, MenuItem.name)).all()
    groups: dict[str, list[ModifierGroup]] = {}
    for g in db.scalars(select(ModifierGroup).where(ModifierGroup.tenant_id == ctx.tenant_id)
                        .options(selectinload(ModifierGroup.options)).order_by(ModifierGroup.sort)):
        groups.setdefault(g.menu_item_id, []).append(g)
    return [{"id": c.id, "name": c.name, "items": [item_out(m, groups.get(m.id)) for m in items if m.category_id == c.id]}
            for c in cats]


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.post("/menu/categories", status_code=201)
def add_category(body: CategoryIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    n = db.scalar(select(func.count()).select_from(MenuCategory).where(MenuCategory.tenant_id == ctx.tenant_id)) or 0
    c = MenuCategory(tenant_id=ctx.tenant_id, name=body.name.strip(), sort=n)
    db.add(c)
    db.commit()
    return {"id": c.id, "name": c.name, "items": []}


class ItemIn(BaseModel):
    category_id: str
    name: str = Field(min_length=1, max_length=160)
    price: float = Field(ge=0, le=1_000_000)
    is_veg: bool = True
    station: str = Field(default="Kitchen", max_length=40)
    available: bool = True


class ItemPatch(BaseModel):
    category_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)
    price: float | None = Field(default=None, ge=0, le=1_000_000)
    is_veg: bool | None = None
    station: str | None = Field(default=None, max_length=40)
    available: bool | None = None


def own_category(db: Session, ctx: Ctx, cid: str) -> None:
    if not db.scalar(select(MenuCategory.id).where(MenuCategory.id == cid, MenuCategory.tenant_id == ctx.tenant_id)):
        raise HTTPException(404, "Category not found")


@router.post("/menu/items", status_code=201)
def add_item(body: ItemIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    own_category(db, ctx, body.category_id)
    m = MenuItem(tenant_id=ctx.tenant_id, **body.model_dump(exclude={"price"}), price=Decimal(str(body.price)))
    db.add(m)
    db.commit()
    return item_out(m)


def own_item(db: Session, ctx: Ctx, iid: str) -> MenuItem:
    m = db.scalar(select(MenuItem).where(MenuItem.id == iid, MenuItem.tenant_id == ctx.tenant_id))
    if not m:
        raise HTTPException(404, "Item not found")
    return m


@router.patch("/menu/items/{iid}")
def edit_item(iid: str, body: ItemPatch, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    m = own_item(db, ctx, iid)
    data = body.model_dump(exclude_unset=True)
    if "category_id" in data:
        own_category(db, ctx, data["category_id"])
    if "price" in data:
        data["price"] = Decimal(str(data["price"]))
        if data["price"] != m.price:
            audit(db, ctx, "price_change", amount=data["price"], detail=f"{m.name}: {money(m.price):.2f} → {money(data['price']):.2f}")
    for k, v in data.items():
        setattr(m, k, v)
    db.commit()
    return item_out(m)


class OptionIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price: float = Field(default=0, ge=0, le=1_000_000)


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    min: int = Field(default=0, ge=0, le=20)
    max: int = Field(default=1, ge=0, le=20)  # 0 = no limit
    options: list[OptionIn] = Field(min_length=1, max_length=30)


class ModifiersIn(BaseModel):
    groups: list[GroupIn] = Field(default_factory=list, max_length=10)


@router.put("/menu/items/{iid}/modifiers")
def set_modifiers(iid: str, body: ModifiersIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    """Replace an item's option groups (sizes, add-ons, spice level...)."""
    m = own_item(db, ctx, iid)
    for g in body.groups:
        if g.max and g.min > g.max:
            raise HTTPException(422, f"{g.name}: minimum can't be more than maximum")
        if g.min > len(g.options):
            raise HTTPException(422, f"{g.name}: not enough options for the minimum")
    for old in db.scalars(select(ModifierGroup).where(ModifierGroup.menu_item_id == m.id, ModifierGroup.tenant_id == ctx.tenant_id)):
        db.delete(old)
    db.flush()
    out = []
    for gi, g in enumerate(body.groups):
        grp = ModifierGroup(tenant_id=ctx.tenant_id, menu_item_id=m.id, name=g.name.strip(), min_select=g.min,
                            max_select=g.max, sort=gi)
        grp.options = [ModifierOption(tenant_id=ctx.tenant_id, name=o.name.strip(), price=Decimal(str(o.price)), sort=oi)
                       for oi, o in enumerate(g.options)]
        db.add(grp)
        out.append(grp)
    db.commit()
    return item_out(m, out)


@router.delete("/menu/items/{iid}")
def delete_item(iid: str, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    db.delete(own_item(db, ctx, iid))
    db.commit()
    return {"ok": True}


# ---------- Staff ----------

ROLES = ("manager", "cashier", "captain", "chef")


@router.get("/staff")
def staff(ctx: Ctx = Depends(require("staff")), db: Session = Depends(get_db)):
    rows = db.scalars(select(User).where(User.tenant_id == ctx.tenant_id).order_by(User.created_at)).all()
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role, "is_active": u.is_active,
             "has_pin": u.pin_hash is not None} for u in rows]


class StaffIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str
    pin: str = Field(pattern=r"^\d{4}$")


@router.post("/staff", status_code=201)
def add_staff(body: StaffIn, ctx: Ctx = Depends(require("staff")), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(422, "Invalid role")
    if body.role == "manager" and ctx.user.role != "owner":
        raise HTTPException(403, "Only the owner can add managers")
    u = User(tenant_id=ctx.tenant_id, name=body.name.strip(), role=body.role, pin_hash=hash_secret(body.pin))
    db.add(u)
    db.commit()
    return {"id": u.id, "name": u.name, "role": u.role, "is_active": True, "has_pin": True, "email": None}


class StaffPatch(BaseModel):
    role: str | None = None
    pin: str | None = Field(default=None, pattern=r"^\d{4}$")
    is_active: bool | None = None


@router.patch("/staff/{uid}")
def edit_staff(uid: str, body: StaffPatch, ctx: Ctx = Depends(require("staff")), db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(User.id == uid, User.tenant_id == ctx.tenant_id))
    if not u:
        raise HTTPException(404, "Staff member not found")
    if u.role == "owner" and ctx.user.id != u.id:
        raise HTTPException(403, "The owner account can only be changed by the owner")
    if body.role is not None:
        if body.role not in ROLES or u.role == "owner":
            raise HTTPException(422, "Invalid role")
        if body.role != u.role:
            audit(db, ctx, "role_change", detail=f"{u.name}: {u.role} → {body.role}")
        u.role = body.role
    if body.pin is not None:
        u.pin_hash = hash_secret(body.pin)
        audit(db, ctx, "pin_reset", detail=u.name)
    if body.is_active is not None and u.role != "owner" and body.is_active != u.is_active:
        audit(db, ctx, "staff_activated" if body.is_active else "staff_deactivated", detail=u.name)
        u.is_active = body.is_active
    db.commit()
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "is_active": u.is_active,
            "has_pin": u.pin_hash is not None}


# ---------- Reports ----------

@router.get("/reports/summary")
def summary(period: str = Query("today", alias="range"), ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    tz = tenant_tz(ctx.tenant)
    days = {"today": 1, "7d": 7, "30d": 30}.get(period, 1)
    local_now = datetime.now(tz)
    start = local_now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    prev_start = start - timedelta(days=days)
    base = select(Order).where(Order.tenant_id == ctx.tenant_id, Order.status.in_(("paid", "refunded")))
    cur = db.scalars(base.where(Order.closed_at >= start)).all()
    prev = db.scalars(base.where(Order.closed_at >= prev_start, Order.closed_at < start)).all()

    def net_of(o: Order) -> Decimal:
        """Sales after discounts and refunds, before tax and tips."""
        taxable = o.subtotal - o.discount_amount
        gross = taxable + o.tax + o.tip
        return taxable - (o.refunded * taxable / gross if gross else 0)

    def kpi(orders):
        net = sum((net_of(o) for o in orders), Decimal(0))
        return {"net_sales": money(net), "orders": len(orders),
                "avg_order": money(net / len(orders)) if orders else 0,
                "tips": money(sum((o.tip for o in orders), Decimal(0))),
                "tax": money(sum((o.tax for o in orders), Decimal(0))),
                "discounts": money(sum((o.discount_amount for o in orders), Decimal(0))),
                "refunds": money(sum((o.refunded for o in orders), Decimal(0)))}

    if days == 1:
        labels = [f"{h % 12 or 12}{'a' if h < 12 else 'p'}" for h in range(11, 24)]
        buckets = {h: Decimal(0) for h in range(11, 24)}
        for o in cur:
            h = o.closed_at.astimezone(tz).hour
            if h in buckets:
                buckets[h] += net_of(o)
        series = [money(v) for v in buckets.values()]
    else:
        keys = [(start + timedelta(days=i)).date() for i in range(days)]
        buckets = {k: Decimal(0) for k in keys}
        for o in cur:
            d = o.closed_at.astimezone(tz).date()
            if d in buckets:
                buckets[d] += net_of(o)
        labels = [k.strftime("%a" if days == 7 else "%d") for k in keys]
        series = [money(v) for v in buckets.values()]

    mix: dict[str, int] = {}
    for o in cur:
        mix[o.payment_method] = mix.get(o.payment_method, 0) + 1
    channels: dict[str, float] = {}
    for o in cur:
        channels[o.channel] = channels.get(o.channel, 0) + money(net_of(o))
    return {"current": kpi(cur), "previous": kpi(prev), "labels": labels, "series": series,
            "payment_mix": mix, "channels": channels}


# ---------- Settings ----------

class SettingsIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    tax_rate: float | None = Field(default=None, ge=0, le=0.5)
    tax_label: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, max_length=40)
    city: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=400)
    tax_id: str | None = Field(default=None, max_length=60)
    timezone: str | None = Field(default=None, max_length=64)
    tips_enabled: bool | None = None
    receipt_footer: str | None = Field(default=None, max_length=400)
    auto_print_kot: bool | None = None
    auto_print_receipt: bool | None = None


@router.get("/settings")
def get_settings(ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    from .auth import tenant_out
    return tenant_out(ctx.tenant)


@router.patch("/settings")
def update_settings(body: SettingsIn, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    t = db.merge(ctx.tenant)
    data = body.model_dump(exclude_unset=True)
    if data.get("timezone"):
        try:
            ZoneInfo(data["timezone"])
        except Exception:
            raise HTTPException(422, "Unknown time zone")
    if "tax_rate" in data and Decimal(str(data["tax_rate"])) != t.tax_rate:
        audit(db, ctx, "tax_change", detail=f"{float(t.tax_rate) * 100:g}% → {data['tax_rate'] * 100:g}%")
    for k, v in data.items():
        setattr(t, k, Decimal(str(v)) if k == "tax_rate" else v)
    db.commit()
    from .auth import tenant_out
    return tenant_out(t)


# ---------- Tables (floor plan) ----------

def table_out(t: DiningTable) -> dict:
    return {"id": t.id, "name": t.name, "seats": t.seats, "section": t.section, "sort": t.sort}


@router.get("/floor/tables")
def list_tables(ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    ts = db.scalars(select(DiningTable).where(DiningTable.tenant_id == ctx.tenant_id).order_by(DiningTable.sort)).all()
    return [table_out(t) for t in ts]


class TableIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    seats: int = Field(default=4, ge=1, le=40)
    section: str = Field(default="Main", min_length=1, max_length=40)


class TablePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=20)
    seats: int | None = Field(default=None, ge=1, le=40)
    section: str | None = Field(default=None, min_length=1, max_length=40)
    sort: int | None = Field(default=None, ge=0, le=10_000)


def name_free(db: Session, ctx: Ctx, name: str, skip: str | None = None) -> None:
    hit = db.scalar(select(DiningTable.id).where(DiningTable.tenant_id == ctx.tenant_id, func.lower(DiningTable.name) == name.lower()))
    if hit and hit != skip:
        raise HTTPException(409, f"There's already a table called {name}")


@router.post("/floor/tables", status_code=201)
def add_table(body: TableIn, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    name_free(db, ctx, body.name.strip())
    n = db.scalar(select(func.max(DiningTable.sort)).where(DiningTable.tenant_id == ctx.tenant_id))
    t = DiningTable(tenant_id=ctx.tenant_id, name=body.name.strip(), seats=body.seats, section=body.section.strip(),
                    sort=(n or 0) + 1)
    db.add(t)
    db.commit()
    return table_out(t)


def own_table(db: Session, ctx: Ctx, tid: str) -> DiningTable:
    t = db.scalar(select(DiningTable).where(DiningTable.id == tid, DiningTable.tenant_id == ctx.tenant_id))
    if not t:
        raise HTTPException(404, "Table not found")
    return t


@router.patch("/floor/tables/{tid}")
def edit_table(tid: str, body: TablePatch, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    t = own_table(db, ctx, tid)
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        data["name"] = data["name"].strip()
        name_free(db, ctx, data["name"], skip=t.id)
    for k, v in data.items():
        setattr(t, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    return table_out(t)


@router.delete("/floor/tables/{tid}")
def delete_table(tid: str, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    t = own_table(db, ctx, tid)
    if db.scalar(select(Order.id).where(Order.tenant_id == ctx.tenant_id, Order.table_id == t.id, Order.status == "open")):
        raise HTTPException(409, f"{t.name} has an open check. Close or move it first.")
    db.delete(t)
    db.commit()
    return {"ok": True}


# ---------- Audit trail ----------

@router.get("/audit")
def audit_log(day: str | None = None, action: str = "", order_id: str = "", ctx: Ctx = Depends(require("reports")),
              db: Session = Depends(get_db)):
    stmt = select(AuditLog).where(AuditLog.tenant_id == ctx.tenant_id).order_by(AuditLog.created_at.desc())
    if order_id:
        stmt = stmt.where(AuditLog.order_id == order_id)
    else:
        tz = tenant_tz(ctx.tenant)
        d = datetime.strptime(day, "%Y-%m-%d").date() if day else datetime.now(tz).date()
        start = datetime(d.year, d.month, d.day, tzinfo=tz)
        stmt = stmt.where(AuditLog.created_at >= start, AuditLog.created_at < start + timedelta(days=1))
    if action:
        stmt = stmt.where(AuditLog.action.in_(action.split(",")))
    rows = db.scalars(stmt.limit(500)).all()
    return [{"id": a.id, "action": a.action, "user": a.user_name, "order_id": a.order_id, "order_number": a.order_number,
             "detail": a.detail, "amount": money(a.amount) if a.amount is not None else None,
             "created_at": a.created_at.isoformat()} for a in rows]
