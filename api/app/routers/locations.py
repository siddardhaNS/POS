"""Multi-location: one business (Brand) running several outlets, each its own tenant.

Owners reach every location of their brand; managers reach their home location plus any they were granted
(UserLocation). Switching location issues a token for that tenant (POST /auth/switch); everything else stays
scoped to ctx.tenant_id as before.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import LIVE_STATUSES, PERMISSIONS, Ctx, current_user, has_location_access, needs, require
from ..models import (AuditLog, Brand, DiningTable, FloorSection, MenuCategory, MenuItem, ModifierGroup, ModifierOption,
                      Order, Tenant, User, UserLocation)
from ..seed import TABLE_SEATS, provision_tenant
from .auth import unique_slug
from .pos import money, tenant_tz

router = APIRouter(tags=["locations"])


# ---------- Access ----------

def home_of(db: Session, ctx: Ctx) -> Tenant:
    home = db.get(Tenant, ctx.user.tenant_id) if ctx.user.tenant_id else None
    if home is None:
        raise HTTPException(403, "Restaurant account required")
    return home


def accessible(db: Session, user: User, home: Tenant) -> list[Tenant]:
    """Every location this user may switch into, home first."""
    out = [home]
    if home.brand_id and user.role in ("owner", "manager"):
        if user.role == "owner":
            others = db.scalars(select(Tenant).where(Tenant.brand_id == home.brand_id, Tenant.id != home.id)
                                .order_by(Tenant.created_at)).all()
        else:
            others = db.scalars(select(Tenant).join(UserLocation, UserLocation.tenant_id == Tenant.id)
                                .where(UserLocation.user_id == user.id, Tenant.brand_id == home.brand_id,
                                       Tenant.id != home.id).order_by(Tenant.created_at)).all()
        out += list(others)
    return out


def brand_location(db: Session, ctx: Ctx, tid: str) -> Tenant:
    """A location of the caller's business (404 for anything else, so other tenants aren't even confirmed)."""
    home = home_of(db, ctx)
    t = db.get(Tenant, tid)
    if t is None or not has_location_access(db, ctx.user, home, t):
        raise HTTPException(404, "Location not found")
    return t


def owner_only(ctx: Ctx = Depends(require("locations")), _: Ctx = Depends(needs("locations"))) -> Ctx:
    if ctx.user.role != "owner":
        raise HTTPException(403, "Only the owner can manage locations")
    return ctx


# ---------- Numbers ----------

def net_of(o: Order) -> Decimal:
    """Sales after discounts and refunds, before tax and tips (same rule as the Reports screen)."""
    taxable = o.subtotal - o.discount_amount
    gross = taxable + o.tax + o.tip
    return taxable - (o.refunded * taxable / gross if gross else 0)


def local_range(t: Tenant, start: date, end: date) -> tuple[datetime, datetime]:
    tz = tenant_tz(t)
    return datetime.combine(start, time.min, tz), datetime.combine(end + timedelta(days=1), time.min, tz)


def totals(db: Session, t: Tenant, start: date, end: date) -> dict:
    lo, hi = local_range(t, start, end)
    orders = db.scalars(select(Order).where(Order.tenant_id == t.id, Order.status.in_(("paid", "refunded")),
                                            Order.closed_at >= lo, Order.closed_at < hi)).all()
    net = sum((net_of(o) for o in orders), Decimal(0))
    open_now = db.scalar(select(func.count()).select_from(Order)
                         .where(Order.tenant_id == t.id, Order.status == "open")) or 0
    return {
        "net_sales": money(net), "orders": len(orders), "avg_check": money(net / len(orders)) if orders else 0,
        "tax": money(sum((o.tax for o in orders), Decimal(0))),
        "tips": money(sum((o.tip for o in orders), Decimal(0))),
        "discounts": money(sum((o.discount_amount for o in orders), Decimal(0))),
        "refunds": money(sum((o.refunded for o in orders), Decimal(0))),
        "open_checks": open_now,
    }


def location_out(t: Tenant, home: Tenant, current: Tenant | None) -> dict:
    return {
        "id": t.id, "name": t.name, "location_name": t.location_name or "", "city": t.city, "address": t.address,
        "phone": t.phone, "status": t.status, "currency": t.currency, "timezone": t.timezone,
        "home": t.id == home.id, "current": current is not None and t.id == current.id,
    }


def today_in(t: Tenant) -> date:
    return datetime.now(tenant_tz(t)).date()


@router.get("/locations")
def list_locations(ctx: Ctx = Depends(current_user), db: Session = Depends(get_db)):
    """Locations the signed-in user can switch into, with today's quick numbers where they can see reports."""
    home = home_of(db, ctx)
    reports = "reports" in PERMISSIONS.get(ctx.user.role, set())
    out = []
    for t in accessible(db, ctx.user, home):
        row = location_out(t, home, ctx.tenant)
        if reports and t.status in LIVE_STATUSES:
            d = today_in(t)
            row["today"] = totals(db, t, d, d)
        out.append(row)
    return out


