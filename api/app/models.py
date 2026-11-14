"""Multi-tenant data model: every business row carries tenant_id (shared schema, row-level scoping)."""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
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
    # Multi-location: the business this outlet belongs to (null = single location) and the outlet's own name
    brand_id: Mapped[str | None] = mapped_column(ForeignKey("brands.id", ondelete="SET NULL"), nullable=True)
    location_name: Mapped[str] = mapped_column(String(80), default="")
    qr_auto_send: Mapped[bool] = mapped_column(Boolean, default=False)  # guest QR orders go straight to the kitchen
    inventory_auto_86: Mapped[bool] = mapped_column(Boolean, default=False)  # sold out when an ingredient runs out
    # Time clock: staff must clock in before using the POS; overtime thresholds in hours (0 = none)
    require_clock_in: Mapped[bool] = mapped_column(Boolean, default=False)
    ot_daily_hours: Mapped[Decimal] = mapped_column(Numeric(4, 1), default=Decimal("0"))
    ot_weekly_hours: Mapped[Decimal] = mapped_column(Numeric(5, 1), default=Decimal("40"))
    auto_print_kot: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_print_receipt: Mapped[bool] = mapped_column(Boolean, default=False)
    # Tax class for dishes with none of their own (null = the single tax_rate / tax_label above)
    default_tax_id: Mapped[str | None] = mapped_column(ForeignKey("tax_rates.id", ondelete="SET NULL", use_alter=True), nullable=True)
    invoice_prefix: Mapped[str] = mapped_column(String(12), default="")  # e.g. "BLR" -> BLR/2026-27/00001
    # Loyalty: 1 point per loyalty_earn_per spent; each point is worth loyalty_point_value when paying with points
    loyalty_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    loyalty_earn_per: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("100"))
    loyalty_point_value: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("1"))
    loyalty_min_redeem: Mapped[int] = mapped_column(Integer, default=100)
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))  # default fee on new deliveries
    kiosk_token: Mapped[str] = mapped_column(String(40), default="", index=True)  # secret in the kiosk link ("" = none)
    kiosk_auto_send: Mapped[bool] = mapped_column(Boolean, default=False)  # kiosk orders go straight to the kitchen
    prices_include_tax: Mapped[bool] = mapped_column(Boolean, default=False)  # menu prices are what the guest pays


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
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class MenuCategory(Base):
    __tablename__ = "menu_categories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    # Course phase for the service timeline: drinks | starters | mains | sides | desserts ("" = guess from the name)
    phase: Mapped[str] = mapped_column(String(12), default="")
    tax_rate_id: Mapped[str | None] = mapped_column(ForeignKey("tax_rates.id", ondelete="SET NULL"), nullable=True)
    # Serving hours, e.g. breakfast: {"days": [0..6] (Mon=0), "from": "07:00", "to": "11:00"}; {} = always
    schedule: Mapped[dict] = mapped_column(JSON, default=dict)


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
    # Guest-facing details: shown on the QR menu and the item card
    description: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)  # dietary / cuisine labels: ["Vegan", "Spicy", "South Indian"]
    allergens: Mapped[list] = mapped_column(JSON, default=list)  # keys from backoffice.ALLERGENS
    nutrition: Mapped[dict] = mapped_column(JSON, default=dict)  # {"kcal", "protein", "carbs", "fat"} per serving
    channels: Mapped[list] = mapped_column(JSON, default=list)  # menurules.CHANNELS it sells on; [] = all
    tax_rate_id: Mapped[str | None] = mapped_column(ForeignKey("tax_rates.id", ondelete="SET NULL"), nullable=True)  # null = category's
    hsn: Mapped[str] = mapped_column(String(12), default="")  # HSN / SAC code for GST invoices


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
    qr_token: Mapped[str] = mapped_column(String(40), default="", index=True)  # secret in the table's QR link ("" = none yet)


