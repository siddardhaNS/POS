"""Inventory core: units, the stock ledger, moving-average cost, sale deduction and auto-86.

Kept free of router imports so the payment flow in pos.py can call deduct_for_order() without a cycle.
"""
from collections import defaultdict
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import InventoryAuto86, MenuItem, Order, RecipeLine, StockItem, StockMovement, Tenant

# display unit -> (base unit, base units per display unit)
UNITS: dict[str, tuple[str, Decimal]] = {
    "g": ("g", Decimal("1")),
    "kg": ("g", Decimal("1000")),
    "oz": ("g", Decimal("28.3495")),
    "lb": ("g", Decimal("453.592")),
    "ml": ("ml", Decimal("1")),
    "l": ("ml", Decimal("1000")),
    "fl oz": ("ml", Decimal("29.5735")),
    "pc": ("pc", Decimal("1")),
    "dozen": ("pc", Decimal("12")),
}
UNIT_PATTERN = r"^(g|kg|oz|lb|ml|l|fl oz|pc|dozen)$"
KINDS = ("received", "sale", "waste", "adjust", "count", "transfer_in", "transfer_out")
Q4 = Decimal("0.0001")
Q6 = Decimal("0.000001")


def D(v) -> Decimal:
    return v if isinstance(v, Decimal) else Decimal(str(v or 0))


def base_of(unit: str) -> str:
    return UNITS[unit][0]


def factor(unit: str) -> Decimal:
    return UNITS[unit][1]


def compatible(a: str, b: str) -> bool:
    return a in UNITS and b in UNITS and base_of(a) == base_of(b)


def to_base(qty, unit: str) -> Decimal:
    return (D(qty) * factor(unit)).quantize(Q4)


def from_base(qty, unit: str) -> Decimal:
    return D(qty) / factor(unit)


def apply_movement(db: Session, item: StockItem, kind: str, qty: Decimal, *, unit_cost: Decimal | None = None,
                   reason: str = "", user_id: str | None = None, order_id: str | None = None,
                   ref_id: str | None = None) -> StockMovement:
    """The only way on_hand changes. qty is signed, in base units; unit_cost is per base unit."""
    assert kind in KINDS
    qty = D(qty).quantize(Q4)
    cost = D(item.avg_cost) if unit_cost is None else D(unit_cost)
    if kind in ("received", "transfer_in") and qty > 0 and unit_cost is not None:
        held = max(D(item.on_hand), Decimal(0))
        item.avg_cost = ((held * D(item.avg_cost) + qty * cost) / (held + qty)).quantize(Q6)
    item.on_hand = D(item.on_hand) + qty
    m = StockMovement(tenant_id=item.tenant_id, stock_item_id=item.id, kind=kind, qty=qty, unit_cost=cost.quantize(Q6),
                      reason=reason[:200], user_id=user_id, order_id=order_id, ref_id=ref_id)
    db.add(m)
    return m


def auto86_enabled(db: Session, tenant_id: str) -> bool:
    return bool(db.scalar(select(Tenant.inventory_auto_86).where(Tenant.id == tenant_id)))


def sync_auto86(db: Session, tenant_id: str, stock_ids: set[str] | None = None, *, force: bool = False) -> None:
    """When the restaurant opted in: take menu items off when a base-recipe ingredient runs out, and bring
    back the ones inventory took off once every ingredient is above zero again. stock_ids=None checks all."""
    if not force and not auto86_enabled(db, tenant_id):
        return
    db.flush()
    q = select(RecipeLine.menu_item_id).where(RecipeLine.tenant_id == tenant_id, RecipeLine.modifier_option == "")
    if stock_ids is not None:
        if not stock_ids:
            return
        q = q.where(RecipeLine.stock_item_id.in_(stock_ids))
    menu_ids = set(db.scalars(q.distinct()))
    if not menu_ids:
        return
    rows = db.execute(select(RecipeLine.menu_item_id, StockItem.on_hand)
                      .join(StockItem, StockItem.id == RecipeLine.stock_item_id)
                      .where(RecipeLine.tenant_id == tenant_id, RecipeLine.modifier_option == "",
                             RecipeLine.menu_item_id.in_(menu_ids), StockItem.active.is_(True))).all()
    out: dict[str, bool] = defaultdict(bool)
    for mid, on_hand in rows:
        out[mid] = out[mid] or D(on_hand) <= 0
    flagged = set(db.scalars(select(InventoryAuto86.menu_item_id).where(InventoryAuto86.tenant_id == tenant_id,
                                                                         InventoryAuto86.menu_item_id.in_(menu_ids))))
    for m in db.scalars(select(MenuItem).where(MenuItem.tenant_id == tenant_id, MenuItem.id.in_(menu_ids))):
        if out[m.id] and m.available:
            m.available = False
            db.add(InventoryAuto86(tenant_id=tenant_id, menu_item_id=m.id))
        elif not out[m.id] and m.id in flagged:
            m.available = True
            db.execute(delete(InventoryAuto86).where(InventoryAuto86.tenant_id == tenant_id, InventoryAuto86.menu_item_id == m.id))


def recipe_lines_for(db: Session, tenant_id: str, menu_ids: set[str]) -> dict[str, list[RecipeLine]]:
    out: dict[str, list[RecipeLine]] = defaultdict(list)
    if menu_ids:
        for r in db.scalars(select(RecipeLine).where(RecipeLine.tenant_id == tenant_id, RecipeLine.menu_item_id.in_(menu_ids))):
            out[r.menu_item_id].append(r)
    return out


def order_usage(db: Session, o: Order) -> dict[str, Decimal]:
    """Base-unit quantity of each stock item a check consumed: every line (comped food is still eaten) times
    qty, plus the recipes of the modifiers picked on it."""
    lines = recipe_lines_for(db, o.tenant_id, {i.menu_item_id for i in o.items if i.menu_item_id})
    need: dict[str, Decimal] = defaultdict(Decimal)
    for i in o.items:
        if not i.menu_item_id or i.qty <= 0:
            continue
        picked = {(str(m.get("group", "")), str(m.get("name", ""))) for m in (i.modifiers or [])}
        for r in lines.get(i.menu_item_id, []):
            if not r.modifier_option or (r.modifier_group, r.modifier_option) in picked:
                need[r.stock_item_id] += D(r.qty) * i.qty
    return need


def deduct_for_order(db: Session, o: Order, user_id: str | None = None) -> None:
    """Record the sale movements for a check that just became paid. Idempotent per order: a check that was
    reopened and paid again has its earlier sale movements replaced, never doubled."""
    touched: set[str] = set()
    items: dict[str, StockItem] = {}

    def get(sid: str) -> StockItem | None:
        if sid not in items:
            items[sid] = db.scalar(select(StockItem).where(StockItem.id == sid, StockItem.tenant_id == o.tenant_id))
        return items[sid]

    for old in db.scalars(select(StockMovement).where(StockMovement.tenant_id == o.tenant_id, StockMovement.order_id == o.id,
                                                       StockMovement.kind == "sale")).all():
        it = get(old.stock_item_id)
        if it:
            it.on_hand = D(it.on_hand) - D(old.qty)
            touched.add(it.id)
        db.delete(old)
    for sid, qty in order_usage(db, o).items():
        it = get(sid)
        if it is None or qty <= 0:
            continue
        apply_movement(db, it, "sale", -qty, user_id=user_id, order_id=o.id, reason=f"Order #{o.number}")
        touched.add(sid)
    sync_auto86(db, o.tenant_id, touched)