@router.get("/locations/summary", dependencies=[Depends(needs("locations"))])
def consolidated(start: date | None = Query(None), end: date | None = Query(None), ctx: Ctx = Depends(current_user),
                 db: Session = Depends(get_db)):
    """Per-location and business-wide sales for a date range (each location's own calendar days)."""
    home = home_of(db, ctx)
    if "reports" not in PERMISSIONS.get(ctx.user.role, set()):
        raise HTTPException(403, "Your role can't access reports")
    start = start or today_in(ctx.tenant or home)
    end = end or start
    if end < start:
        raise HTTPException(422, "End date is before start date")
    if (end - start).days > 366:
        raise HTTPException(422, "Pick a range of a year or less")
    rows = []
    for t in accessible(db, ctx.user, home):
        if t.status not in LIVE_STATUSES:
            continue
        rows.append({**location_out(t, home, ctx.tenant), **totals(db, t, start, end)})
    currencies = {r["currency"] for r in rows}
    total = None
    if len(currencies) == 1:
        keys = ("net_sales", "orders", "tax", "tips", "discounts", "refunds", "open_checks")
        total = {k: round(sum(r[k] for r in rows), 2) for k in keys}
        total["orders"] = int(total["orders"])
        total["open_checks"] = int(total["open_checks"])
        total["avg_check"] = round(total["net_sales"] / total["orders"], 2) if total["orders"] else 0
        total["currency"] = rows[0]["currency"]
    return {"start": start.isoformat(), "end": end.isoformat(), "locations": rows, "total": total}


# ---------- Menu & floor copy ----------

def copy_menu(db: Session, src: Tenant, dst: Tenant, mode: str) -> dict:
    """Copy categories, items and modifier groups from src to dst, matching by name.

    add_missing: create what dst lacks (categories, items, option groups on existing items); keep dst prices.
    overwrite_prices: the same, and also set dst item and option prices to src's.
    """
    stats = {"categories_added": 0, "items_added": 0, "groups_added": 0, "prices_updated": 0}
    src_cats = db.scalars(select(MenuCategory).where(MenuCategory.tenant_id == src.id).order_by(MenuCategory.sort)).all()
    dst_cats = {c.name.lower(): c for c in db.scalars(select(MenuCategory).where(MenuCategory.tenant_id == dst.id))}
    next_sort = max((c.sort for c in dst_cats.values()), default=-1) + 1
    cat_map: dict[str, MenuCategory] = {}
    for c in src_cats:
        d = dst_cats.get(c.name.lower())
        if d is None:
            d = MenuCategory(tenant_id=dst.id, name=c.name, phase=c.phase, sort=c.sort if not dst_cats else next_sort)
            next_sort += 1
            db.add(d)
            stats["categories_added"] += 1
        cat_map[c.id] = d
    db.flush()

    src_items = db.scalars(select(MenuItem).where(MenuItem.tenant_id == src.id).order_by(MenuItem.sort)).all()
    dst_items = {m.name.lower(): m for m in db.scalars(select(MenuItem).where(MenuItem.tenant_id == dst.id))}
    src_names = {m.id: m.name.lower() for m in src_items}
    src_groups: dict[str, list[ModifierGroup]] = {}
    for g in db.scalars(select(ModifierGroup).where(ModifierGroup.tenant_id == src.id)
                        .options(selectinload(ModifierGroup.options)).order_by(ModifierGroup.sort)):
        src_groups.setdefault(g.menu_item_id, []).append(g)
    dst_groups: dict[str, list[ModifierGroup]] = {}
    for g in db.scalars(select(ModifierGroup).where(ModifierGroup.tenant_id == dst.id)
                        .options(selectinload(ModifierGroup.options))):
        dst_groups.setdefault(g.menu_item_id, []).append(g)

    def clone_group(g: ModifierGroup, item: MenuItem) -> ModifierGroup:
        n = ModifierGroup(tenant_id=dst.id, menu_item_id=item.id, name=g.name, min_select=g.min_select,
                          max_select=g.max_select, sort=g.sort)
        # Combo choices link to the dish with the same name at the destination, when it has one.
        n.options = [ModifierOption(tenant_id=dst.id, name=o.name, price=o.price, sort=o.sort,
                                    menu_item_id=getattr(dst_items.get(src_names.get(o.menu_item_id, "")), "id", None))
                     for o in g.options]
        return n

    for m in src_items:
        d = dst_items.get(m.name.lower())
        if d is None:
            d = MenuItem(tenant_id=dst.id, category_id=cat_map[m.category_id].id, name=m.name, price=m.price,
                         is_veg=m.is_veg, station=m.station, available=m.available, sort=m.sort,
                         description=m.description, tags=list(m.tags or []), allergens=list(m.allergens or []),
                         nutrition=dict(m.nutrition or {}), channels=list(m.channels or []))
            db.add(d)
            db.flush()
            dst_items[m.name.lower()] = d
            for g in src_groups.get(m.id, []):
                db.add(clone_group(g, d))
                stats["groups_added"] += 1
            stats["items_added"] += 1
            continue
        if mode == "overwrite_prices" and d.price != m.price:
            d.price = m.price
            stats["prices_updated"] += 1
        have = {g.name.lower(): g for g in dst_groups.get(d.id, [])}
        for g in src_groups.get(m.id, []):
            mine = have.get(g.name.lower())
            if mine is None:
                db.add(clone_group(g, d))
                stats["groups_added"] += 1
            elif mode == "overwrite_prices":
                opts = {o.name.lower(): o for o in mine.options}
                for o in g.options:
                    if o.name.lower() in opts and opts[o.name.lower()].price != o.price:
                        opts[o.name.lower()].price = o.price
                        stats["prices_updated"] += 1
    db.flush()
    return stats


