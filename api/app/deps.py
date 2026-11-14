from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Tenant, User, UserLocation
from .security import decode_token

bearer = HTTPBearer(auto_error=False)

LIVE_STATUSES = {"trial", "active"}

# Optional modules a platform admin turns on per restaurant. Everything not listed here is basic and always on.
MODULES: dict[str, tuple[str, str]] = {
    "online": ("Online orders", "Delivery-app and website orders in one queue, with accept and reject."),
    "reports_plus": ("Advanced reports", "Item, staff, payment, exception and tax reports, and CSV exports."),
    "printing": ("Direct printing", "Thermal receipt and kitchen printers routed by station, and the print bridge."),
    "menu_scan": ("Menu photo scan", "Build the menu from photos or PDFs of a printed menu."),
    "inventory": ("Inventory", "Stock, recipes and food cost, suppliers and purchase orders, stock counts, low-stock alerts."),
    "reservations": ("Reservations & waitlist", "Bookings by time and table, a walk-in waitlist with quoted waits and notify by WhatsApp or SMS, and seating that opens the check."),
    "qr_ordering": ("QR ordering", "Guests scan the code on their table to see the menu, order, call a waiter or ask for the bill."),
    "locations": ("Multi-location", "Run several outlets under one business: switch location, add outlets with the menu copied, combined reports, manager access per outlet."),
    "kiosk": ("Self-order kiosk", "A touch screen at the counter where guests browse the menu, order and pay at the till; orders arrive with a number to call."),
    "timeclock": ("Staff time", "Clock in and out with a PIN, breaks, timesheets with overtime, labour cost, tip pooling and payroll export."),
}


def has_module(t: Tenant | None, key: str) -> bool:
    return t is not None and key in (t.modules or [])


# Mirrors the role matrix in the design: what each role may do.
PERMISSIONS: dict[str, set[str]] = {
    "owner": {"floor", "order", "pay", "online", "kds", "reports", "menu", "menu_edit", "staff", "settings",
              "tables", "discount", "refund", "cash", "history",
              "inventory", "inventory_waste", "timesheets", "locations", "customers"},
    "manager": {"floor", "order", "pay", "online", "kds", "reports", "menu", "menu_edit", "staff",
                "tables", "discount", "refund", "cash", "history",
                "inventory", "inventory_waste", "timesheets", "customers"},
    "cashier": {"floor", "order", "pay", "online", "cash", "history", "customers"},
    "captain": {"floor", "order"},
    "chef": {"kds", "menu",
             "inventory_waste"},
}


@dataclass
class Ctx:
    user: User
    tenant: Tenant | None

    @property
    def tenant_id(self) -> str:
        assert self.tenant is not None
        return self.tenant.id


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)
) -> Ctx:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    try:
        data = decode_token(creds.credentials)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = db.get(User, data["sub"])
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled")
    tenant = db.get(Tenant, user.tenant_id) if user.tenant_id else None
    tid = data.get("tid")
    if tenant is not None and tid and tid != tenant.id:
        # Token for another location of the business (POST /auth/switch). Re-check access on every request so
        # revoked grants and forged tenant claims never reach a tenant-scoped endpoint.
        other = db.get(Tenant, tid)
        if other is None or not has_location_access(db, user, tenant, other):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "You no longer have access to this location")
        tenant = other
    return Ctx(user=user, tenant=tenant)


def has_location_access(db: Session, user: User, home: Tenant, target: Tenant) -> bool:
    """May `user` (whose home tenant is `home`) work in `target`? Only within the same brand: owners reach every
    location of their brand, managers only locations they were granted."""
    if target.id == home.id:
        return True
    if not home.brand_id or target.brand_id != home.brand_id or user.role not in ("owner", "manager"):
        return False
    if user.role == "owner":
        return True
    return db.scalar(select(UserLocation.id).where(UserLocation.user_id == user.id,
                                                   UserLocation.tenant_id == target.id)) is not None


def platform_admin(ctx: Ctx = Depends(current_user)) -> Ctx:
    if ctx.user.role != "platform_admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admins only")
    return ctx


def tenant_user(ctx: Ctx = Depends(current_user)) -> Ctx:
    if ctx.tenant is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Restaurant account required")
    if ctx.tenant.status not in LIVE_STATUSES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Restaurant account is {ctx.tenant.status}")
    return ctx


def needs(key: str):
    """Route dependency: the restaurant must have this optional module turned on."""
    def dep(ctx: Ctx = Depends(tenant_user)) -> Ctx:
        if not has_module(ctx.tenant, key):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                f"{MODULES[key][0]} isn't turned on for this restaurant. Contact Tiffin to add it.")
        return ctx

    return dep


def require(perm: str):
    def dep(ctx: Ctx = Depends(tenant_user)) -> Ctx:
        if perm == "floor_or_kds":  # any restaurant role may poll live change counters
            return ctx
        if perm not in PERMISSIONS.get(ctx.user.role, set()):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Your role can't access {perm}")
        return ctx

    return dep