class FloorSection(Base):
    """A room or area of the floor plan (Main, Patio, Bar...). Tables reference it by name."""
    __tablename__ = "floor_sections"
    __table_args__ = (UniqueConstraint("tenant_id", "name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(40))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    # Drawn layout in grid units: {"room": [[x, y], ...], "items": [walls, doors, windows, areas...]}
    layout: Mapped[dict] = mapped_column(JSON, default=dict)


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
    customer_gstin: Mapped[str] = mapped_column(String(15), default="")  # B2B invoice: the buyer's GSTIN / tax ID
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id", ondelete="SET NULL"), nullable=True, index=True)
    # Menu prices on this check already include tax (snapshot of the restaurant setting; null = not decided yet)
    tax_inclusive: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # In-house delivery (channel "delivery")
    delivery_address: Mapped[str] = mapped_column(Text, default="")
    delivery_note: Mapped[str] = mapped_column(String(200), default="")
    delivery_fee: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))  # added to the bill, untaxed
    delivery_status: Mapped[str] = mapped_column(String(12), default="")  # preparing | out | delivered
    rider_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rider_name: Mapped[str] = mapped_column(String(120), default="")
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Catering / events (channel "catering"): when and where, and how far along it is
    event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    event_venue: Mapped[str] = mapped_column(Text, default="")
    event_note: Mapped[str] = mapped_column(Text, default="")
    event_status: Mapped[str] = mapped_column(String(10), default="")  # quote | confirmed | done | cancelled
    # Invoice number, given when the check is paid: sequential per financial year
    invoice_no: Mapped[str] = mapped_column(String(40), default="", index=True)
    invoice_fy: Mapped[str] = mapped_column(String(9), default="")
    invoice_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    guests: Mapped[int] = mapped_column(Integer, default=0)
    # Check-level discount: kind "" | "percent" | "amount"
    discount_kind: Mapped[str] = mapped_column(String(10), default="")
    discount_value: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    discount_reason: Mapped[str] = mapped_column(String(120), default="")
    # Offer applied to the check (amount is part of discount_amount)
    promotion_id: Mapped[str | None] = mapped_column(ForeignKey("promotions.id", ondelete="SET NULL"), nullable=True)
    promotion_name: Mapped[str] = mapped_column(String(80), default="")
    promotion_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    promotion_auto_off: Mapped[bool] = mapped_column(Boolean, default=False)  # staff removed the automatic offer
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
    credit_notes: Mapped[list["CreditNote"]] = relationship(order_by="CreditNote.created_at", viewonly=True)
    tenant: Mapped["Tenant"] = relationship(viewonly=True)
    customer: Mapped["Customer | None"] = relationship(viewonly=True)
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
    price_list: Mapped[str] = mapped_column(String(80), default="")  # price list that set unit_price ("" = base price)
    source: Mapped[str] = mapped_column(String(10), default="")  # "guest" = ordered by the guest from the table QR
    kot_id: Mapped[str | None] = mapped_column(ForeignKey("kots.id", ondelete="SET NULL"), nullable=True)
    returned_qty: Mapped[int] = mapped_column(Integer, default=0)  # handed back on a credit note
    # Tax snapshot when ordered (null rate = the restaurant's default single rate, for lines from before tax classes)
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(6, 5), nullable=True)
    tax_name: Mapped[str] = mapped_column(String(60), default="")
    tax_parts: Mapped[list] = mapped_column(JSON, default=list)
    hsn: Mapped[str] = mapped_column(String(12), default="")
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
    # Combo slot: picking this option serves that dish (its recipe is used for stock; sold out = can't pick)
    menu_item_id: Mapped[str | None] = mapped_column(ForeignKey("menu_items.id", ondelete="SET NULL"), nullable=True)


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
    payment_terms_days: Mapped[int] = mapped_column(Integer, default=15)  # bill due this many days after its date
    gstin: Mapped[str] = mapped_column(String(15), default="")


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
    # Preparation made in-house (gravy, dough, sauce): one batch of the PrepLines yields batch_yield base units
    is_prep: Mapped[bool] = mapped_column(Boolean, default=False)
    batch_yield: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=Decimal("0"))


class PrepLine(Base):
    """One ingredient of a preparation's batch."""
    __tablename__ = "prep_lines"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    prep_id: Mapped[str] = mapped_column(ForeignKey("stock_items.id", ondelete="CASCADE"), index=True)
    stock_item_id: Mapped[str] = mapped_column(ForeignKey("stock_items.id", ondelete="CASCADE"))
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 4))  # base units per batch
    unit: Mapped[str] = mapped_column(String(10), default="g")


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
    # [{"name", "role", "phone", "whatsapp", "email", "decision_maker"}]
    contacts: Mapped[list] = mapped_column(JSON, default=list)
    # Known sales attributes (see routers/leads.DETAILS), e.g. {"current_pos": "Petpooja", "outlets": "2"}
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    custom_fields: Mapped[list] = mapped_column(JSON, default=list)  # [{"label", "value"}] for anything else
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

# ---------- Time clock (staff time tracking) ----------
class TimeEntry(Base):
    """One shift on the clock. Role and hourly rate are snapshotted at clock-in so later changes don't rewrite payroll."""
    __tablename__ = "time_entries"
    # At most one open shift per person.
    __table_args__ = (Index("uq_time_entries_open", "user_id", unique=True, postgresql_where=text("clock_out IS NULL")),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    clock_in: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    clock_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="")
    hourly_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    note: Mapped[str] = mapped_column(String(200), default="")
    edited_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    breaks: Mapped[list["TimeBreak"]] = relationship(cascade="all, delete-orphan", order_by="TimeBreak.start")