def copy_floor(db: Session, src: Tenant, dst: Tenant) -> None:
    """Replace dst's floor plan (sections + tables) with a copy of src's."""
    for model in (DiningTable, FloorSection):
        for row in db.scalars(select(model).where(model.tenant_id == dst.id)):
            db.delete(row)
    db.flush()
    for s in db.scalars(select(FloorSection).where(FloorSection.tenant_id == src.id)):
        db.add(FloorSection(tenant_id=dst.id, name=s.name, sort=s.sort))
    for t in db.scalars(select(DiningTable).where(DiningTable.tenant_id == src.id)):
        db.add(DiningTable(tenant_id=dst.id, name=t.name, seats=t.seats, sort=t.sort, section=t.section, shape=t.shape,
                           x=t.x, y=t.y, rotation=t.rotation))
    db.flush()


# ---------- Add location ----------

class LocationIn(BaseModel):
    location_name: str = Field(min_length=1, max_length=80)
    address: str = Field(default="", max_length=400)
    city: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=40)
    copy_menu_from: str | None = Field(default=None, max_length=36)
    copy_tables: bool = False


@router.post("/locations", status_code=201)
def add_location(body: LocationIn, ctx: Ctx = Depends(owner_only), db: Session = Depends(get_db)):
    home = home_of(db, ctx)
    if home.status not in LIVE_STATUSES:
        raise HTTPException(403, f"Restaurant account is {home.status}")
    src = brand_location(db, ctx, body.copy_menu_from) if body.copy_menu_from else None
    if not home.brand_id:
        brand = Brand(name=home.name)
        db.add(brand)
        db.flush()
        home.brand_id = brand.id
    name = body.location_name.strip()
    if db.scalar(select(Tenant.id).where(Tenant.brand_id == home.brand_id,
                                         func.lower(Tenant.location_name) == name.lower())):
        raise HTTPException(409, f"You already have a location called {name}")
    t = Tenant(
        name=home.name, slug=unique_slug(db, f"{home.name} {name}"), market=home.market, currency=home.currency,
        tax_rate=home.tax_rate, tax_label=home.tax_label, status=home.status, contact_name=home.contact_name,
        email=home.email, phone=body.phone.strip() or home.phone, city=body.city.strip() or home.city,
        address=body.address.strip(), cuisine=home.cuisine, outlets=1, service_style=home.service_style,
        trial_ends_at=home.trial_ends_at, reviewed_at=home.reviewed_at, tax_id=home.tax_id, timezone=home.timezone,
        tips_enabled=home.tips_enabled, receipt_footer=home.receipt_footer, auto_print_kot=home.auto_print_kot,
        auto_print_receipt=home.auto_print_receipt, modules=list(home.modules or []), inventory_auto_86=home.inventory_auto_86,
        require_clock_in=home.require_clock_in, ot_daily_hours=home.ot_daily_hours, ot_weekly_hours=home.ot_weekly_hours,
    )
    t.brand_id = home.brand_id
    t.location_name = name
    db.add(t)
    db.flush()
    if src is not None:
        copy_menu(db, src, t, "add_missing")
        if body.copy_tables:
            copy_floor(db, src, t)
        else:
            starter_floor(db, t)
    else:
        provision_tenant(db, t)
        if body.copy_tables:
            copy_floor(db, ctx.tenant or home, t)
    db.commit()
    return location_out(t, home, ctx.tenant)


