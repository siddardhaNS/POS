"""Customer records: phone normalisation and linking checks to the customer they belong to.

Kept free of router imports so pos.py and guest.py can link checks without a cycle."""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Customer, Order


def norm_phone(v: str, market: str = "") -> str:
    """Digits only. A bare 10-digit Indian number gets 91 in front, a bare 10-digit US one 1, so the same guest
    typed two ways is one record."""
    d = re.sub(r"\D", "", v or "")
    if d.startswith("00"):
        d = d[2:]
    if len(d) == 11 and d.startswith("0") and market == "IN":
        d = d[1:]
    if len(d) == 10:
        d = ("91" if market == "IN" else "1" if market == "US" else "") + d
    return d[:20]


def find(db: Session, tenant_id: str, phone: str, market: str) -> Customer | None:
    p = norm_phone(phone, market)
    if len(p) < 6:
        return None
    return db.scalar(select(Customer).where(Customer.tenant_id == tenant_id, Customer.phone == p))


def link(db: Session, tenant, o: Order) -> Customer | None:
    """Attach the check to the customer with its phone number, creating the record on first visit. Fills blanks
    both ways (a known name onto the check, a new name or GSTIN onto the record) and never overwrites."""
    p = norm_phone(o.customer_phone, tenant.market)
    if len(p) < 6:
        o.customer_id = None
        return None
    c = db.scalar(select(Customer).where(Customer.tenant_id == tenant.id, Customer.phone == p))
    if c is None:
        c = Customer(tenant_id=tenant.id, phone=p, name=(o.customer_name or "").strip()[:120], gstin=o.customer_gstin or "")
        db.add(c)
        db.flush()
    else:
        if not c.name and o.customer_name:
            c.name = o.customer_name.strip()[:120]
        if not c.gstin and o.customer_gstin:
            c.gstin = o.customer_gstin
    if not o.customer_name and c.name:
        o.customer_name = c.name
    if not o.customer_gstin and c.gstin:
        o.customer_gstin = c.gstin
    o.customer_id = c.id
    return c
