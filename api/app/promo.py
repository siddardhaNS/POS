"""Offers: whether one applies to a check and how much it takes off. Kept free of router imports (pos.py uses it).

The offer's amount is added to the check discount, so tax and reports treat it like any other discount."""
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import menurules
from .models import MenuItem, Order, Promotion

CENT = Decimal("0.01")


def tz_of(tenant) -> ZoneInfo:
    try:
        return ZoneInfo(tenant.timezone or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _lines(o: Order):
    return [i for i in o.items if not i.comp_reason and i.qty > 0]


def covered(p: Promotion, cat_of: dict[str, str]):
    items, cats = set(p.item_ids or []), set(p.category_ids or [])
    return lambda i: bool(i.menu_item_id) and (i.menu_item_id in items or cat_of.get(i.menu_item_id) in cats)


def amount_for(p: Promotion, o: Order, subtotal: Decimal, cat_of: dict[str, str]) -> Decimal:
    """What the offer takes off this check, ignoring eligibility rules (those are in why_not)."""
    v = Decimal(p.value or 0)
    if p.kind == "percent":
        amt = subtotal * v / 100
    elif p.kind == "amount":
        amt = v
    elif p.kind == "items_percent":
        hit = covered(p, cat_of)
        amt = sum((i.unit_price * i.qty for i in _lines(o) if hit(i)), Decimal(0)) * v / 100
    elif p.kind == "bxgy":
        hit = covered(p, cat_of)
        units = sorted(Decimal(i.unit_price) for i in _lines(o) if hit(i) for _ in range(i.qty))
        group = (p.buy_qty or 0) + (p.free_qty or 0)
        free = (len(units) // group) * (p.free_qty or 0) if group and p.free_qty else 0
        amt = sum(units[:free], Decimal(0))
    else:
        amt = Decimal(0)
    if p.max_discount and p.kind in ("percent", "items_percent"):
        amt = min(amt, Decimal(p.max_discount))
    return max(Decimal(0), min(amt, subtotal)).quantize(CENT, ROUND_HALF_UP)


def why_not(db: Session, tenant, p: Promotion, o: Order, subtotal: Decimal) -> str:
    """'' when the offer can apply to this check, else the reason it can't (shown to staff)."""
    tz = tz_of(tenant)
    today = datetime.now(tz).date()
    if not p.active:
        return "Paused"
    if p.starts_on and today < p.starts_on:
        return f"Starts {p.starts_on:%d %b}"
    if p.ends_on and today > p.ends_on:
        return "Ended"
    channel = menurules.channel_of(o.channel)
    if p.channels and channel not in p.channels:
        return f"Not on {menurules.CHANNEL_LABEL.get(channel, channel)}"
    if not menurules.open_now(p.schedule, tz):
        return f"Only {menurules.schedule_label(p.schedule)}"
    if p.min_subtotal and subtotal < Decimal(p.min_subtotal):
        return f"Needs a subtotal of {Decimal(p.min_subtotal):.0f}"
    if (p.customers_only or p.first_visit_only) and not o.customer_id:
        return "Add the customer's phone first"
    if p.first_visit_only and db.scalar(select(func.count(Order.id)).where(
            Order.tenant_id == o.tenant_id, Order.customer_id == o.customer_id, Order.id != o.id,
            Order.status.in_(("paid", "refunded")))):
        return "First visit only"
    if p.max_uses and (db.scalar(select(func.count(Order.id)).where(
            Order.tenant_id == o.tenant_id, Order.promotion_id == p.id, Order.id != o.id,
            Order.status.in_(("paid", "refunded", "open")))) or 0) >= p.max_uses:
        return "Used up"
    return ""


def category_map(db: Session, tenant_id: str) -> dict[str, str]:
    return dict(db.execute(select(MenuItem.id, MenuItem.category_id).where(MenuItem.tenant_id == tenant_id)).all())


def options(db: Session, tenant, o: Order) -> list[dict]:
    """Every offer with what it would take off this check now and why not, for the staff picker."""
    sub = sum((i.unit_price * i.qty for i in _lines(o)), Decimal(0))
    cats = category_map(db, tenant.id)
    out = []
    for p in db.scalars(select(Promotion).where(Promotion.tenant_id == tenant.id, Promotion.active.is_(True))
                        .order_by(Promotion.created_at)):
        reason = why_not(db, tenant, p, o, sub)
        amt = amount_for(p, o, sub, cats)
        if not reason and amt <= 0:
            reason = "Nothing on the check qualifies yet"
        out.append({"id": p.id, "name": p.name, "code": bool(p.code), "auto": p.auto, "amount": float(amt), "why_not": reason})
    return out


def refresh(db: Session, tenant, o: Order, subtotal: Decimal) -> None:
    """Keep the check's offer amount current as items change, drop one that no longer applies, and put the best
    automatic offer on when there's none (unless staff took the automatic one off)."""
    if o.status not in ("open", "new"):
        return
    cats = None
    if o.promotion_id:
        p = db.get(Promotion, o.promotion_id)
        if p is None or why_not(db, tenant, p, o, subtotal):
            o.promotion_id, o.promotion_name, o.promotion_amount = None, "", Decimal(0)
        else:
            cats = category_map(db, tenant.id)
            o.promotion_amount = amount_for(p, o, subtotal, cats)
            return
    if o.promotion_auto_off or not o.items:
        return
    best, best_amt = None, Decimal(0)
    for p in db.scalars(select(Promotion).where(Promotion.tenant_id == tenant.id, Promotion.active.is_(True),
                                                Promotion.auto.is_(True), Promotion.code == "")):
        if why_not(db, tenant, p, o, subtotal):
            continue
        cats = cats or category_map(db, tenant.id)
        amt = amount_for(p, o, subtotal, cats)
        if amt > best_amt:
            best, best_amt = p, amt
    if best:
        o.promotion_id, o.promotion_name, o.promotion_amount = best.id, best.name, best_amt
