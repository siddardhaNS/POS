"""Back office: menu management, staff, reports, restaurant settings."""
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Ctx, require
from ..models import MenuCategory, MenuItem, Order, User
from ..security import hash_secret
from .pos import money

router = APIRouter(tags=["backoffice"])


# ---------- Menu ----------

def item_out(m: MenuItem) -> dict:
    return {"id": m.id, "category_id": m.category_id, "name": m.name, "price": money(m.price),
            "is_veg": m.is_veg, "station": m.station, "available": m.available}


@router.get("/menu")
def menu(ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    return _menu(ctx, db)


@router.get("/menu/manage")
def menu_manage(ctx: Ctx = Depends(require("menu")), db: Session = Depends(get_db)):
    return _menu(ctx, db)


def _menu(ctx: Ctx, db: Session):
    cats = db.scalars(select(MenuCategory).where(MenuCategory.tenant_id == ctx.tenant_id).order_by(MenuCategory.sort)).all()
    items = db.scalars(select(MenuItem).where(MenuItem.tenant_id == ctx.tenant_id).order_by(MenuItem.sort, MenuItem.name)).all()
    return [{"id": c.id, "name": c.name, "items": [item_out(m) for m in items if m.category_id == c.id]} for c in cats]


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
    for k, v in data.items():
        setattr(m, k, v)
    db.commit()
    return item_out(m)


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
        u.role = body.role
    if body.pin is not None:
        u.pin_hash = hash_secret(body.pin)
    if body.is_active is not None and u.role != "owner":
        u.is_active = body.is_active
    db.commit()
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "is_active": u.is_active,
            "has_pin": u.pin_hash is not None}


# ---------- Reports ----------

@router.get("/reports/summary")
def summary(period: str = Query("today", alias="range"), ctx: Ctx = Depends(require("reports")), db: Session = Depends(get_db)):
    tz = ZoneInfo("Asia/Kolkata" if ctx.tenant.market == "IN" else "America/New_York")
    days = {"today": 1, "7d": 7, "30d": 30}.get(period, 1)
    local_now = datetime.now(tz)
    start = local_now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days - 1)
    prev_start = start - timedelta(days=days)
    base = select(Order).where(Order.tenant_id == ctx.tenant_id, Order.status == "paid")
    cur = db.scalars(base.where(Order.closed_at >= start)).all()
    prev = db.scalars(base.where(Order.closed_at >= prev_start, Order.closed_at < start)).all()

    def kpi(orders):
        net = sum((o.subtotal for o in orders), Decimal(0))
        return {"net_sales": money(net), "orders": len(orders),
                "avg_order": money(net / len(orders)) if orders else 0,
                "tips": money(sum((o.tip for o in orders), Decimal(0)))}

    if days == 1:
        labels = [f"{h % 12 or 12}{'a' if h < 12 else 'p'}" for h in range(11, 24)]
        buckets = {h: Decimal(0) for h in range(11, 24)}
        for o in cur:
            h = o.closed_at.astimezone(tz).hour
            if h in buckets:
                buckets[h] += o.subtotal
        series = [money(v) for v in buckets.values()]
    else:
        keys = [(start + timedelta(days=i)).date() for i in range(days)]
        buckets = {k: Decimal(0) for k in keys}
        for o in cur:
            d = o.closed_at.astimezone(tz).date()
            if d in buckets:
                buckets[d] += o.subtotal
        labels = [k.strftime("%a" if days == 7 else "%d") for k in keys]
        series = [money(v) for v in buckets.values()]

    mix: dict[str, int] = {}
    for o in cur:
        mix[o.payment_method] = mix.get(o.payment_method, 0) + 1
    channels: dict[str, float] = {}
    for o in cur:
        channels[o.channel] = channels.get(o.channel, 0) + money(o.subtotal)
    return {"current": kpi(cur), "previous": kpi(prev), "labels": labels, "series": series,
            "payment_mix": mix, "channels": channels}


# ---------- Settings ----------

class SettingsIn(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    tax_rate: float | None = Field(default=None, ge=0, le=0.5)
    tax_label: str | None = Field(default=None, max_length=80)
    phone: str | None = Field(default=None, max_length=40)
    city: str | None = Field(default=None, max_length=120)


@router.patch("/settings")
def update_settings(body: SettingsIn, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    t = db.merge(ctx.tenant)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(t, k, Decimal(str(v)) if k == "tax_rate" else v)
    db.commit()
    from .auth import tenant_out
    return tenant_out(t)
