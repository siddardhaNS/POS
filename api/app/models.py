"""Multi-tenant data model: every business row carries tenant_id (shared schema, row-level scoping)."""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.now(timezone.utc)


def uid() -> str:
    return str(uuid.uuid4())


class Tenant(Base):
    __tablename__ = "tenants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160))
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    market: Mapped[str] = mapped_column(String(2))  # "IN" | "US"
    currency: Mapped[str] = mapped_column(String(3))  # INR | USD
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(6, 5))
    tax_label: Mapped[str] = mapped_column(String(80))
    # pending -> trial | rejected ; trial -> active | suspended
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    contact_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(40), default="")
    city: Mapped[str] = mapped_column(String(120), default="")
    cuisine: Mapped[str] = mapped_column(String(120), default="")
    outlets: Mapped[int] = mapped_column(Integer, default=1)
    service_style: Mapped[str] = mapped_column(String(40), default="Full service")
    message: Mapped[str] = mapped_column(Text, default="")
    review_note: Mapped[str] = mapped_column(Text, default="")
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    # Restaurant settings (owner-editable)
    address: Mapped[str] = mapped_column(Text, default="")
    tax_id: Mapped[str] = mapped_column(String(60), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    tips_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    receipt_footer: Mapped[str] = mapped_column(Text, default="Thank you! See you again soon.")
    modules: Mapped[list] = mapped_column(JSON, default=list)  # optional modules turned on (see deps.MODULES)
    inventory_auto_86: Mapped[bool] = mapped_column(Boolean, default=False)  # sold out when an ingredient runs out
    auto_print_kot: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_print_receipt: Mapped[bool] = mapped_column(Boolean, default=False)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str | None] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    pin_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # platform_admin | owner | manager | cashier | captain | chef
    role: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class MenuCategory(Base):
    __tablename__ = "menu_categories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class MenuItem(Base):
    __tablename__ = "menu_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[str] = mapped_column(ForeignKey("menu_categories.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(160))
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    is_veg: Mapped[bool] = mapped_column(Boolean, default=True)
    station: Mapped[str] = mapped_column(String(40), default="Kitchen")
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class DiningTable(Base):
    __tablename__ = "dining_tables"
    __table_args__ = (UniqueConstraint("tenant_id", "name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(20))
    seats: Mapped[int] = mapped_column(Integer, default=4)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    section: Mapped[str] = mapped_column(String(40), default="Main")
    shape: Mapped[str] = mapped_column(String(12), default="square")  # round | square | rect | booth | bar
    x: Mapped[int] = mapped_column(Integer, default=0)  # grid cell, top-left
    y: Mapped[int] = mapped_column(Integer, default=0)
    rotation: Mapped[int] = mapped_column(Integer, default=0)  # 0 | 90


class FloorSection(Base):
    """A room or area of the floor plan (Main, Patio, Bar...). Tables reference it by name."""
    __tablename__ = "floor_sections"
    __table_args__ = (UniqueConstraint("tenant_id", "name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    table_id: Mapped[str | None] = mapped_column(ForeignKey("dining_tables.id", ondelete="SET NULL"), nullable=True)
    # dine_in | takeaway | swiggy | zomato | doordash | ubereats | website
    channel: Mapped[str] = mapped_column(String(20), default="dine_in")
    # new (online, awaiting accept) | open | paid | refunded | void | rejected | merged
    status: Mapped[str] = mapped_column(String(12), default="open", index=True)
    customer_name: Mapped[str] = mapped_column(String(120), default="")
    customer_phone: Mapped[str] = mapped_column(String(40), default="")
    guests: Mapped[int] = mapped_column(Integer, default=0)
    # Check-level discount: kind "" | "percent" | "amount"
    discount_kind: Mapped[str] = mapped_column(String(10), default="")
    discount_value: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    discount_reason: Mapped[str] = mapped_column(String(120), default="")
    # Sum of payments applied to the check (excluding tips), and of refunds given back
    paid: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    refunded: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    void_reason: Mapped[str] = mapped_column(String(200), default="")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    tip: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    payment_method: Mapped[str] = mapped_column(String(20), default="")
    opened_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan", order_by="OrderItem.created_at")
    payments: Mapped[list["Payment"]] = relationship(cascade="all, delete-orphan", order_by="Payment.created_at")
    table: Mapped[DiningTable | None] = relationship()


class Kot(Base):
    """Kitchen order ticket: a batch of items fired to the kitchen together."""

    __tablename__ = "kots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(Integer)
    bumped: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    bumped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    course: Mapped[int] = mapped_column(Integer, default=0)  # 0 = everything that was pending
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    order: Mapped[Order] = relationship()
    items: Mapped[list["OrderItem"]] = relationship(back_populates="kot")


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[str | None] = mapped_column(ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(160))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    qty: Mapped[int] = mapped_column(Integer, default=1)
    note: Mapped[str] = mapped_column(String(200), default="")
    # [{"group": str, "name": str, "price": float}]; unit_price already includes these
    modifiers: Mapped[list] = mapped_column(JSON, default=list)
    comp_reason: Mapped[str] = mapped_column(String(120), default="")
    course: Mapped[int] = mapped_column(Integer, default=1)
    seat: Mapped[int] = mapped_column(Integer, default=0)  # 0 = shared / table
    station: Mapped[str] = mapped_column(String(40), default="")  # copied from the menu item when ordered
    kot_id: Mapped[str | None] = mapped_column(ForeignKey("kots.id", ondelete="SET NULL"), nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    kot: Mapped[Kot | None] = relationship(back_populates="items")


class ModifierGroup(Base):
    """A set of choices on a menu item, e.g. Size (pick exactly 1) or Add-ons (pick up to 3)."""
    __tablename__ = "modifier_groups"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[str] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    min_select: Mapped[int] = mapped_column(Integer, default=0)
    max_select: Mapped[int] = mapped_column(Integer, default=1)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    options: Mapped[list["ModifierOption"]] = relationship(cascade="all, delete-orphan", order_by="ModifierOption.sort")


class ModifierOption(Base):
    __tablename__ = "modifier_options"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[str] = mapped_column(ForeignKey("modifier_groups.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Payment(Base):
    """One tender against a check. Refunds are rows with kind=refund (amount stays positive)."""
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="payment")  # payment | refund
    method: Mapped[str] = mapped_column(String(20))  # cash | card | upi | tap | online | other
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    tip: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    tendered: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    change: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    line_ids: Mapped[list] = mapped_column(JSON, default=list)
    reason: Mapped[str] = mapped_column(String(200), default="")
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class CashSession(Base):
    """A cash drawer shift: opening float, then sales, then a counted close (over/short)."""
    __tablename__ = "cash_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    opened_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    opening_float: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    closed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expected_cash: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    counted_cash: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    note: Mapped[str] = mapped_column(Text, default="")
    movements: Mapped[list["CashMovement"]] = relationship(cascade="all, delete-orphan", order_by="CashMovement.created_at")


class CashMovement(Base):
    __tablename__ = "cash_movements"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("cash_sessions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(4))  # in | out
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    reason: Mapped[str] = mapped_column(String(200), default="")
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LiveRev(Base):
    """Per-restaurant change counters. Devices poll these cheaply and refetch only what changed."""
    __tablename__ = "live_revs"
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    topic: Mapped[str] = mapped_column(String(20), primary_key=True)
    rev: Mapped[int] = mapped_column(BigInteger, default=0)


class AuditLog(Base):
    """Who did what to money: discounts, comps, voids, refunds, reopens, cash movements, price changes."""
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_name: Mapped[str] = mapped_column(String(120), default="")
    action: Mapped[str] = mapped_column(String(40), index=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True)
    order_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


# ---------- Printing ----------
# tenants.print_key_hash (the print bridge key) is added by migrate.py and read with plain SQL in routers/printing.py.

class Printer(Base):
    """A receipt or kitchen printer. Kitchen printers take items for their stations; an empty list = catch-all."""
    __tablename__ = "printers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(10), default="receipt")  # receipt | kitchen
    stations: Mapped[list] = mapped_column(JSON, default=list)
    connection: Mapped[str] = mapped_column(String(10), default="network")  # usb | serial | network | windows
    address: Mapped[str] = mapped_column(String(200), default="")  # "192.168.1.50:9100" or "\\localhost\POS80"
    width: Mapped[int] = mapped_column(Integer, default=48)  # characters per line: 32 (58 mm) | 42 | 48 (80 mm)
    copies: Mapped[int] = mapped_column(Integer, default=1)
    cash_drawer: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PrintJob(Base):
    """A document waiting for (or sent to) a printer, delivered by a print host: a paired device or the print bridge."""
    __tablename__ = "print_jobs"
    __table_args__ = (Index("ix_print_jobs_tenant_status", "tenant_id", "status"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    printer_id: Mapped[str] = mapped_column(ForeignKey("printers.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(10))  # kot | bill | receipt | test | drawer
    title: Mapped[str] = mapped_column(String(160), default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(10), default="queued")  # queued | printing | done | failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------- Inventory ----------
# Quantities are stored in a base unit (g, ml or pc); each stock item has a display unit (kg, l, dozen...).
# Costs are stored per base unit. on_hand only ever changes through a StockMovement.
class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    phone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class StockItem(Base):
    """An ingredient or packaged good the restaurant keeps on hand."""
    __tablename__ = "stock_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(80), default="")
    unit: Mapped[str] = mapped_column(String(10), default="kg")  # display unit; the base unit follows from it
    on_hand: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))  # base units
    par_level: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))  # base units; reorder at/below
    avg_cost: Mapped[Decimal] = mapped_column(Numeric(18, 6), default=Decimal("0"))  # per base unit, moving average
    supplier_id: Mapped[str | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RecipeLine(Base):
    """How much of a stock item one serving uses: of a menu item, or of one of its modifier options (Extra cheese).

    Option lines are keyed by group + option name, the same way order lines record modifiers, so they survive
    the menu editor recreating option rows."""
    __tablename__ = "recipe_lines"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[str] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), index=True)
    modifier_group: Mapped[str] = mapped_column(String(80), default="")  # "" = the item's base recipe
    modifier_option: Mapped[str] = mapped_column(String(80), default="")
    stock_item_id: Mapped[str] = mapped_column(ForeignKey("stock_items.id", ondelete="CASCADE"), index=True)
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 4))  # base units per serving
    unit: Mapped[str] = mapped_column(String(10), default="g")  # unit the line was entered in (for display)


class StockMovement(Base):
    """Ledger of every stock change. qty is signed, in base units."""
    __tablename__ = "stock_movements"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    stock_item_id: Mapped[str] = mapped_column(ForeignKey("stock_items.id", ondelete="CASCADE"), index=True)
    # received | sale | waste | adjust | count | transfer_in | transfer_out
    kind: Mapped[str] = mapped_column(String(16), index=True)
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 4))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 6), default=Decimal("0"))  # per base unit
    reason: Mapped[str] = mapped_column(String(200), default="")
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True)
    ref_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)  # purchase order or stock count
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    supplier_id: Mapped[str | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="draft", index=True)  # draft | sent | received | cancelled
    expected_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lines: Mapped[list["PurchaseOrderLine"]] = relationship(cascade="all, delete-orphan", order_by="PurchaseOrderLine.sort")


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    po_id: Mapped[str] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True)
    stock_item_id: Mapped[str] = mapped_column(ForeignKey("stock_items.id", ondelete="CASCADE"))
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 4))  # base units ordered
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(18, 6), default=Decimal("0"))  # per base unit
    received_qty: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class StockCount(Base):
    """A submitted stock take: expected vs counted per item, kept for the variance report."""
    __tablename__ = "stock_counts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    note: Mapped[str] = mapped_column(String(200), default="")
    # [{"stock_item_id", "name", "unit", "expected", "counted", "variance", "value"}] in display units
    lines: Mapped[list] = mapped_column(JSON, default=list)
    variance_value: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0"))
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    user_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class InventoryAuto86(Base):
    """Menu items inventory marked unavailable on its own, so restocking only brings back what it took off."""
    __tablename__ = "inventory_auto86"
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True)
    menu_item_id: Mapped[str] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------- Sales leads (platform admin) ----------

