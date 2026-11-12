"""Bootstrap data: platform admin, per-market starter kit for newly approved tenants, optional demo tenant."""
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import DiningTable, MenuCategory, MenuItem, ModifierGroup, ModifierOption, Tenant, User, now
from .security import hash_secret

MARKETS = {
    "IN": {"currency": "INR", "tax_rate": Decimal("0.05"), "tax_label": "CGST 2.5% + SGST 2.5%",
           "timezone": "Asia/Kolkata", "tips_enabled": False},
    "US": {"currency": "USD", "tax_rate": Decimal("0.08875"), "tax_label": "Sales tax 8.875%",
           "timezone": "America/New_York", "tips_enabled": True},
}

# (name, INR price, veg, category, station)
STARTER_MENU = [
    ("Chicken 65", 289, False, "Starters", "Fry"),
    ("Paneer Tikka", 279, True, "Starters", "Tandoor"),
    ("Samosa Chaat", 149, True, "Starters", "Cold"),
    ("Amritsari Fish", 359, False, "Starters", "Fry"),
    ("Hyderabadi Chicken Biryani", 349, False, "Mains", "Curry"),
    ("Paneer Tikka Masala", 299, True, "Mains", "Curry"),
    ("Dal Makhani", 249, True, "Mains", "Curry"),
    ("Butter Chicken", 379, False, "Mains", "Curry"),
    ("Veg Dum Biryani", 279, True, "Mains", "Curry"),
    ("Mutton Rogan Josh", 449, False, "Mains", "Curry"),
    ("Kadai Paneer", 289, True, "Mains", "Curry"),
    ("Chole Masala", 229, True, "Mains", "Curry"),
    ("Butter Naan", 59, True, "Breads", "Tandoor"),
    ("Garlic Naan", 79, True, "Breads", "Tandoor"),
    ("Tandoori Roti", 39, True, "Breads", "Tandoor"),
    ("Jeera Rice", 149, True, "Breads", "Curry"),
    ("Sweet Lassi", 129, True, "Drinks", "Bar"),
    ("Masala Chaas", 79, True, "Drinks", "Bar"),
    ("Fresh Lime Soda", 119, True, "Drinks", "Bar"),
    ("Masala Chai", 69, True, "Drinks", "Bar"),
    ("Gulab Jamun", 89, True, "Desserts", "Cold"),
    ("Rasmalai", 119, True, "Desserts", "Cold"),
]
CATEGORIES = ["Starters", "Mains", "Breads", "Drinks", "Desserts"]
TABLE_SEATS = [2, 2, 4, 4, 4, 6, 2, 2, 4, 4, 4, 6]


def market_price(inr: int, market: str) -> Decimal:
    if market == "US":
        return Decimal(max(3, round(inr / 30))) - Decimal("0.01")
    return Decimal(inr)


def provision_tenant(db: Session, tenant: Tenant) -> None:
    """Give a newly approved restaurant a working floor and menu so they can ring a sale in minutes."""
    if db.scalar(select(MenuCategory.id).where(MenuCategory.tenant_id == tenant.id).limit(1)):
        return
    cats = {}
    for i, name in enumerate(CATEGORIES):
        c = MenuCategory(tenant_id=tenant.id, name=name, sort=i)
        db.add(c)
        cats[name] = c
    db.flush()
    for i, (name, p, veg, cat, station) in enumerate(STARTER_MENU):
        db.add(MenuItem(tenant_id=tenant.id, category_id=cats[cat].id, name=name,
                        price=market_price(p, tenant.market), is_veg=veg, station=station, sort=i))
    for i, seats in enumerate(TABLE_SEATS):
        db.add(DiningTable(tenant_id=tenant.id, name=f"T{i + 1}", seats=seats, sort=i,
                           section="Main" if i < 8 else "Patio"))
    db.flush()
    add_starter_modifiers(db, tenant)


