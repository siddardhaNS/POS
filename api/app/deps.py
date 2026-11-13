from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import Tenant, User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)

LIVE_STATUSES = {"trial", "active"}

# Optional modules a platform admin turns on per restaurant. Everything not listed here is basic and always on.
MODULES: dict[str, tuple[str, str]] = {
    "online": ("Online orders", "Delivery-app and website orders in one queue, with accept and reject."),
    "reports_plus": ("Advanced reports", "Item, staff, payment, exception and tax reports, and CSV exports."),
    "printing": ("Direct printing", "Thermal receipt and kitchen printers routed by station, and the print bridge."),
    "menu_scan": ("Menu photo scan", "Build the menu from photos or PDFs of a printed menu."),
}


def has_module(t: Tenant | None, key: str) -> bool:
    return t is not None and key in (t.modules or [])

# Mirrors the role matrix in the design: what each role may do.
PERMISSIONS: dict[str, set[str]] = {
    "owner": {"floor", "order", "pay", "online", "kds", "reports", "menu", "menu_edit", "staff", "settings",
              "tables", "discount", "refund", "cash", "history"},
    "manager": {"floor", "order", "pay", "online", "kds", "reports", "menu", "menu_edit", "staff",
                "tables", "discount", "refund", "cash", "history"},
    "cashier": {"floor", "order", "pay", "online", "cash", "history"},
    "captain": {"floor", "order"},
    "chef": {"kds", "menu"},
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
    return Ctx(user=user, tenant=tenant)


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
