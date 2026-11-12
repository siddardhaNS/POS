"""Tiny additive migrations: create_all() makes new tables, this adds new columns to existing ones.

Each column is added once (checked against the live schema). A backfill runs only on the run that added it,
so later edits by the restaurant are never overwritten.
"""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .db import Base

# table -> [(column, DDL type + default, optional one-time backfill SQL)]
COLUMNS: dict[str, list[tuple[str, str, str | None]]] = {
    "tenants": [
        ("address", "TEXT NOT NULL DEFAULT ''", None),
        ("tax_id", "VARCHAR(60) NOT NULL DEFAULT ''", None),
        ("timezone", "VARCHAR(64) NOT NULL DEFAULT 'UTC'",
         "UPDATE tenants SET timezone = CASE WHEN market = 'US' THEN 'America/New_York' ELSE 'Asia/Kolkata' END"),
        ("tips_enabled", "BOOLEAN NOT NULL DEFAULT FALSE", "UPDATE tenants SET tips_enabled = (market = 'US')"),
        ("receipt_footer", "TEXT NOT NULL DEFAULT 'Thank you! See you again soon.'", None),
        ("auto_print_kot", "BOOLEAN NOT NULL DEFAULT FALSE", None),
        ("auto_print_receipt", "BOOLEAN NOT NULL DEFAULT FALSE", None),
    ],
    "dining_tables": [("section", "VARCHAR(40) NOT NULL DEFAULT 'Main'", None)],
    "orders": [
        ("customer_phone", "VARCHAR(40) NOT NULL DEFAULT ''", None),
        ("guests", "INTEGER NOT NULL DEFAULT 0", None),
        ("discount_kind", "VARCHAR(10) NOT NULL DEFAULT ''", None),
        ("discount_value", "NUMERIC(10,2) NOT NULL DEFAULT 0", None),
        ("discount_amount", "NUMERIC(12,2) NOT NULL DEFAULT 0", None),
        ("discount_reason", "VARCHAR(120) NOT NULL DEFAULT ''", None),
        ("paid", "NUMERIC(12,2) NOT NULL DEFAULT 0", "UPDATE orders SET paid = total - tip WHERE status = 'paid'"),
        ("refunded", "NUMERIC(12,2) NOT NULL DEFAULT 0", None),
        ("void_reason", "VARCHAR(200) NOT NULL DEFAULT ''", None),
    ],
    "order_items": [
        ("modifiers", "JSON NOT NULL DEFAULT '[]'", None),
        ("comp_reason", "VARCHAR(120) NOT NULL DEFAULT ''", None),
        ("course", "INTEGER NOT NULL DEFAULT 1", None),
        ("seat", "INTEGER NOT NULL DEFAULT 0", None),
        ("station", "VARCHAR(40) NOT NULL DEFAULT ''",
         "UPDATE order_items oi SET station = mi.station FROM menu_items mi WHERE mi.id = oi.menu_item_id"),
    ],
    "kots": [
        ("bumped_at", "TIMESTAMPTZ NULL", "UPDATE kots SET bumped_at = created_at WHERE bumped"),
        ("course", "INTEGER NOT NULL DEFAULT 0", None),
    ],
}

# Give checks paid before split payments existed a matching payment row (once, when the table is created).
PAYMENTS_BACKFILL = """
INSERT INTO payments (id, tenant_id, order_id, kind, method, amount, tip, tendered, change, line_ids, reason, user_id, created_at)
SELECT md5(random()::text || id), tenant_id, id, 'payment', COALESCE(NULLIF(payment_method, ''), 'other'),
       total - tip, tip, 0, 0, '[]', '', opened_by, COALESCE(closed_at, opened_at)
FROM orders WHERE status = 'paid'
"""


def migrate(engine: Engine) -> None:
    had_payments = inspect(engine).has_table("payments")
    Base.metadata.create_all(engine)
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in COLUMNS.items():
            if not insp.has_table(table):
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl, backfill in cols:
                if name in existing:
                    continue
                conn.execute(text(f'ALTER TABLE {table} ADD COLUMN "{name}" {ddl}'))
                if backfill:
                    conn.execute(text(backfill))
        if not had_payments:
            conn.execute(text(PAYMENTS_BACKFILL))