# item name -> [(group, min, max, [(option, INR price delta)])]
STARTER_MODIFIERS = {
    "Hyderabadi Chicken Biryani": [("Spice level", 1, 1, [("Mild", 0), ("Medium", 0), ("Hot", 0)]),
                                   ("Add-ons", 0, 3, [("Extra raita", 30), ("Boiled egg", 25), ("Extra chicken", 120)])],
    "Veg Dum Biryani": [("Spice level", 1, 1, [("Mild", 0), ("Medium", 0), ("Hot", 0)])],
    "Butter Chicken": [("Spice level", 1, 1, [("Mild", 0), ("Medium", 0), ("Hot", 0)]),
                       ("Make it", 0, 1, [("Boneless", 40)])],
    "Paneer Tikka Masala": [("Spice level", 1, 1, [("Mild", 0), ("Medium", 0), ("Hot", 0)])],
    "Butter Naan": [("Add-ons", 0, 2, [("Extra butter", 15), ("Cheese", 40)])],
    "Sweet Lassi": [("Size", 1, 1, [("Regular", 0), ("Large", 40)])],
    "Fresh Lime Soda": [("Style", 1, 1, [("Sweet", 0), ("Salted", 0), ("Mixed", 0)])],
    "Masala Chai": [("Milk", 0, 1, [("Oat milk", 30)]), ("Sugar", 1, 1, [("Regular", 0), ("Less", 0), ("None", 0)])],
}


def option_price(inr: int, market: str) -> Decimal:
    if not inr:
        return Decimal(0)
    return Decimal(max(1, round(inr / 30))) if market == "US" else Decimal(inr)


def add_starter_modifiers(db: Session, tenant: Tenant) -> None:
    if db.scalar(select(ModifierGroup.id).where(ModifierGroup.tenant_id == tenant.id).limit(1)):
        return
    items = {m.name: m for m in db.scalars(select(MenuItem).where(MenuItem.tenant_id == tenant.id))}
    for item_name, groups in STARTER_MODIFIERS.items():
        m = items.get(item_name)
        if not m:
            continue
        for gi, (gname, lo, hi, opts) in enumerate(groups):
            g = ModifierGroup(tenant_id=tenant.id, menu_item_id=m.id, name=gname, min_select=lo, max_select=hi, sort=gi)
            g.options = [ModifierOption(tenant_id=tenant.id, name=o, price=option_price(p, tenant.market), sort=oi)
                         for oi, (o, p) in enumerate(opts)]
            db.add(g)


def ensure_platform_admin(db: Session) -> None:
    email = settings.platform_admin_email.lower()
    if db.scalar(select(User).where(User.email == email)):
        return
    db.add(User(name="Platform Admin", email=email, role="platform_admin",
                password_hash=hash_secret(settings.platform_admin_password)))


DEMO_STAFF = [
    ("Kavya Rao", "manager", "2222"),
    ("Neha T.", "cashier", "3333"),
    ("Ravi K.", "captain", "4444"),
    ("Imran A.", "chef", "5555"),
]


def ensure_demo(db: Session) -> None:
    existing = db.scalars(select(Tenant).where(Tenant.slug.in_(("tiffin-indiranagar", "saffron-smoke")))).all()
    if existing:
        for t in existing:  # demo tenants created before modifiers existed
            add_starter_modifiers(db, t)
        return
    demos = [
        ("Tiffin Indiranagar", "tiffin-indiranagar", "IN", "Vivek Shah", "owner@tiffin.in", "Bengaluru", "trial"),
        ("Saffron & Smoke", "saffron-smoke", "US", "Maya Patel", "owner@saffronsmoke.com", "Jersey City, NJ", "trial"),
        ("Dosa Republic", "dosa-republic", "IN", "Arun Menon", "hello@dosarepublic.in", "Chennai", "pending"),
        ("Curry Leaf Kitchen", "curry-leaf-kitchen", "US", "Sam Iyer", "sam@curryleaf.us", "Austin, TX", "pending"),
    ]
    for name, slug, market, contact, email, city, status in demos:
        t = Tenant(name=name, slug=slug, market=market, contact_name=contact, email=email, city=city,
                   cuisine="Indian", status=status, **MARKETS[market])
        if status == "trial":
            t.reviewed_at = now()
            t.trial_ends_at = now() + timedelta(days=settings.trial_days)
        db.add(t)
        db.flush()
        db.add(User(tenant_id=t.id, name=contact, email=email, role="owner",
                    password_hash=hash_secret("demo12345"), pin_hash=hash_secret("1111")))
        if status == "trial":
            provision_tenant(db, t)
            for sname, role, pin in DEMO_STAFF:
                db.add(User(tenant_id=t.id, name=sname, role=role, pin_hash=hash_secret(pin)))


def bootstrap(db: Session) -> None:
    ensure_platform_admin(db)
    if settings.seed_demo:
        ensure_demo(db)
    db.commit()