def starter_floor(db: Session, t: Tenant) -> None:
    """The starter floor provision_tenant would create, for a location whose menu was copied."""
    db.add(FloorSection(tenant_id=t.id, name="Main", sort=0))
    db.add(FloorSection(tenant_id=t.id, name="Patio", sort=1))
    for i, seats in enumerate(TABLE_SEATS):
        main = i < 8
        j = i if main else i - 8
        shape = "rect" if seats >= 6 else "round" if seats <= 2 else "square"
        db.add(DiningTable(tenant_id=t.id, name=f"T{i + 1}", seats=seats, sort=i, section="Main" if main else "Patio",
                           shape=shape, x=(j % 4) * 6 + 2, y=(j // 4) * 6 + 2))
    db.flush()


class LocationPatch(BaseModel):
    location_name: str = Field(min_length=1, max_length=80)


@router.patch("/locations/{tid}")
def rename_location(tid: str, body: LocationPatch, ctx: Ctx = Depends(owner_only), db: Session = Depends(get_db)):
    t = brand_location(db, ctx, tid)
    t.location_name = body.location_name.strip()
    db.commit()
    return location_out(t, home_of(db, ctx), ctx.tenant)


class CopyMenuIn(BaseModel):
    from_tenant_id: str = Field(max_length=36)
    mode: str = Field(default="add_missing", pattern=r"^(add_missing|overwrite_prices)$")


@router.post("/locations/{tid}/copy-menu")
def copy_menu_to(tid: str, body: CopyMenuIn, ctx: Ctx = Depends(owner_only), db: Session = Depends(get_db)):
    dst = brand_location(db, ctx, tid)
    src = brand_location(db, ctx, body.from_tenant_id)
    if src.id == dst.id:
        raise HTTPException(422, "Pick a different location to copy from")
    stats = copy_menu(db, src, dst, body.mode)
    label = src.location_name or src.name
    db.add(AuditLog(tenant_id=dst.id, user_id=ctx.user.id, user_name=ctx.user.name, action="menu_sync",
                    detail=f"From {label}: {stats['items_added']} items added, {stats['prices_updated']} prices updated"))
    db.commit()
    return stats


# ---------- Manager access ----------

def brand_tenants(db: Session, home: Tenant) -> list[Tenant]:
    if not home.brand_id:
        return [home]
    return list(db.scalars(select(Tenant).where(Tenant.brand_id == home.brand_id).order_by(Tenant.created_at)))


@router.get("/locations/access")
def list_access(ctx: Ctx = Depends(owner_only), db: Session = Depends(get_db)):
    """Managers across the business and the extra locations each may switch into."""
    tenants = {t.id: t for t in brand_tenants(db, home_of(db, ctx))}
    managers = db.scalars(select(User).where(User.tenant_id.in_(tenants), User.role == "manager", User.is_active)
                          .order_by(User.created_at)).all()
    grants: dict[str, list[str]] = {}
    for g in db.scalars(select(UserLocation).where(UserLocation.user_id.in_([m.id for m in managers]),
                                                   UserLocation.tenant_id.in_(tenants))):
        grants.setdefault(g.user_id, []).append(g.tenant_id)
    return [{"id": m.id, "name": m.name, "home_tenant_id": m.tenant_id,
             "home_location": tenants[m.tenant_id].location_name or tenants[m.tenant_id].name,
             "tenant_ids": grants.get(m.id, [])} for m in managers]


class AccessIn(BaseModel):
    tenant_ids: list[str] = Field(default_factory=list, max_length=200)


@router.put("/locations/access/{user_id}")
def set_access(user_id: str, body: AccessIn, ctx: Ctx = Depends(owner_only), db: Session = Depends(get_db)):
    """Set exactly which extra locations a manager may switch into (grant and revoke in one call)."""
    tenants = {t.id for t in brand_tenants(db, home_of(db, ctx))}
    m = db.get(User, user_id)
    if m is None or m.tenant_id not in tenants or m.role != "manager":
        raise HTTPException(404, "Manager not found")
    wanted = set(body.tenant_ids) - {m.tenant_id}
    if wanted - tenants:
        raise HTTPException(404, "Location not found")
    existing = {g.tenant_id: g for g in db.scalars(select(UserLocation).where(UserLocation.user_id == m.id))}
    for tid, g in existing.items():
        if tid not in wanted:
            db.delete(g)
    for tid in wanted - set(existing):
        db.add(UserLocation(user_id=m.id, tenant_id=tid, role="manager"))
    db.commit()
    return {"id": m.id, "tenant_ids": sorted(wanted)}
