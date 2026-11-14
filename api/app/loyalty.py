"""Loyalty points: earn on paid checks, pay with points, reverse on refunds. Kept free of router imports."""
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Customer, LoyaltyEntry, Order


def value_of(t, points: int) -> Decimal:
    return (Decimal(points) * Decimal(t.loyalty_point_value or 0)).quantize(Decimal("0.01"))


def points_for(t, amount: Decimal) -> int:
    """Points a points payment of `amount` costs (rounded up, so points never buy more than they are worth)."""
    v = Decimal(t.loyalty_point_value or 0)
    return int((Decimal(amount) / v).to_integral_value(ROUND_CEILING)) if v > 0 else 0


def _entry(db: Session, t, c: Customer, o: Order | None, kind: str, pts: int, note: str = "", user: str = "") -> None:
    if not pts:
        return
    c.points = (c.points or 0) + pts
    db.add(LoyaltyEntry(tenant_id=t.id, customer_id=c.id, order_id=o.id if o else None, kind=kind, points=pts,
                        note=note[:200], user_name=user))


def _booked(db: Session, o: Order, kinds: tuple[str, ...]) -> int:
    return int(db.scalar(select(func.coalesce(func.sum(LoyaltyEntry.points), 0)).where(
        LoyaltyEntry.order_id == o.id, LoyaltyEntry.kind.in_(kinds))) or 0)


def redeem(db: Session, t, o: Order, amount: Decimal, user: str) -> None:
    """Take the points for a points payment off the customer's balance (validated by the caller)."""
    c = db.get(Customer, o.customer_id)
    _entry(db, t, c, o, "redeem", -points_for(t, amount), f"Paid check #{o.number}", user)


def earn(db: Session, t, o: Order) -> None:
    """When a check is paid: points on what was paid other than with points. Idempotent per check (a reopened
    and repaid check only tops up the difference)."""
    if not t.loyalty_enabled or not o.customer_id or not t.loyalty_earn_per or Decimal(t.loyalty_earn_per) <= 0:
        return
    c = db.get(Customer, o.customer_id)
    if c is None:
        return
    spent = sum((Decimal(p.amount) for p in o.payments if p.kind == "payment" and p.method != "points"), Decimal(0))
    due = int((spent / Decimal(t.loyalty_earn_per)).to_integral_value(ROUND_FLOOR))
    have = _booked(db, o, ("earn", "reverse"))
    _entry(db, t, c, o, "earn", due - have, f"Check #{o.number}")


def reverse_for_refund(db: Session, t, o: Order, refund_amount: Decimal, collected: Decimal) -> None:
    """Refunds take back a matching share of the points the check earned."""
    if not o.customer_id or collected <= 0:
        return
    c = db.get(Customer, o.customer_id)
    earned = _booked(db, o, ("earn",))
    if c is None or earned <= 0:
        return
    left = earned + _booked(db, o, ("reverse",))
    take = min(left, int((Decimal(earned) * refund_amount / collected).to_integral_value()))
    _entry(db, t, c, o, "reverse", -take, f"Refund on check #{o.number}")


def adjust(db: Session, t, c: Customer, pts: int, note: str, user: str) -> None:
    _entry(db, t, c, None, "adjust", pts, note, user)
