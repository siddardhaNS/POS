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
        ("print_key_hash", "VARCHAR(64) NOT NULL DEFAULT ''", None),
        # Restaurants already running when modules arrived keep everything they had; applications still awaiting
        # review (and every new signup) start with the basics.
        ("modules", "JSON NOT NULL DEFAULT '[]'",
         """UPDATE tenants SET modules = '["online", "reports_plus", "printing", "menu_scan"]'
            WHERE status IN ('trial', 'active', 'suspended')"""),
        ("inventory_auto_86", "BOOLEAN NOT NULL DEFAULT FALSE", None),
        # Time clock
        ("require_clock_in", "BOOLEAN NOT NULL DEFAULT FALSE", None),
        ("ot_daily_hours", "NUMERIC(4,1) NOT NULL DEFAULT 0", None),
        ("ot_weekly_hours", "NUMERIC(5,1) NOT NULL DEFAULT 40", None),
        ("brand_id", "VARCHAR(36) NULL REFERENCES brands(id) ON DELETE SET NULL", None),
        ("location_name", "VARCHAR(80) NOT NULL DEFAULT ''", None),
        ("qr_auto_send", "BOOLEAN NOT NULL DEFAULT FALSE", None),
        ("default_tax_id", "VARCHAR(36) NULL REFERENCES tax_rates(id) ON DELETE SET NULL", None),
        ("invoice_prefix", "VARCHAR(12) NOT NULL DEFAULT ''", None),
    ],
    "users": [
        ("hourly_rate", "NUMERIC(10,2) NOT NULL DEFAULT 0", None),
    ],
    "dining_tables": [
        ("section", "VARCHAR(40) NOT NULL DEFAULT 'Main'", None),
        ("shape", "VARCHAR(12) NOT NULL DEFAULT 'square'",
         "UPDATE dining_tables SET shape = CASE WHEN seats >= 6 THEN 'rect' WHEN seats <= 2 THEN 'round' ELSE 'square' END"),
        ("x", "INTEGER NOT NULL DEFAULT 0", "UPDATE dining_tables SET x = (sort % 4) * 6 + 2"),
        ("y", "INTEGER NOT NULL DEFAULT 0", "UPDATE dining_tables SET y = (sort / 4) * 6 + 2"),
        ("rotation", "INTEGER NOT NULL DEFAULT 0", None),
        ("qr_token", "VARCHAR(40) NOT NULL DEFAULT ''", None),
    ],
    "orders": [
        ("customer_phone", "VARCHAR(40) NOT NULL DEFAULT ''", None),
        ("customer_gstin", "VARCHAR(15) NOT NULL DEFAULT ''", None),
        ("invoice_no", "VARCHAR(40) NOT NULL DEFAULT ''", None),
        ("invoice_fy", "VARCHAR(9) NOT NULL DEFAULT ''", None),
        ("invoice_seq", "INTEGER NULL", None),
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
        ("source", "VARCHAR(10) NOT NULL DEFAULT ''", None),
        ("price_list", "VARCHAR(80) NOT NULL DEFAULT ''", None),
        ("returned_qty", "INTEGER NOT NULL DEFAULT 0", None),
        ("tax_rate", "NUMERIC(6,5) NULL", None),
        ("tax_name", "VARCHAR(60) NOT NULL DEFAULT ''", None),
        ("tax_parts", "JSON NOT NULL DEFAULT '[]'", None),
        ("hsn", "VARCHAR(12) NOT NULL DEFAULT ''", None),
        ("station", "VARCHAR(40) NOT NULL DEFAULT ''",
         "UPDATE order_items oi SET station = mi.station FROM menu_items mi WHERE mi.id = oi.menu_item_id"),
    ],
    "leads": [
        ("contacts", "JSON NOT NULL DEFAULT '[]'", None),
        ("details", "JSON NOT NULL DEFAULT '{}'", None),
        ("custom_fields", "JSON NOT NULL DEFAULT '[]'", None),
    ],
    "menu_items": [
        ("description", "TEXT NOT NULL DEFAULT ''", None),
        ("tags", "JSON NOT NULL DEFAULT '[]'", None),
        ("allergens", "JSON NOT NULL DEFAULT '[]'", None),
        ("nutrition", "JSON NOT NULL DEFAULT '{}'", None),
        ("channels", "JSON NOT NULL DEFAULT '[]'", None),
        ("tax_rate_id", "VARCHAR(36) NULL REFERENCES tax_rates(id) ON DELETE SET NULL", None),
        ("hsn", "VARCHAR(12) NOT NULL DEFAULT ''", None),
    ],
    "menu_categories": [
        ("phase", "VARCHAR(12) NOT NULL DEFAULT ''", None),
        ("schedule", "JSON NOT NULL DEFAULT '{}'", None),
        ("tax_rate_id", "VARCHAR(36) NULL REFERENCES tax_rates(id) ON DELETE SET NULL", None),
    ],
    "floor_sections": [
        ("layout", "JSON NOT NULL DEFAULT '{}'", None),
    ],
    "modifier_options": [
        ("menu_item_id", "VARCHAR(36) NULL REFERENCES menu_items(id) ON DELETE SET NULL", None),
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


# One floor_sections row per section name already used by tables.
SECTIONS_BACKFILL = """
INSERT INTO floor_sections (id, tenant_id, name, sort)
SELECT md5(random()::text || tenant_id || section), tenant_id, section,
       ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY MIN(sort)) - 1
FROM dining_tables GROUP BY tenant_id, section
"""


def migrate(engine: Engine) -> None:
    had_payments = inspect(engine).has_table("payments")
    had_sections = inspect(engine).has_table("floor_sections")
    had_taxes = inspect(engine).has_table("tax_rates")
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
        if not had_sections:
            conn.execute(text(SECTIONS_BACKFILL))
        if not had_taxes:
            for stmt in TAX_BACKFILL.split(";"):
                if stmt.strip():
                    conn.execute(text(stmt))


# Restaurants on GST get their current rate as a tax class split into CGST + SGST halves, set as the default
# (once, when tax classes arrive). Others keep their single rate until they add classes.
TAX_BACKFILL = """
INSERT INTO tax_rates (id, tenant_id, name, rate, components, sort, created_at)
SELECT md5(random()::text || id), id, 'GST ' || trim(trailing '.' from trim(trailing '0' from (tax_rate * 100)::text)) || '%', tax_rate,
       json_build_array(json_build_object('name', 'CGST', 'rate', tax_rate / 2), json_build_object('name', 'SGST', 'rate', tax_rate / 2)),
       0, now()
FROM tenants WHERE market = 'IN';
UPDATE tenants t SET default_tax_id = r.id FROM tax_rates r WHERE r.tenant_id = t.id AND t.market = 'IN';
"""
