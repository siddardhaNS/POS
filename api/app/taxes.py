"""Tax classes: which rate a dish is taxed at (item -> category -> restaurant default), the snapshot kept on each
order line, the per-component breakdown for bills (CGST / SGST), and invoice numbering.

Prices are tax-exclusive: tax is added on top of the line after its share of any check discount.
"""
from collections import defaultdict
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import MenuCategory, MenuItem, Order, OrderItem, TaxRate, Tenant

CENT = Decimal("0.01")


def parts_of(name: str, rate: Decimal, components: list | None) -> list[dict]:
    """Bill lines for a rate: its components, or the rate itself as one line."""
    if components:
        return [{"name": str(c["name"]), "rate": float(c["rate"])} for c in components]
    return [{"name": name, "rate": float(rate)}]


def rate_out(r: TaxRate) -> dict:
    return {"id": r.id, "name": r.name, "rate": float(r.rate), "components": r.components or [], "sort": r.sort}


class Resolver:
    """Loads the restaurant's classes once and answers 'what tax does this dish carry'."""

    def __init__(self, db: Session, tenant: Tenant):
        self.tenant = tenant
        self.rates = {r.id: r for r in db.scalars(select(TaxRate).where(TaxRate.tenant_id == tenant.id))}
        self.cat_rate = dict(db.execute(select(MenuCategory.id, MenuCategory.tax_rate_id)
                                        .where(MenuCategory.tenant_id == tenant.id)).all())

    def for_item(self, m: MenuItem) -> TaxRate | None:
        rid = m.tax_rate_id or self.cat_rate.get(m.category_id) or self.tenant.default_tax_id
        return self.rates.get(rid) if rid else None

    def stamp(self, line: OrderItem, m: MenuItem) -> None:
        """Copy the dish's tax onto the order line, so later rate changes don't rewrite past bills."""
        r = self.for_item(m)
        if r is None:
            line.tax_rate, line.tax_name = Decimal(self.tenant.tax_rate), self.tenant.tax_label or "Tax"
            line.tax_parts = parts_of(line.tax_name, line.tax_rate, None)
        else:
            line.tax_rate, line.tax_name, line.tax_parts = r.rate, r.name, parts_of(r.name, r.rate, r.components)
        line.hsn = m.hsn or ""


def line_rate(i: OrderItem, default: Decimal) -> Decimal:
    return Decimal(i.tax_rate) if i.tax_rate is not None else Decimal(default)


def discount_factor(o: Order) -> Decimal:
    sub = Decimal(o.subtotal or 0)
    return (1 - Decimal(o.discount_amount or 0) / sub) if sub else Decimal(1)


def order_tax(o: Order, default: Decimal, line_total) -> Decimal:
    """Tax for the whole check: each line's rate on its value after its share of the discount."""
    f = discount_factor(o)
    return sum((line_total(i) * f * line_rate(i, default) for i in o.items), Decimal(0)).quantize(CENT, ROUND_HALF_UP)


def breakdown(o: Order, default_rate: Decimal, default_label: str, line_total) -> list[dict]:
    """[{"name": "CGST", "rate": 2.5, "taxable": 952.0, "tax": 23.8}] per component, for bills and the tax report.
    Rounded per component, then nudged so the parts add up to the check's tax exactly."""
    f = discount_factor(o)
    acc: dict[tuple[str, float], list[Decimal]] = defaultdict(lambda: [Decimal(0), Decimal(0)])
    for i in o.items:
        net = line_total(i) * f
        parts = i.tax_parts or parts_of(i.tax_name or default_label or "Tax", line_rate(i, default_rate), None)
        for p in parts:
            key = (p["name"], float(p["rate"]))
            acc[key][0] += net
            acc[key][1] += net * Decimal(str(p["rate"]))
    rows = [{"name": n, "rate": round(r * 100, 3), "taxable": v[0].quantize(CENT, ROUND_HALF_UP), "tax": v[1].quantize(CENT, ROUND_HALF_UP)}
            for (n, r), v in sorted(acc.items(), key=lambda kv: (-kv[0][1], kv[0][0])) if v[0] or v[1]]
    drift = Decimal(o.tax or 0) - sum((r["tax"] for r in rows), Decimal(0))
    if rows and drift and abs(drift) <= CENT * len(rows):
        rows[0]["tax"] += drift
    return [{**r, "taxable": float(r["taxable"]), "tax": float(r["tax"])} for r in rows]


# ---------- Invoice numbers ----------

def financial_year(t: Tenant, at: datetime) -> str:
    """India: April-March ("2026-27"). Elsewhere the calendar year ("2026")."""
    if t.market == "IN":
        y = at.year if at.month >= 4 else at.year - 1
        return f"{y}-{str(y + 1)[2:]}"
    return str(at.year)


def assign_invoice(db: Session, t: Tenant, o: Order, at: datetime) -> None:
    """Give a paid check the next invoice number of its financial year (once; reopening keeps it)."""
    if o.invoice_no:
        return
    try:
        at = at.astimezone(ZoneInfo(t.timezone or "UTC"))  # the local date decides the financial year
    except Exception:
        pass
    fy = financial_year(t, at)
    seq = (db.scalar(select(func.max(Order.invoice_seq)).where(Order.tenant_id == t.id, Order.invoice_fy == fy)) or 0) + 1
    prefix = (t.invoice_prefix or "").strip().upper()
    o.invoice_fy, o.invoice_seq = fy, seq
    o.invoice_no = "/".join(x for x in (prefix, fy, f"{seq:05d}") if x)


def ensure_starter_rates(db: Session, t: Tenant) -> None:
    """GST restaurants start with the common classes (5% default, 12%, 18%, exempt)."""
    if t.market != "IN" or db.scalar(select(TaxRate.id).where(TaxRate.tenant_id == t.id).limit(1)):
        return
    made = []
    for i, pct in enumerate(("5", "12", "18")):
        r = Decimal(pct) / 100
        half = r / 2
        made.append(TaxRate(tenant_id=t.id, name=f"GST {pct}%", rate=r, sort=i,
                            components=[{"name": "CGST", "rate": float(half)}, {"name": "SGST", "rate": float(half)}]))
    made.append(TaxRate(tenant_id=t.id, name="Exempt", rate=Decimal(0), sort=3, components=[]))
    db.add_all(made)
    db.flush()
    t.default_tax_id = made[0].id
    t.tax_rate, t.tax_label = made[0].rate, "GST 5%"
