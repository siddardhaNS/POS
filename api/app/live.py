"""Live updates and audit trail.

Every flush that touches service data bumps a per-restaurant revision for the affected topics, in the same
transaction. Devices poll GET /live (one tiny query) and refetch a screen only when its topic moved. This works
on serverless hosts where long-lived WebSocket connections aren't available.
"""
from decimal import Decimal
from itertools import chain

from sqlalchemy import event, text

from .db import SessionLocal
from .models import (AuditLog, CashMovement, CashSession, DiningTable, FloorSection, Kot, MenuCategory, MenuItem, ModifierGroup,
                     ModifierOption, Order, OrderItem, Payment, PriceList, PriceListItem, Printer, PrintJob, PurchaseOrder, RecipeLine, StockCount,
                     Reservation, ServiceRequest, StockItem, StockMovement, Supplier, TimeBreak, TimeEntry)

TOPICS: dict[type, tuple[str, ...]] = {
    Order: ("floor", "orders", "online", "kds"),
    OrderItem: ("floor", "orders", "kds"),
    Payment: ("floor", "orders", "cash"),
    Kot: ("kds", "floor"),
    DiningTable: ("floor",),
    ServiceRequest: ("floor", "requests"),
    Reservation: ("reservations",),
    FloorSection: ("floor",),
    CashSession: ("cash",),
    CashMovement: ("cash",),
    MenuItem: ("menu",),
    MenuCategory: ("menu",),
    ModifierGroup: ("menu",),
    ModifierOption: ("menu",),
    PriceList: ("menu",),
    PriceListItem: ("menu",),
    AuditLog: ("audit",),
    Printer: ("print",),
    PrintJob: ("print",),
    StockItem: ("inventory",),
    StockMovement: ("inventory",),
    RecipeLine: ("inventory",),
    PurchaseOrder: ("inventory",),
    Supplier: ("inventory",),
    StockCount: ("inventory",),
    TimeEntry: ("timeclock",),
    TimeBreak: ("timeclock",),
}
ALL_TOPICS = ("floor", "orders", "online", "kds", "cash", "menu", "audit", "print", "inventory", "timeclock", "requests", "reservations")

BUMP = text("""
INSERT INTO live_revs (tenant_id, topic, rev) VALUES (:t, :p, 1)
ON CONFLICT (tenant_id, topic) DO UPDATE SET rev = live_revs.rev + 1
""")


@event.listens_for(SessionLocal, "after_flush")
def _bump_revs(session, _ctx) -> None:
    hits: set[tuple[str, str]] = set()
    for obj in chain(session.new, session.dirty, session.deleted):
        topics = TOPICS.get(type(obj))
        tid = getattr(obj, "tenant_id", None)
        if topics and tid:
            hits.update((tid, t) for t in topics)
    if hits:
        conn = session.connection()
        for tid, topic in sorted(hits):
            conn.execute(BUMP, {"t": tid, "p": topic})


def audit(db, ctx, action: str, *, order: Order | None = None, detail: str = "", amount: Decimal | float | None = None) -> None:
    """Record a sensitive action. Call before db.commit() so it lands in the same transaction."""
    db.add(AuditLog(
        tenant_id=ctx.tenant_id, user_id=ctx.user.id, user_name=ctx.user.name, action=action,
        order_id=order.id if order else None, order_number=order.number if order else None, detail=detail,
        amount=Decimal(str(amount)).quantize(Decimal("0.01")) if amount is not None else None,
    ))
