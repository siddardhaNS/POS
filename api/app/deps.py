from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import Tenant, User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)

LIVE_STATUSES = {"trial", "active"}

# Mirrors the role matrix in the design: what each role may do.
PERMISSIONS: dict[str, set[str]] = {
    "owner": {"floor", "order", "pay", "online", "kds", "reports", "menu", "menu_edit", "staff", "settings"},
    "manager": {"floor", "order", "pay", "online", "kds", "reports", "menu", "menu_edit", "staff"},
    "cashier": {"floor", "order", "pay", "online"},
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


def require(perm: str):
    def dep(ctx: Ctx = Depends(tenant_user)) -> Ctx:
        if perm not in PERMISSIONS.get(ctx.user.role, set()):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Your role can't access {perm}")
        return ctx

    return dep
