import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import LIVE_STATUSES, PERMISSIONS, Ctx, current_user, tenant_user
from ..models import Tenant, User
from ..security import create_token, hash_secret, verify_secret
from ..seed import MARKETS

router = APIRouter(tags=["auth"])


def tenant_out(t: Tenant | None) -> dict | None:
    if not t:
        return None
    return {
        "id": t.id, "name": t.name, "slug": t.slug, "market": t.market, "currency": t.currency,
        "tax_rate": float(t.tax_rate), "tax_label": t.tax_label, "status": t.status,
        "phone": t.phone, "city": t.city, "address": t.address, "tax_id": t.tax_id, "timezone": t.timezone,
        "tips_enabled": t.tips_enabled, "receipt_footer": t.receipt_footer,
        "auto_print_kot": t.auto_print_kot, "auto_print_receipt": t.auto_print_receipt,
        "trial_ends_at": t.trial_ends_at.isoformat() if t.trial_ends_at else None,
    }


def session_out(u: User, t: Tenant | None) -> dict:
    return {
        "token": create_token(u.id, u.tenant_id, u.role),
        "user": {"id": u.id, "name": u.name, "email": u.email, "role": u.role,
                 "permissions": sorted(PERMISSIONS.get(u.role, set()))},
        "tenant": tenant_out(t),
    }


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@router.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if not u or not u.is_active or not verify_secret(body.password, u.password_hash):
        raise HTTPException(401, "Email or password is incorrect")
    t = db.get(Tenant, u.tenant_id) if u.tenant_id else None
    if t and t.status not in LIVE_STATUSES:
        msg = {
            "pending": "Your free-trial request is under review. We'll email you as soon as it's approved.",
            "rejected": "Your application wasn't approved. Reply to our email if you think this is a mistake.",
            "suspended": "This restaurant account is suspended. Contact support.",
        }.get(t.status, "Account unavailable")
        raise HTTPException(403, msg)
    return session_out(u, t)


class PinIn(BaseModel):
    user_id: str
    pin: str = Field(pattern=r"^\d{4}$")


@router.get("/pos/staff")
def staff_tiles(ctx: Ctx = Depends(tenant_user), db: Session = Depends(get_db)):
    """Who's working? tiles for the shared POS device."""
    rows = db.scalars(select(User).where(User.tenant_id == ctx.tenant_id, User.is_active, User.pin_hash.is_not(None))
                      .order_by(User.created_at)).all()
    return [{"id": u.id, "name": u.name, "role": u.role} for u in rows]


@router.post("/auth/pin")
def pin_login(body: PinIn, ctx: Ctx = Depends(tenant_user), db: Session = Depends(get_db)):
    """Swap the signed-in staff member on a device that already holds a session for this restaurant."""
    u = db.get(User, body.user_id)
    if not u or u.tenant_id != ctx.tenant_id or not u.is_active or not verify_secret(body.pin, u.pin_hash):
        raise HTTPException(401, "Wrong PIN")
    return session_out(u, ctx.tenant)


@router.get("/auth/me")
def me(ctx: Ctx = Depends(current_user)):
    out = session_out(ctx.user, ctx.tenant)
    out.pop("token")
    return out


class SignupIn(BaseModel):
    restaurant_name: str = Field(min_length=2, max_length=160)
    market: str = Field(pattern=r"^(IN|US)$")
    contact_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    phone: str = Field(default="", max_length=40)
    city: str = Field(default="", max_length=120)
    cuisine: str = Field(default="", max_length=120)
    outlets: int = Field(default=1, ge=1, le=500)
    service_style: str = Field(default="Full service", max_length=40)
    message: str = Field(default="", max_length=2000)
    password: str = Field(min_length=8, max_length=128)


def unique_slug(db: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "restaurant"
    slug, n = base, 1
    while db.scalar(select(Tenant.id).where(Tenant.slug == slug)):
        n += 1
        slug = f"{base}-{n}"
    return slug


@router.post("/public/signup", status_code=201)
def signup(body: SignupIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(409, "An account with this email already exists")
    t = Tenant(name=body.restaurant_name.strip(), slug=unique_slug(db, body.restaurant_name), market=body.market,
               contact_name=body.contact_name.strip(), email=email, phone=body.phone, city=body.city,
               cuisine=body.cuisine, outlets=body.outlets, service_style=body.service_style,
               message=body.message, status="pending", **MARKETS[body.market])
    db.add(t)
    db.flush()
    db.add(User(tenant_id=t.id, name=body.contact_name.strip(), email=email, role="owner",
                password_hash=hash_secret(body.password)))
    db.commit()
    return {"id": t.id, "status": t.status, "message": "Thanks! Our team reviews every restaurant within one business day."}
