"""Platform admin console: review free-trial applications and manage tenants."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import Ctx, platform_admin
from ..models import Order, Tenant, User, now
from ..seed import provision_tenant

router = APIRouter(prefix="/admin", tags=["admin"])

STATUSES = ("pending", "trial", "active", "rejected", "suspended")


def row(t: Tenant, users: int = 0) -> dict:
    return {
        "id": t.id, "name": t.name, "slug": t.slug, "market": t.market, "status": t.status,
        "contact_name": t.contact_name, "email": t.email, "phone": t.phone, "city": t.city,
        "cuisine": t.cuisine, "outlets": t.outlets, "service_style": t.service_style, "message": t.message,
        "review_note": t.review_note, "users": users,
        "created_at": t.created_at.isoformat(),
        "reviewed_at": t.reviewed_at.isoformat() if t.reviewed_at else None,
        "trial_ends_at": t.trial_ends_at.isoformat() if t.trial_ends_at else None,
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
    return [row(t, n) for t, n in db.execute(stmt.order_by(Tenant.created_at.desc())).all()]


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
