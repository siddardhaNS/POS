"""Back office: menu management, staff, reports, restaurant settings."""
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import menurules, phases
from ..db import get_db
from ..deps import Ctx, require
from ..deps import PERMISSIONS
from ..live import audit
from ..models import AuditLog, DiningTable, FloorSection, MenuCategory, MenuItem, ModifierGroup, ModifierOption, Order, TaxRate, User
from ..security import hash_secret
from .pos import money, tenant_tz

router = APIRouter(tags=["backoffice"])


# ---------- Menu ----------

def group_out(g: ModifierGroup, avail: dict[str, bool] | None = None) -> dict:
    """avail: menu item id -> available, so combo choices whose dish is sold out show as unavailable."""
    return {"id": g.id, "name": g.name, "min": g.min_select, "max": g.max_select,
            "options": [{"id": o.id, "name": o.name, "price": money(o.price), "menu_item_id": o.menu_item_id,
                         "available": (avail or {}).get(o.menu_item_id, True) if o.menu_item_id else True} for o in g.options]}


ALLERGENS = ("gluten", "milk", "eggs", "peanuts", "tree_nuts", "soy", "sesame", "mustard", "fish", "crustaceans",
             "molluscs", "celery", "sulphites", "lupin")
NUTRIENTS = ("kcal", "protein", "carbs", "fat")


def item_out(m: MenuItem, groups: list[ModifierGroup] | None = None, avail: dict[str, bool] | None = None) -> dict:
    return {"id": m.id, "category_id": m.category_id, "name": m.name, "price": money(m.price),
            "is_veg": m.is_veg, "station": m.station, "available": m.available,
            "description": m.description or "", "tags": m.tags or [], "allergens": m.allergens or [],
            "nutrition": m.nutrition or {}, "channels": m.channels or [], "tax_rate_id": m.tax_rate_id, "hsn": m.hsn or "",
            "is_combo": any(o.menu_item_id for g in (groups or []) for o in g.options),
            "modifiers": [group_out(g, avail) for g in (groups or [])]}


