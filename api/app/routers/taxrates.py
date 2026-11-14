"""Tax classes (GST 5%, GST 18%, Exempt...) and which one is the restaurant's default."""
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Ctx, require
from ..live import audit
from ..models import MenuCategory, MenuItem, TaxRate, Tenant
from ..taxes import rate_out

router = APIRouter(tags=["tax-rates"])


def listing(db: Session, t: Tenant) -> dict:
    rows = db.scalars(select(TaxRate).where(TaxRate.tenant_id == t.id).order_by(TaxRate.sort, TaxRate.created_at)).all()
    used = dict(db.execute(select(MenuItem.tax_rate_id, func.count()).where(MenuItem.tenant_id == t.id, MenuItem.tax_rate_id.is_not(None))
                           .group_by(MenuItem.tax_rate_id)).all())
    return {"default_id": t.default_tax_id, "fallback": {"name": t.tax_label, "rate": float(t.tax_rate)},
            "rates": [{**rate_out(r), "items": used.get(r.id, 0)} for r in rows]}


@router.get("/tax-rates")
def get_rates(ctx: Ctx = Depends(require("menu")), db: Session = Depends(get_db)):
    return listing(db, ctx.tenant)


class Part(BaseModel):
    name: str = Field(min_length=1, max_length=30)
    rate: float = Field(ge=0, le=0.5)  # fraction: 0.025 = 2.5%


class RateIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    rate: float = Field(ge=0, le=0.5)
    components: list[Part] = Field(default_factory=list, max_length=4)


def check(body: RateIn) -> None:
    if body.components and abs(sum(p.rate for p in body.components) - body.rate) > 0.00001:
        raise HTTPException(422, "The parts must add up to the rate (e.g. CGST 2.5% + SGST 2.5% = 5%)")


def sync_default(t: Tenant, r: TaxRate | None) -> None:
    """Keep the restaurant's single rate in step with its default class (older screens and lines use it)."""
    if r is not None:
        t.tax_rate, t.tax_label = r.rate, r.name


@router.post("/tax-rates", status_code=201)
def add_rate(body: RateIn, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    check(body)
    t = db.merge(ctx.tenant)
    n = db.scalar(select(func.max(TaxRate.sort)).where(TaxRate.tenant_id == t.id))
    r = TaxRate(tenant_id=t.id, name=body.name.strip(), rate=Decimal(str(body.rate)), sort=(n if n is not None else -1) + 1,
                components=[{"name": p.name.strip(), "rate": p.rate} for p in body.components])
    db.add(r)
    db.flush()
    if not t.default_tax_id:
        t.default_tax_id = r.id
        sync_default(t, r)
    audit(db, ctx, "tax_change", detail=f"Added tax class {r.name} ({body.rate * 100:g}%)")
    db.commit()
    return listing(db, t)


def own(db: Session, ctx: Ctx, rid: str) -> TaxRate:
    r = db.scalar(select(TaxRate).where(TaxRate.id == rid, TaxRate.tenant_id == ctx.tenant_id))
    if not r:
        raise HTTPException(404, "Tax class not found")
    return r


@router.put("/tax-rates/{rid}")
def edit_rate(rid: str, body: RateIn, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    check(body)
    t = db.merge(ctx.tenant)
    r = own(db, ctx, rid)
    if Decimal(str(body.rate)) != r.rate:
        audit(db, ctx, "tax_change", detail=f"{r.name}: {float(r.rate) * 100:g}% → {body.rate * 100:g}%")
    r.name, r.rate = body.name.strip(), Decimal(str(body.rate))
    r.components = [{"name": p.name.strip(), "rate": p.rate} for p in body.components]
    if t.default_tax_id == r.id:
        sync_default(t, r)
    db.commit()
    return listing(db, t)


@router.delete("/tax-rates/{rid}")
def delete_rate(rid: str, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    t = db.merge(ctx.tenant)
    r = own(db, ctx, rid)
    if t.default_tax_id == r.id:
        raise HTTPException(409, "This is the default tax class. Make another one the default first.")
    for model in (MenuItem, MenuCategory):  # dishes in this class fall back to their category / the default
        for row in db.scalars(select(model).where(model.tenant_id == t.id, model.tax_rate_id == r.id)):
            row.tax_rate_id = None
    audit(db, ctx, "tax_change", detail=f"Deleted tax class {r.name}")
    db.delete(r)
    db.commit()
    return listing(db, t)


class DefaultIn(BaseModel):
    id: str = Field(max_length=36)


@router.put("/tax-rates-default")
def set_default(body: DefaultIn, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    t = db.merge(ctx.tenant)
    r = own(db, ctx, body.id)
    t.default_tax_id = r.id
    sync_default(t, r)
    audit(db, ctx, "tax_change", detail=f"Default tax class → {r.name}")
    db.commit()
    return listing(db, t)