class TimeBreak(Base):
    __tablename__ = "time_breaks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    entry_id: Mapped[str] = mapped_column(ForeignKey("time_entries.id", ondelete="CASCADE"), index=True)
    start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid: Mapped[bool] = mapped_column(Boolean, default=False)

class Brand(Base):
    """A restaurant business with several locations. Each location is its own Tenant (tenants.brand_id).

    Null brand_id means a single-location restaurant; the brand is created when a second location is added.
    """
    __tablename__ = "brands"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class UserLocation(Base):
    """Grants a user access to a location other than their home tenant (users.tenant_id). Owners reach every
    location of their brand without a row here; managers need one per extra location."""
    __tablename__ = "user_locations"
    __table_args__ = (UniqueConstraint("user_id", "tenant_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="manager")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------- Table QR ordering ----------

class ServiceRequest(Base):
    """Something a guest asked for from the table QR page: a new order to confirm, a waiter, or the bill."""
    __tablename__ = "service_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    table_id: Mapped[str] = mapped_column(ForeignKey("dining_tables.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[str] = mapped_column(String(10))  # order | waiter | bill
    note: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(8), default="open", index=True)  # open | done
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    done_by: Mapped[str] = mapped_column(String(120), default="")


# ---------- Reservations & waitlist ----------

class Reservation(Base):
    """A booking for a time, or a walk-in party on the waitlist (kind)."""
    __tablename__ = "reservations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="booking")  # booking | waitlist
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    party_size: Mapped[int] = mapped_column(Integer, default=2)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)  # booking time, or when they joined the list
    duration_min: Mapped[int] = mapped_column(Integer, default=90)
    table_id: Mapped[str | None] = mapped_column(ForeignKey("dining_tables.id", ondelete="SET NULL"), nullable=True)
    section: Mapped[str] = mapped_column(String(40), default="")  # seating preference
    notes: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(12), default="phone")  # phone | walk_in | online | other
    # booking: booked | confirmed | seated | completed | cancelled | no_show ; waitlist: waiting | notified | seated | left
    status: Mapped[str] = mapped_column(String(12), default="booked", index=True)
    quoted_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------- Price lists ----------

class PriceList(Base):
    """Alternative prices for some channels or times: delivery prices, happy hour, a festival markdown.

    While it applies, an item's price is its override here, else the base price adjusted by adjust_pct
    (e.g. -10 = 10% off, 15 = 15% more). The first matching active list by sort wins."""
    __tablename__ = "price_lists"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    channels: Mapped[list] = mapped_column(JSON, default=list)  # menurules.CHANNELS; [] = all
    schedule: Mapped[dict] = mapped_column(JSON, default=dict)  # same shape as MenuCategory.schedule
    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    adjust_pct: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=Decimal("0"))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    prices: Mapped[list["PriceListItem"]] = relationship(cascade="all, delete-orphan")


class PriceListItem(Base):
    __tablename__ = "price_list_items"
    __table_args__ = (UniqueConstraint("price_list_id", "menu_item_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    price_list_id: Mapped[str] = mapped_column(ForeignKey("price_lists.id", ondelete="CASCADE"), index=True)
    menu_item_id: Mapped[str] = mapped_column(ForeignKey("menu_items.id", ondelete="CASCADE"), index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))


# ---------- Returns ----------

class CreditNote(Base):
    """The document issued for every refund: numbered in its own series, with the items returned (if any) and the
    tax share being reversed, so the books and tax returns can net it off the original invoice."""
    __tablename__ = "credit_notes"
    __table_args__ = (UniqueConstraint("tenant_id", "number"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))  # tax included in amount
    method: Mapped[str] = mapped_column(String(20), default="")
    reason: Mapped[str] = mapped_column(String(200), default="")
    lines: Mapped[list] = mapped_column(JSON, default=list)  # [{"line_id", "name", "qty", "amount"}] returned items
    restocked: Mapped[bool] = mapped_column(Boolean, default=False)
    user_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


# ---------- Taxes ----------

class TaxRate(Base):
    """A tax class dishes can be put in, e.g. "GST 5%" = CGST 2.5% + SGST 2.5%, "GST 18%", "Exempt".

    components split the rate on the bill; empty = one line with this name. rate is the sum."""
    __tablename__ = "tax_rates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    rate: Mapped[Decimal] = mapped_column(Numeric(6, 5))
    components: Mapped[list] = mapped_column(JSON, default=list)  # [{"name": "CGST", "rate": 0.025}, ...]
    sort: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------- Customers ----------

class Customer(Base):
    """A guest the restaurant knows, keyed by phone. Checks link to them; visits and spend come from those checks."""
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("tenant_id", "phone"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(20), index=True)  # digits only, with country code when given
    email: Mapped[str] = mapped_column(String(200), default="")
    birthday: Mapped[date | None] = mapped_column(Date, nullable=True)
    anniversary: Mapped[date | None] = mapped_column(Date, nullable=True)
    gstin: Mapped[str] = mapped_column(String(15), default="")
    address: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)  # "Regular", "VIP", "Corporate"...
    notes: Mapped[str] = mapped_column(Text, default="")
    points: Mapped[int] = mapped_column(Integer, default=0)  # loyalty balance
    marketing_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------- Offers ----------