@router.get("/menu")
def menu(channel: str = "", ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    """The menu for ordering. With a channel, prices are the ones in force there right now (price lists)."""
    return _menu(ctx, db, channel if channel in menurules.CHANNELS else "")


@router.get("/menu/manage")
def menu_manage(ctx: Ctx = Depends(require("menu")), db: Session = Depends(get_db)):
    return _menu(ctx, db)


def _menu(ctx: Ctx, db: Session, channel: str = ""):
    cats = db.scalars(select(MenuCategory).where(MenuCategory.tenant_id == ctx.tenant_id).order_by(MenuCategory.sort)).all()
    items = db.scalars(select(MenuItem).where(MenuItem.tenant_id == ctx.tenant_id).order_by(MenuItem.sort, MenuItem.name)).all()
    groups: dict[str, list[ModifierGroup]] = {}
    for g in db.scalars(select(ModifierGroup).where(ModifierGroup.tenant_id == ctx.tenant_id)
                        .options(selectinload(ModifierGroup.options)).order_by(ModifierGroup.sort)):
        groups.setdefault(g.menu_item_id, []).append(g)
    avail = {m.id: m.available for m in items}
    pricing = menurules.Pricing(db, ctx.tenant, channel) if channel else None

    def priced(m: MenuItem) -> dict:
        out = item_out(m, groups.get(m.id), avail)
        if pricing:
            p, name = pricing.price(m)
            out.update(base_price=money(m.price), price=money(p), price_list=name)
        return out
    tz = tenant_tz(ctx.tenant)
    return [{**category_out(c, tz), "items": [priced(m) for m in items if m.category_id == c.id]} for c in cats]


def category_out(c: MenuCategory, tz) -> dict:
    return {"id": c.id, "name": c.name, "phase": phases.effective(c.phase, c.name), "phase_set": c.phase in phases.PHASES,
            "schedule": c.schedule or {}, "schedule_label": menurules.schedule_label(c.schedule),
            "open_now": menurules.open_now(c.schedule, tz), "tax_rate_id": c.tax_rate_id}


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.post("/menu/categories", status_code=201)
def add_category(body: CategoryIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    n = db.scalar(select(func.count()).select_from(MenuCategory).where(MenuCategory.tenant_id == ctx.tenant_id)) or 0
    c = MenuCategory(tenant_id=ctx.tenant_id, name=body.name.strip(), sort=n)
    db.add(c)
    db.commit()
    return {**category_out(c, tenant_tz(ctx.tenant)), "items": []}


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    phase: str | None = Field(default=None, pattern=r"^(|drinks|starters|mains|sides|desserts)$")  # "" = guess
    schedule: dict | None = None  # {"days": [...], "from": "HH:MM", "to": "HH:MM"}; {} = always
    tax_rate_id: str | None = Field(default=None, max_length=36)  # "" = restaurant default


@router.patch("/menu/categories/{cid}")
def edit_category(cid: str, body: CategoryPatch, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    c = db.scalar(select(MenuCategory).where(MenuCategory.id == cid, MenuCategory.tenant_id == ctx.tenant_id))
    if not c:
        raise HTTPException(404, "Category not found")
    if body.name is not None:
        c.name = body.name.strip()
    if body.phase is not None:
        c.phase = body.phase
    if body.schedule is not None:
        c.schedule = menurules.clean_schedule(body.schedule)
    if body.tax_rate_id is not None:
        c.tax_rate_id = own_tax(db, ctx, body.tax_rate_id)
    db.commit()
    return category_out(c, tenant_tz(ctx.tenant))


class ItemIn(BaseModel):
    category_id: str
    name: str = Field(min_length=1, max_length=160)
    price: float = Field(ge=0, le=1_000_000)
    is_veg: bool = True
    station: str = Field(default="Kitchen", max_length=40)
    available: bool = True
    description: str = Field(default="", max_length=600)
    tags: list[str] = Field(default_factory=list, max_length=12)
    allergens: list[str] = Field(default_factory=list, max_length=14)
    nutrition: dict[str, float] = Field(default_factory=dict)
    channels: list[str] = Field(default_factory=list, max_length=5)
    tax_rate_id: str | None = Field(default=None, max_length=36)
    hsn: str = Field(default="", max_length=12)


class ItemPatch(BaseModel):
    category_id: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)
    price: float | None = Field(default=None, ge=0, le=1_000_000)
    is_veg: bool | None = None
    station: str | None = Field(default=None, max_length=40)
    available: bool | None = None
    description: str | None = Field(default=None, max_length=600)
    tags: list[str] | None = Field(default=None, max_length=12)
    allergens: list[str] | None = Field(default=None, max_length=14)
    nutrition: dict[str, float] | None = None
    channels: list[str] | None = Field(default=None, max_length=5)
    tax_rate_id: str | None = Field(default=None, max_length=36)  # "" = use the category's
    hsn: str | None = Field(default=None, max_length=12)


def clean_details(data: dict) -> dict:
    """Normalise the guest-facing fields: trimmed unique tags, known allergens, non-negative nutrients."""
    if data.get("description") is not None:
        data["description"] = data["description"].strip()
    if data.get("tags") is not None:
        seen, tags = set(), []
        for t in data["tags"]:
            t = t.strip()[:30]
            if t and t.lower() not in seen:
                seen.add(t.lower())
                tags.append(t)
        data["tags"] = tags
    if data.get("allergens") is not None:
        bad = set(data["allergens"]) - set(ALLERGENS)
        if bad:
            raise HTTPException(422, "Unknown allergen: " + ", ".join(sorted(bad)))
        data["allergens"] = [a for a in ALLERGENS if a in data["allergens"]]
    if data.get("nutrition") is not None:
        n = {}
        for k, v in data["nutrition"].items():
            if k not in NUTRIENTS:
                raise HTTPException(422, f"Unknown nutrient: {k}")
            if v is not None and not (0 <= v <= 100000):
                raise HTTPException(422, f"{k} is out of range")
            if v is not None:
                n[k] = round(float(v), 1)
        data["nutrition"] = n
    if data.get("channels") is not None:
        bad = set(data["channels"]) - set(menurules.CHANNELS)
        if bad:
            raise HTTPException(422, "Unknown channel: " + ", ".join(sorted(bad)))
        picked = [c for c in menurules.CHANNELS if c in data["channels"]]
        data["channels"] = [] if len(picked) == len(menurules.CHANNELS) else picked
    return {k: v for k, v in data.items() if v is not None or k not in ("description", "tags", "allergens", "nutrition", "channels")}


def own_tax(db: Session, ctx: Ctx, rid: str | None) -> str | None:
    """A tax class id of this restaurant, or None for "" (inherit)."""
    if not rid:
        return None
    if not db.scalar(select(TaxRate.id).where(TaxRate.id == rid, TaxRate.tenant_id == ctx.tenant_id)):
        raise HTTPException(404, "Tax class not found")
    return rid


def own_category(db: Session, ctx: Ctx, cid: str) -> None:
    if not db.scalar(select(MenuCategory.id).where(MenuCategory.id == cid, MenuCategory.tenant_id == ctx.tenant_id)):
        raise HTTPException(404, "Category not found")


@router.post("/menu/items", status_code=201)
def add_item(body: ItemIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    own_category(db, ctx, body.category_id)
    data = clean_details(body.model_dump(exclude={"price"}))
    data["tax_rate_id"] = own_tax(db, ctx, data.get("tax_rate_id"))
    data["hsn"] = (data.get("hsn") or "").strip().upper()
    m = MenuItem(tenant_id=ctx.tenant_id, **data, price=Decimal(str(body.price)))
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
    data = clean_details(body.model_dump(exclude_unset=True))
    if "category_id" in data:
        own_category(db, ctx, data["category_id"])
    if "tax_rate_id" in data:
        data["tax_rate_id"] = own_tax(db, ctx, data["tax_rate_id"])
    if data.get("hsn") is not None:
        data["hsn"] = data["hsn"].strip().upper()
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
    menu_item_id: str | None = Field(default=None, max_length=36)  # combo slot: the dish this choice serves


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
    linked = {o.menu_item_id for g in body.groups for o in g.options if o.menu_item_id}
    if m.id in linked:
        raise HTTPException(422, "A combo can't include itself")
    if linked and len(set(db.scalars(select(MenuItem.id).where(MenuItem.tenant_id == ctx.tenant_id, MenuItem.id.in_(linked))))) != len(linked):
        raise HTTPException(404, "A dish in this combo isn't on the menu any more")
    for old in db.scalars(select(ModifierGroup).where(ModifierGroup.menu_item_id == m.id, ModifierGroup.tenant_id == ctx.tenant_id)):
        db.delete(old)
    db.flush()
    out = []
    for gi, g in enumerate(body.groups):
        grp = ModifierGroup(tenant_id=ctx.tenant_id, menu_item_id=m.id, name=g.name.strip(), min_select=g.min,
                            max_select=g.max, sort=gi)
        grp.options = [ModifierOption(tenant_id=ctx.tenant_id, name=o.name.strip(), price=Decimal(str(o.price)), sort=oi,
                                      menu_item_id=o.menu_item_id or None)
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
             "has_pin": u.pin_hash is not None, **pay_rate(ctx, u)} for u in rows]


def pay_rate(ctx: Ctx, u: User) -> dict:
    """Hourly rate is only shown to roles that can see timesheets."""
    return {"hourly_rate": money(u.hourly_rate)} if "timesheets" in PERMISSIONS.get(ctx.user.role, set()) else {}


class StaffIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str
    pin: str = Field(pattern=r"^\d{4}$")
    hourly_rate: float | None = Field(default=None, ge=0, le=100000)


@router.post("/staff", status_code=201)
def add_staff(body: StaffIn, ctx: Ctx = Depends(require("staff")), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(422, "Invalid role")
    if body.role == "manager" and ctx.user.role != "owner":
        raise HTTPException(403, "Only the owner can add managers")
    u = User(tenant_id=ctx.tenant_id, name=body.name.strip(), role=body.role, pin_hash=hash_secret(body.pin))
    if body.hourly_rate is not None and "timesheets" in PERMISSIONS.get(ctx.user.role, set()):
        u.hourly_rate = Decimal(str(body.hourly_rate))
    db.add(u)
    db.commit()
    return {"id": u.id, "name": u.name, "role": u.role, "is_active": True, "has_pin": True, "email": None, **pay_rate(ctx, u)}


class StaffPatch(BaseModel):
    role: str | None = None
    pin: str | None = Field(default=None, pattern=r"^\d{4}$")
    is_active: bool | None = None
    hourly_rate: float | None = Field(default=None, ge=0, le=100000)


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
    if body.hourly_rate is not None and "timesheets" in PERMISSIONS.get(ctx.user.role, set()):
        rate = Decimal(str(body.hourly_rate)).quantize(Decimal("0.01"))
        if rate != u.hourly_rate:
            audit(db, ctx, "rate_change", detail=f"{u.name}: {money(u.hourly_rate):g} → {money(rate):g}/h")
        u.hourly_rate = rate
    db.commit()
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "is_active": u.is_active,
            "has_pin": u.pin_hash is not None, **pay_rate(ctx, u)}


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
    invoice_prefix: str | None = Field(default=None, max_length=12, pattern=r"^[A-Za-z0-9-]*$")


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
    if "tax_rate" in data and t.default_tax_id:
        # The single rate is the default tax class: change the class too, scaling its parts (CGST / SGST).
        r = db.get(TaxRate, t.default_tax_id)
        if r is not None and r.rate != t.tax_rate:
            old = Decimal(r.rate)
            r.components = [{**p, "rate": float(Decimal(str(p["rate"])) * t.tax_rate / old) if old else 0}
                            for p in (r.components or [])]
            r.rate = t.tax_rate
        if r is not None and "tax_label" not in data:
            t.tax_label = r.name
    db.commit()
    from .auth import tenant_out
    return tenant_out(t)


# ---------- Floor plan: sections & tables ----------

SHAPES = r"^(round|square|rect|booth|bar)$"


def table_out(t: DiningTable) -> dict:
    return {"id": t.id, "name": t.name, "seats": t.seats, "section": t.section, "sort": t.sort,
            "shape": t.shape, "x": t.x, "y": t.y, "rotation": t.rotation}


def section_out(s: FloorSection) -> dict:
    return {"id": s.id, "name": s.name, "sort": s.sort, "layout": s.layout or {}}


@router.get("/floor/plan")
def floor_plan(ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    secs = [section_out(x) for x in db.scalars(select(FloorSection).where(FloorSection.tenant_id == ctx.tenant_id)
                                               .order_by(FloorSection.sort)).all()]
    ts = db.scalars(select(DiningTable).where(DiningTable.tenant_id == ctx.tenant_id).order_by(DiningTable.sort)).all()
    names = {x["name"] for x in secs}
    for t in ts:  # a table whose section row is missing still shows up
        if t.section not in names:
            names.add(t.section)
            secs.append({"id": f"implicit:{t.section}", "name": t.section, "sort": len(secs), "layout": {}})
    return {"sections": secs, "tables": [table_out(t) for t in ts]}


def ensure_section(db: Session, ctx: Ctx, name: str) -> None:
    if not db.scalar(select(FloorSection.id).where(FloorSection.tenant_id == ctx.tenant_id, FloorSection.name == name)):
        n = db.scalar(select(func.max(FloorSection.sort)).where(FloorSection.tenant_id == ctx.tenant_id))
        db.add(FloorSection(tenant_id=ctx.tenant_id, name=name, sort=(n if n is not None else -1) + 1))
        db.flush()


class SectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


def section_clash(db: Session, ctx: Ctx, name: str) -> str | None:
    return db.scalar(select(FloorSection.id).where(FloorSection.tenant_id == ctx.tenant_id,
                                                   func.lower(FloorSection.name) == name.lower()))


@router.post("/floor/sections", status_code=201)
def add_section(body: SectionIn, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    name = body.name.strip()
    if section_clash(db, ctx, name):
        raise HTTPException(409, f"There is already a section called {name}")
    ensure_section(db, ctx, name)
    db.commit()
    return floor_plan(ctx, db)


def own_section(db: Session, ctx: Ctx, sid: str) -> FloorSection:
    s = db.scalar(select(FloorSection).where(FloorSection.id == sid, FloorSection.tenant_id == ctx.tenant_id))
    if not s:
        raise HTTPException(404, "Section not found")
    return s


@router.patch("/floor/sections/{sid}")
def rename_section(sid: str, body: SectionIn, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    s = own_section(db, ctx, sid)
    name = body.name.strip()
    clash = section_clash(db, ctx, name)
    if clash and clash != s.id:
        raise HTTPException(409, f"There is already a section called {name}")
    for t in db.scalars(select(DiningTable).where(DiningTable.tenant_id == ctx.tenant_id, DiningTable.section == s.name)):
        t.section = name
    s.name = name
    db.commit()
    return floor_plan(ctx, db)


LINE_KINDS = ("wall", "door", "window")
AREA_KINDS = ("kitchen", "bar", "counter", "restroom", "stage", "stairs", "zone", "pillar", "plant")


class LayoutItem(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    kind: str = Field(pattern=r"^(wall|door|window|kitchen|bar|counter|restroom|stage|stairs|zone|pillar|plant)$")
    # lines: x1,y1 -> x2,y2 ; areas: x,y,w,h (grid units)
    x1: float | None = Field(default=None, ge=0, le=300)
    y1: float | None = Field(default=None, ge=0, le=300)
    x2: float | None = Field(default=None, ge=0, le=300)
    y2: float | None = Field(default=None, ge=0, le=300)
    x: float | None = Field(default=None, ge=0, le=300)
    y: float | None = Field(default=None, ge=0, le=300)
    w: float | None = Field(default=None, gt=0, le=300)
    h: float | None = Field(default=None, gt=0, le=300)
    label: str = Field(default="", max_length=40)


class LayoutIn(BaseModel):
    section: str = Field(min_length=1, max_length=40)
    room: list[tuple[float, float]] = Field(default_factory=list, max_length=80)
    items: list[LayoutItem] = Field(default_factory=list, max_length=400)


@router.put("/floor/layout")
def save_layout(body: LayoutIn, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    """Save the drawn layout of one section: the room outline plus walls, doors, windows and areas."""
    if body.room and len(body.room) < 3:
        raise HTTPException(422, "A room outline needs at least 3 corners")
    if any(not (0 <= v <= 300) for p in body.room for v in p):
        raise HTTPException(422, "The room outline is off the plan")
    items = []
    for it in body.items:
        if it.kind in LINE_KINDS:
            if None in (it.x1, it.y1, it.x2, it.y2) or (it.x1, it.y1) == (it.x2, it.y2):
                raise HTTPException(422, f"A {it.kind} needs a start and an end")
            items.append({"id": it.id, "kind": it.kind, "x1": it.x1, "y1": it.y1, "x2": it.x2, "y2": it.y2, "label": it.label})
        else:
            if None in (it.x, it.y, it.w, it.h):
                raise HTTPException(422, f"A {it.kind} area needs a position and a size")
            items.append({"id": it.id, "kind": it.kind, "x": it.x, "y": it.y, "w": it.w, "h": it.h, "label": it.label})
    name = body.section.strip()
    ensure_section(db, ctx, name)
    s = db.scalar(select(FloorSection).where(FloorSection.tenant_id == ctx.tenant_id, FloorSection.name == name))
    s.layout = {"room": [[x, y] for x, y in body.room], "items": items}
    db.commit()
    return section_out(s)


@router.delete("/floor/sections/{sid}")
def delete_section(sid: str, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    s = own_section(db, ctx, sid)
    if db.scalar(select(DiningTable.id).where(DiningTable.tenant_id == ctx.tenant_id, DiningTable.section == s.name)):
        raise HTTPException(409, f"Move or remove the tables in {s.name} first")
    db.delete(s)
    db.commit()
    return floor_plan(ctx, db)


class TableIn(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    seats: int = Field(default=4, ge=1, le=40)
    section: str = Field(default="Main", min_length=1, max_length=40)
    shape: str = Field(default="square", pattern=SHAPES)
    x: int = Field(default=1, ge=0, le=200)
    y: int = Field(default=1, ge=0, le=200)
    rotation: int = Field(default=0, ge=0, le=270)


class TablePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=20)
    seats: int | None = Field(default=None, ge=1, le=40)
    section: str | None = Field(default=None, min_length=1, max_length=40)
    sort: int | None = Field(default=None, ge=0, le=10_000)
    shape: str | None = Field(default=None, pattern=SHAPES)
    x: int | None = Field(default=None, ge=0, le=200)
    y: int | None = Field(default=None, ge=0, le=200)
    rotation: int | None = Field(default=None, ge=0, le=270)


@router.get("/floor/tables")
def list_tables(ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    ts = db.scalars(select(DiningTable).where(DiningTable.tenant_id == ctx.tenant_id).order_by(DiningTable.sort)).all()
    return [table_out(t) for t in ts]


def name_free(db: Session, ctx: Ctx, name: str, skip: str | None = None) -> None:
    hit = db.scalar(select(DiningTable.id).where(DiningTable.tenant_id == ctx.tenant_id, func.lower(DiningTable.name) == name.lower()))
    if hit and hit != skip:
        raise HTTPException(409, f"There is already a table called {name}")


@router.post("/floor/tables", status_code=201)
def add_table(body: TableIn, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    name_free(db, ctx, body.name.strip())
    ensure_section(db, ctx, body.section.strip())
    n = db.scalar(select(func.max(DiningTable.sort)).where(DiningTable.tenant_id == ctx.tenant_id))
    t = DiningTable(tenant_id=ctx.tenant_id, **body.model_dump(exclude={"name", "section"}), name=body.name.strip(),
                    section=body.section.strip(), sort=(n or 0) + 1)
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
    if "section" in data:
        data["section"] = data["section"].strip()
        ensure_section(db, ctx, data["section"])
    for k, v in data.items():
        setattr(t, k, v)
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
