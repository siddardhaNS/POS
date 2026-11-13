"""Platform admin console: review free-trial applications and manage tenants."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import MODULES, Ctx, platform_admin
from ..models import Brand, Order, Tenant, User, now
from ..seed import provision_tenant

router = APIRouter(prefix="/admin", tags=["admin"])

STATUSES = ("pending", "trial", "active", "rejected", "suspended")


def row(t: Tenant, users: int = 0) -> dict:
    return {
        "id": t.id, "name": t.name, "slug": t.slug, "market": t.market, "status": t.status,
        "contact_name": t.contact_name, "email": t.email, "phone": t.phone, "city": t.city,
        "cuisine": t.cuisine, "outlets": t.outlets, "service_style": t.service_style, "message": t.message,
        "review_note": t.review_note, "users": users, "modules": [m for m in (t.modules or []) if m in MODULES],
        "created_at": t.created_at.isoformat(),
        "reviewed_at": t.reviewed_at.isoformat() if t.reviewed_at else None,
        "trial_ends_at": t.trial_ends_at.isoformat() if t.trial_ends_at else None,
        "brand_id": t.brand_id, "location_name": t.location_name or "",
    }


@router.get("/stats")
def stats(_: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Tenant.status, func.count()).group_by(Tenant.status)).all())
    markets = dict(db.execute(select(Tenant.market, func.count()).where(Tenant.status.in_(("trial", "active")))
                              .group_by(Tenant.market)).all())
    orders = db.scalar(select(func.count()).select_from(Order).where(Order.status == "paid")) or 0
    return {"by_status": {s: counts.get(s, 0) for s in STATUSES}, "live_by_market": markets, "paid_orders": orders}


@router.get("/tenants")
def list_tenants(status: str | None = None, q: str | None = None, _: Ctx = Depends(platform_admin),
                 db: Session = Depends(get_db)):
    users = (select(User.tenant_id, func.count().label("n")).group_by(User.tenant_id).subquery())
    stmt = select(Tenant, func.coalesce(users.c.n, 0)).outerjoin(users, users.c.tenant_id == Tenant.id)
    if status:
        stmt = stmt.where(Tenant.status == status)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(func.lower(Tenant.name).like(like) | func.lower(Tenant.email).like(like)
                          | func.lower(Tenant.city).like(like))
    out = [row(t, n) for t, n in db.execute(stmt.order_by(Tenant.created_at.desc())).all()]
    brands = {b.id: b.name for b in db.scalars(select(Brand))}
    sizes = dict(db.execute(select(Tenant.brand_id, func.count()).where(Tenant.brand_id.is_not(None))
                            .group_by(Tenant.brand_id)).all())
    for r in out:  # multi-location businesses: brand name and how many locations it runs
        r["brand"] = brands.get(r["brand_id"])
        r["locations"] = sizes.get(r["brand_id"], 1)
    return out


class ReviewIn(BaseModel):
    note: str = Field(default="", max_length=2000)


def get_tenant(db: Session, tid: str) -> Tenant:
    t = db.get(Tenant, tid)
    if not t:
        raise HTTPException(404, "Restaurant not found")
    return t


@router.post("/tenants/{tid}/approve")
def approve(tid: str, body: ReviewIn, _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    t = get_tenant(db, tid)
    if t.status not in ("pending", "rejected"):
        raise HTTPException(409, f"Can't approve a restaurant that is {t.status}")
    t.status, t.review_note, t.reviewed_at = "trial", body.note, now()
    t.trial_ends_at = now() + timedelta(days=settings.trial_days)
    provision_tenant(db, t)
    db.commit()
    return row(t)


@router.post("/tenants/{tid}/reject")
def reject(tid: str, body: ReviewIn, _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    t = get_tenant(db, tid)
    if t.status != "pending":
        raise HTTPException(409, f"Can't reject a restaurant that is {t.status}")
    t.status, t.review_note, t.reviewed_at = "rejected", body.note, now()
    db.commit()
    return row(t)


class StatusIn(BaseModel):
    status: str = Field(pattern=r"^(trial|active|suspended)$")


@router.post("/tenants/{tid}/status")
def set_status(tid: str, body: StatusIn, _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    t = get_tenant(db, tid)
    if t.status in ("pending", "rejected"):
        raise HTTPException(409, "Approve the restaurant first")
    t.status = body.status
    db.commit()
    return row(t)


@router.get("/modules")
def modules(_: Ctx = Depends(platform_admin)):
    """Optional modules that can be turned on per restaurant (everything else is basic and always on)."""
    return [{"key": k, "label": label, "description": d} for k, (label, d) in MODULES.items()]


class ModulesIn(BaseModel):
    modules: list[str] = Field(default_factory=list, max_length=50)


@router.put("/tenants/{tid}/modules")
def set_modules(tid: str, body: ModulesIn, _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    unknown = sorted(set(body.modules) - set(MODULES))
    if unknown:
        raise HTTPException(422, f"Unknown module: {', '.join(unknown)}")
    t = get_tenant(db, tid)
    t.modules = [k for k in MODULES if k in body.modules]
    db.commit()
    return row(t)