class Promotion(Base):
    """An offer: "10% off above ₹500", "₹100 off with code WELCOME", "20% off desserts", "buy 2 get 1 on beers".

    Applied automatically when eligible (auto and no code) or by staff / code. One offer per check."""
    __tablename__ = "promotions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    kind: Mapped[str] = mapped_column(String(12), default="percent")  # percent | amount | items_percent | bxgy
    value: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))  # percent or amount
    max_discount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))  # cap for percent offers (0 = none)
    buy_qty: Mapped[int] = mapped_column(Integer, default=0)  # bxgy: buy this many...
    free_qty: Mapped[int] = mapped_column(Integer, default=0)  # ...get this many of the cheapest free
    item_ids: Mapped[list] = mapped_column(JSON, default=list)  # items_percent / bxgy: dishes it covers
    category_ids: Mapped[list] = mapped_column(JSON, default=list)  # ...or whole categories
    min_subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    channels: Mapped[list] = mapped_column(JSON, default=list)  # menurules.CHANNELS; [] = all
    schedule: Mapped[dict] = mapped_column(JSON, default=dict)  # days / hours, like menu categories
    starts_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    code: Mapped[str] = mapped_column(String(30), default="")  # "" = no code needed
    auto: Mapped[bool] = mapped_column(Boolean, default=False)  # apply by itself when eligible (no code)
    customers_only: Mapped[bool] = mapped_column(Boolean, default=False)  # check must have a customer
    first_visit_only: Mapped[bool] = mapped_column(Boolean, default=False)
    max_uses: Mapped[int] = mapped_column(Integer, default=0)  # across all checks (0 = unlimited)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class LoyaltyEntry(Base):
    """Points ledger: earned on paid checks, spent as a tender, reversed on refunds, or adjusted by a manager."""
    __tablename__ = "loyalty_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(10))  # earn | redeem | reverse | adjust
    points: Mapped[int] = mapped_column(Integer)  # signed
    note: Mapped[str] = mapped_column(String(200), default="")
    user_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


# ---------- Vendor bills & payables ----------

class VendorBill(Base):
    """A supplier's invoice: what the restaurant owes, by when. Usually raised from a received purchase order."""
    __tablename__ = "vendor_bills"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    po_id: Mapped[str | None] = mapped_column(ForeignKey("purchase_orders.id", ondelete="SET NULL"), nullable=True)
    bill_no: Mapped[str] = mapped_column(String(60), default="")
    bill_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))  # total including tax
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))  # input tax on the bill
    note: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    payments: Mapped[list["VendorPayment"]] = relationship(cascade="all, delete-orphan", order_by="VendorPayment.paid_on")


class VendorPayment(Base):
    """Money paid against a bill. method "credit" uses up the supplier's credit balance (returns, rebates)."""
    __tablename__ = "vendor_payments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    bill_id: Mapped[str] = mapped_column(ForeignKey("vendor_bills.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    method: Mapped[str] = mapped_column(String(12), default="bank")  # bank | cash | upi | cheque | card | credit
    reference: Mapped[str] = mapped_column(String(80), default="")
    paid_on: Mapped[date] = mapped_column(Date)
    user_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class VendorCredit(Base):
    """Credit a supplier owes back (goods returned, short supply, rebate), used up by paying bills with it."""
    __tablename__ = "vendor_credits"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    reason: Mapped[str] = mapped_column(String(200), default="")
    on_date: Mapped[date] = mapped_column(Date)
    user_name: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# ---------- Stock transfers between locations ----------

class StockTransfer(Base):
    """Stock sent from one location of a business to another (central kitchen to outlets, or outlet to outlet).
    Sending takes it off the source; the destination receives what actually arrived."""
    __tablename__ = "stock_transfers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    brand_id: Mapped[str] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    from_tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    to_tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default="sent")  # sent | received | cancelled
    # [{"name", "unit", "qty" (base), "unit_cost" (per base), "from_item_id", "to_item_id", "received" (base)}]
    lines: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str] = mapped_column(String(300), default="")
    sent_by: Mapped[str] = mapped_column(String(120), default="")
    received_by: Mapped[str] = mapped_column(String(120), default="")
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
