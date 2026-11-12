"""Multi-tenant data model: every business row carries tenant_id (shared schema, row-level scoping)."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
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


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    table_id: Mapped[str | None] = mapped_column(ForeignKey("dining_tables.id", ondelete="SET NULL"), nullable=True)
    # dine_in | takeaway | swiggy | zomato | doordash | ubereats | website
    channel: Mapped[str] = mapped_column(String(20), default="dine_in")
    # new (online, awaiting accept) | open | paid | void | rejected
    status: Mapped[str] = mapped_column(String(12), default="open", index=True)
    customer_name: Mapped[str] = mapped_column(String(120), default="")
    subtotal: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    tax: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    tip: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    payment_method: Mapped[str] = mapped_column(String(20), default="")
    opened_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    items: Mapped[list["OrderItem"]] = relationship(cascade="all, delete-orphan", order_by="OrderItem.created_at")
    table: Mapped[DiningTable | None] = relationship()


class Kot(Base):
    """Kitchen order ticket: a batch of order items fired to the kitchen together."""

    __tablename__ = "kots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(Integer)
    bumped: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
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
    kot_id: Mapped[str | None] = mapped_column(ForeignKey("kots.id", ondelete="SET NULL"), nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    kot: Mapped[Kot | None] = relationship(back_populates="items")
