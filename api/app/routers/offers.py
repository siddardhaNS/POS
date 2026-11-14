"""Offers: set them up (menu editors) and apply or remove them on a check (cashiers)."""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import menurules, promo
from ..db import get_db
from ..deps import Ctx, require
from ..live import audit
from ..models import MenuCategory, MenuItem, Order, Promotion
from .pos import money, open_order, save

router = APIRouter(tags=["offers"])
KINDS = r"^(percent|amount|items_percent|bxgy)$"


def promo_out(p: Promotion, uses: int = 0, tz=None) -> dict:
    return {"id": p.id, "name": p.name, "active": p.active, "kind": p.kind, "value": money(p.value),
            "max_discount": money(p.max_discount), "buy_qty": p.buy_qty, "free_qty": p.free_qty,
            "item_ids": p.item_ids or [], "category_ids": p.category_ids or [], "min_subtotal": money(p.min_subtotal),
            "channels": p.channels or [], "schedule": p.schedule or {}, "schedule_label": menurules.schedule_label(p.schedule),
            "starts_on": p.starts_on.isoformat() if p.starts_on else None, "ends_on": p.ends_on.isoformat() if p.ends_on else None,
            "code": p.code, "auto": p.auto, "customers_only": p.customers_only, "first_visit_only": p.first_visit_only,
            "max_uses": p.max_uses, "uses": uses}


@router.get("/promotions")
def list_promotions(ctx: Ctx = Depends(require("menu")), db: Session = Depends(get_db)):
    rows = db.scalars(select(Promotion).where(Promotion.tenant_id == ctx.tenant_id).order_by(Promotion.created_at.desc())).all()
    uses = dict(db.execute(select(Order.promotion_id, func.count(Order.id)).where(
        Order.tenant_id == ctx.tenant_id, Order.promotion_id.is_not(None), Order.status.in_(("paid", "refunded")))
        .group_by(Order.promotion_id)).all())
    given = dict(db.execute(select(Order.promotion_id, func.coalesce(func.sum(Order.promotion_amount), 0)).where(
        Order.tenant_id == ctx.tenant_id, Order.promotion_id.is_not(None), Order.status.in_(("paid", "refunded")))
        .group_by(Order.promotion_id)).all())
    return [{**promo_out(p, uses.get(p.id, 0)), "given": money(given.get(p.id, 0))} for p in rows]


class PromotionIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    kind: str = Field(pattern=KINDS)
    value: float = Field(default=0, ge=0, le=1_000_000)
    max_discount: float = Field(default=0, ge=0, le=1_000_000)
    buy_qty: int = Field(default=0, ge=0, le=50)
    free_qty: int = Field(default=0, ge=0, le=50)
    item_ids: list[str] = Field(default_factory=list, max_length=500)
    category_ids: list[str] = Field(default_factory=list, max_length=100)
    min_subtotal: float = Field(default=0, ge=0, le=10_000_000)
    channels: list[str] = Field(default_factory=list, max_length=5)
    schedule: dict = Field(default_factory=dict)
    starts_on: date | None = None
    ends_on: date | None = None
    code: str = Field(default="", max_length=30, pattern=r"^[A-Za-z0-9_-]*$")
    auto: bool = False
    customers_only: bool = False
    first_visit_only: bool = False
    max_uses: int = Field(default=0, ge=0, le=1_000_000)


def apply_body(db: Session, ctx: Ctx, p: Promotion, b: PromotionIn) -> None:
    if b.kind in ("percent", "items_percent") and not (0 < b.value <= 100):
        raise HTTPException(422, "A percentage offer needs a value between 1 and 100")
    if b.kind == "amount" and b.value <= 0:
        raise HTTPException(422, "Enter the amount off")
    if b.kind == "bxgy" and (b.buy_qty < 1 or b.free_qty < 1):
        raise HTTPException(422, "Say how many to buy and how many are free")
    if b.kind in ("items_percent", "bxgy") and not (b.item_ids or b.category_ids):
        raise HTTPException(422, "Pick the dishes or categories the offer covers")
    if b.starts_on and b.ends_on and b.ends_on < b.starts_on:
        raise HTTPException(422, "The end date is before the start date")
    if set(b.channels) - set(menurules.CHANNELS):
        raise HTTPException(422, "Unknown channel")
    items = set(db.scalars(select(MenuItem.id).where(MenuItem.tenant_id == ctx.tenant_id, MenuItem.id.in_(b.item_ids or [""]))))
    cats = set(db.scalars(select(MenuCategory.id).where(MenuCategory.tenant_id == ctx.tenant_id, MenuCategory.id.in_(b.category_ids or [""]))))
    code = b.code.strip().upper()
    if code and db.scalar(select(Promotion.id).where(Promotion.tenant_id == ctx.tenant_id, func.upper(Promotion.code) == code,
                                                    Promotion.id != (p.id or ""))):
        raise HTTPException(409, f"Another offer already uses the code {code}")
    p.name, p.active, p.kind = b.name.strip(), b.active, b.kind
    p.value, p.max_discount = Decimal(str(b.value)), Decimal(str(b.max_discount))
    p.buy_qty, p.free_qty = (b.buy_qty, b.free_qty) if b.kind == "bxgy" else (0, 0)
    p.item_ids = [i for i in b.item_ids if i in items] if b.kind in ("items_percent", "bxgy") else []
    p.category_ids = [c for c in b.category_ids if c in cats] if b.kind in ("items_percent", "bxgy") else []
    p.min_subtotal = Decimal(str(b.min_subtotal))
    chans = [c for c in menurules.CHANNELS if c in b.channels]
    p.channels = [] if len(chans) == len(menurules.CHANNELS) else chans
    p.schedule = menurules.clean_schedule(b.schedule)
    p.starts_on, p.ends_on = b.starts_on, b.ends_on
    p.code, p.auto = code, b.auto and not code
    p.customers_only, p.first_visit_only, p.max_uses = b.customers_only, b.first_visit_only, b.max_uses