class Lead(Base):
    """A restaurant Tiffin could sell to, found on OpenStreetMap / Google Places or added by hand."""
    __tablename__ = "leads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    osm_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)  # "node/123"
    google_place_id: Mapped[str | None] = mapped_column(String(300), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(80), default="")
    cuisine: Mapped[str] = mapped_column(String(200), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    area: Mapped[str] = mapped_column(String(120), default="")
    city: Mapped[str] = mapped_column(String(120), default="", index=True)
    postcode: Mapped[str] = mapped_column(String(20), default="")
    lat: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    lon: Mapped[float | None] = mapped_column(Numeric(10, 7), nullable=True)
    phone: Mapped[str] = mapped_column(String(60), default="")
    website: Mapped[str] = mapped_column(String(300), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    contact_name: Mapped[str] = mapped_column(String(120), default="")
    rating: Mapped[float | None] = mapped_column(Numeric(3, 1), nullable=True)
    reviews: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opening_hours: Mapped[str] = mapped_column(Text, default="")
    sources: Mapped[list] = mapped_column(JSON, default=list)  # ["osm", "google", "manual"]
    # new | contacted | interested | demo | won | lost | not_fit
    status: Mapped[str] = mapped_column(String(12), default="new", index=True)
    follow_up_on: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    tenant_id: Mapped[str | None] = mapped_column(ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True)
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    activities: Mapped[list["LeadActivity"]] = relationship(cascade="all, delete-orphan", order_by="LeadActivity.created_at.desc()")


class LeadActivity(Base):
    __tablename__ = "lead_activities"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    lead_id: Mapped[str] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # note | call | email | visit | status
    text: Mapped[str] = mapped_column(Text, default="")
    user_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
