"""Price lists: different prices by channel, time of day, or date range (delivery prices, happy hour, festival
markdowns). Resolution lives in menurules.Pricing."""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import menurules
from ..db import get_db
from ..deps import Ctx, require
from ..live import audit
from ..models import MenuItem, PriceList, PriceListItem
from .pos import money, tenant_tz

router = APIRouter(tags=["price-lists"])


def pl_out(pl: PriceList, tz) -> dict:
    return {"id": pl.id, "name": pl.name, "active": pl.active, "channels": pl.channels or [], "schedule": pl.schedule or {},
            "schedule_label": menurules.schedule_label(pl.schedule),
            "starts_on": pl.starts_on.isoformat() if pl.starts_on else None,
            "ends_on": pl.ends_on.isoformat() if pl.ends_on else None,
            "adjust_pct": float(pl.adjust_pct or 0), "sort": pl.sort,
            "in_force": any(menurules.list_applies(pl, c, tz) for c in menurules.CHANNELS),
            "prices": {p.menu_item_id: money(p.price) for p in pl.prices}}


@router.get("/price-lists")
def list_price_lists(ctx: Ctx = Depends(require("menu")), db: Session = Depends(get_db)):
    rows = db.scalars(select(PriceList).where(PriceList.tenant_id == ctx.tenant_id).options(selectinload(PriceList.prices))
                      .order_by(PriceList.sort, PriceList.created_at)).all()
    tz = tenant_tz(ctx.tenant)
    return [pl_out(p, tz) for p in rows]


class PriceListIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    channels: list[str] = Field(default_factory=list, max_length=5)
    schedule: dict = Field(default_factory=dict)
    starts_on: date | None = None
    ends_on: date | None = None
    adjust_pct: float = Field(default=0, ge=-100, le=500)
    prices: dict[str, float] = Field(default_factory=dict)  # menu_item_id -> price


def apply_body(db: Session, ctx: Ctx, pl: PriceList, body: PriceListIn) -> None:
    bad = set(body.channels) - set(menurules.CHANNELS)
    if bad:
        raise HTTPException(422, "Unknown channel: " + ", ".join(sorted(bad)))
    if body.starts_on and body.ends_on and body.ends_on < body.starts_on:
        raise HTTPException(422, "The end date is before the start date")
    if len(body.prices) > 2000:
        raise HTTPException(422, "Too many prices")
    if any(not (0 <= v <= 1_000_000) for v in body.prices.values()):
        raise HTTPException(422, "Prices can't be negative")
    known = set(db.scalars(select(MenuItem.id).where(MenuItem.tenant_id == ctx.tenant_id, MenuItem.id.in_(list(body.prices) or [""]))))
    if set(body.prices) - known:
        raise HTTPException(404, "Some items aren't on this menu any more. Refresh and try again.")
    chans = [c for c in menurules.CHANNELS if c in body.channels]
    pl.name, pl.active = body.name.strip(), body.active
    pl.channels = [] if len(chans) == len(menurules.CHANNELS) else chans
    pl.schedule = menurules.clean_schedule(body.schedule)
    pl.starts_on, pl.ends_on = body.starts_on, body.ends_on
    pl.adjust_pct = Decimal(str(body.adjust_pct)).quantize(Decimal("0.01"))
    pl.prices = [PriceListItem(tenant_id=ctx.tenant_id, menu_item_id=mid, price=Decimal(str(v)).quantize(Decimal("0.01")))
                 for mid, v in body.prices.items()]


@router.post("/price-lists", status_code=201)
def add_price_list(body: PriceListIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    n = db.scalar(select(func.max(PriceList.sort)).where(PriceList.tenant_id == ctx.tenant_id))
    pl = PriceList(tenant_id=ctx.tenant_id, name=body.name, sort=(n if n is not None else -1) + 1)
    apply_body(db, ctx, pl, body)
    db.add(pl)
    audit(db, ctx, "price_list", detail=f"Added price list {pl.name}")
    db.commit()
    return pl_out(pl, tenant_tz(ctx.tenant))


def own(db: Session, ctx: Ctx, pid: str) -> PriceList:
    pl = db.scalar(select(PriceList).where(PriceList.id == pid, PriceList.tenant_id == ctx.tenant_id)
                   .options(selectinload(PriceList.prices)))
    if not pl:
        raise HTTPException(404, "Price list not found")
    return pl


@router.put("/price-lists/{pid}")
def edit_price_list(pid: str, body: PriceListIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    pl = own(db, ctx, pid)
    pl.prices.clear()
    db.flush()
    apply_body(db, ctx, pl, body)
    audit(db, ctx, "price_list", detail=f"Changed price list {pl.name}")
    db.commit()
    return pl_out(pl, tenant_tz(ctx.tenant))


class OrderIn(BaseModel):
    ids: list[str] = Field(max_length=200)


@router.post("/price-lists/reorder")
def reorder(body: OrderIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    """Set priority: when several lists apply at once, the first one wins."""
    rows = {p.id: p for p in db.scalars(select(PriceList).where(PriceList.tenant_id == ctx.tenant_id))}
    for i, pid in enumerate(body.ids):
        if pid in rows:
            rows[pid].sort = i
    db.commit()
    return list_price_lists(ctx, db)


@router.delete("/price-lists/{pid}")
def delete_price_list(pid: str, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    pl = own(db, ctx, pid)
    audit(db, ctx, "price_list", detail=f"Deleted price list {pl.name}")
    db.delete(pl)
    db.commit()
    return {"ok": True}