@router.post("/promotions", status_code=201)
def add_promotion(body: PromotionIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    p = Promotion(tenant_id=ctx.tenant_id, name=body.name)
    apply_body(db, ctx, p, body)
    db.add(p)
    audit(db, ctx, "promotion", detail=f"Added offer {p.name}")
    db.commit()
    return promo_out(p)


def own(db: Session, ctx: Ctx, pid: str) -> Promotion:
    p = db.scalar(select(Promotion).where(Promotion.id == pid, Promotion.tenant_id == ctx.tenant_id))
    if not p:
        raise HTTPException(404, "Offer not found")
    return p


@router.put("/promotions/{pid}")
def edit_promotion(pid: str, body: PromotionIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    p = own(db, ctx, pid)
    apply_body(db, ctx, p, body)
    audit(db, ctx, "promotion", detail=f"Changed offer {p.name}")
    db.commit()
    return promo_out(p)


@router.delete("/promotions/{pid}")
def delete_promotion(pid: str, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    p = own(db, ctx, pid)
    audit(db, ctx, "promotion", detail=f"Deleted offer {p.name}")
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------- On a check ----------

@router.get("/orders/{oid}/offers")
def check_offers(oid: str, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    return [x for x in promo.options(db, ctx.tenant, o) if not x["code"]]


class ApplyIn(BaseModel):
    promotion_id: str | None = Field(default=None, max_length=36)
    code: str | None = Field(default=None, max_length=30)


@router.post("/orders/{oid}/offer")
def apply_offer(oid: str, body: ApplyIn, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    if o.paid:
        raise HTTPException(409, "This check is already partly paid. Offers go on before the first payment.")
    if body.code:
        p = db.scalar(select(Promotion).where(Promotion.tenant_id == ctx.tenant_id,
                                              func.upper(Promotion.code) == body.code.strip().upper()))
        if not p:
            raise HTTPException(404, "No offer with that code")
    elif body.promotion_id:
        p = own(db, ctx, body.promotion_id)
        if p.code:
            raise HTTPException(409, "This offer needs its code")
    else:
        raise HTTPException(422, "Pick an offer or enter a code")
    sub = sum((i.unit_price * i.qty for i in o.items if not i.comp_reason), Decimal(0))
    reason = promo.why_not(db, ctx.tenant, p, o, sub)
    if reason:
        raise HTTPException(409, f"{p.name} can't be used: {reason.lower()}")
    amt = promo.amount_for(p, o, sub, promo.category_map(db, ctx.tenant_id))
    if amt <= 0:
        raise HTTPException(409, f"Nothing on this check qualifies for {p.name} yet")
    o.promotion_id, o.promotion_name, o.promotion_amount, o.promotion_auto_off = p.id, p.name, amt, False
    audit(db, ctx, "discount", order=o, amount=amt, detail=f"Offer · {p.name}")
    return save(db, ctx, o)


@router.delete("/orders/{oid}/offer")
def remove_offer(oid: str, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    o = open_order(db, ctx, oid)
    if o.paid:
        raise HTTPException(409, "This check is already partly paid. Refund first.")
    if o.promotion_id:
        audit(db, ctx, "discount_removed", order=o, detail=f"Offer · {o.promotion_name}")
    o.promotion_id, o.promotion_name, o.promotion_amount, o.promotion_auto_off = None, "", Decimal(0), True
    return save(db, ctx, o)
