"""Vendor bills, payments and credits, and what the restaurant owes each supplier (payables with aging).
Part of the inventory module."""
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import Ctx, needs
from ..live import audit
from ..models import PurchaseOrder, Supplier, VendorBill, VendorCredit, VendorPayment
from ..stock import D
from .inventory import MANAGE
from .pos import money, tenant_tz

router = APIRouter(prefix="/inventory", tags=["payables"], dependencies=[Depends(needs("inventory"))])
METHODS = r"^(bank|cash|upi|cheque|card|credit)$"
BUCKETS = (("current", "Not due"), ("d30", "1-30 days late"), ("d60", "31-60"), ("d90", "61-90"), ("d90p", "90+"))
NO_NUMBER = "(no number)"


def today(ctx: Ctx) -> date:
    return datetime.now(tenant_tz(ctx.tenant)).date()


def paid_of(b: VendorBill) -> Decimal:
    return sum((D(p.amount) for p in b.payments), Decimal(0))


def bill_out(b: VendorBill, names: dict[str, str], on: date) -> dict:
    paid = paid_of(b)
    due = D(b.amount) - paid
    status = "paid" if due <= Decimal("0.005") else "partial" if paid else "unpaid"
    late = (on - b.due_date).days if status != "paid" else 0
    return {"id": b.id, "supplier_id": b.supplier_id, "supplier": names.get(b.supplier_id, ""), "po_id": b.po_id,
            "bill_no": b.bill_no, "bill_date": b.bill_date.isoformat(), "due_date": b.due_date.isoformat(),
            "amount": money(b.amount), "tax": money(b.tax), "paid": money(paid), "due": money(max(due, Decimal(0))),
            "status": status, "days_late": max(late, 0), "note": b.note,
            "payments": [{"id": p.id, "amount": money(p.amount), "method": p.method, "reference": p.reference,
                          "paid_on": p.paid_on.isoformat(), "user": p.user_name} for p in b.payments]}


def names_of(db: Session, ctx: Ctx) -> dict[str, str]:
    return dict(db.execute(select(Supplier.id, Supplier.name).where(Supplier.tenant_id == ctx.tenant_id)).all())


def credit_balance(db: Session, ctx: Ctx, sid: str) -> Decimal:
    given = db.scalar(select(func.coalesce(func.sum(VendorCredit.amount), 0)).where(
        VendorCredit.tenant_id == ctx.tenant_id, VendorCredit.supplier_id == sid)) or 0
    used = db.scalar(select(func.coalesce(func.sum(VendorPayment.amount), 0)).join(VendorBill, VendorBill.id == VendorPayment.bill_id)
                     .where(VendorPayment.tenant_id == ctx.tenant_id, VendorBill.supplier_id == sid,
                            VendorPayment.method == "credit")) or 0
    return D(given) - D(used)


def load(db: Session, bid: str) -> VendorBill:
    return db.scalar(select(VendorBill).where(VendorBill.id == bid).options(selectinload(VendorBill.payments)))


@router.get("/bills")
def bills(status: str = "open", supplier_id: str = "", ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    """status: open (unpaid or part paid) | paid | all."""
    stmt = select(VendorBill).where(VendorBill.tenant_id == ctx.tenant_id).options(selectinload(VendorBill.payments))
    if supplier_id:
        stmt = stmt.where(VendorBill.supplier_id == supplier_id)
    rows = db.scalars(stmt.order_by(VendorBill.due_date, VendorBill.bill_date).limit(1000)).all()
    names, on = names_of(db, ctx), today(ctx)
    out = [bill_out(b, names, on) for b in rows]
    if status == "open":
        out = [b for b in out if b["status"] != "paid"]
    elif status == "paid":
        out = [b for b in out if b["status"] == "paid"][::-1][:200]
    return out


class BillIn(BaseModel):
    supplier_id: str = Field(max_length=36)
    po_id: str | None = Field(default=None, max_length=36)
    bill_no: str = Field(default="", max_length=60)
    bill_date: date
    due_date: date | None = None  # default: bill date + the supplier's payment terms
    amount: float = Field(gt=0, le=100_000_000)
    tax: float = Field(default=0, ge=0, le=100_000_000)
    note: str = Field(default="", max_length=300)


def own_supplier(db: Session, ctx: Ctx, sid: str) -> Supplier:
    s = db.scalar(select(Supplier).where(Supplier.id == sid, Supplier.tenant_id == ctx.tenant_id))
    if not s:
        raise HTTPException(404, "Supplier not found")
    return s


def apply(db: Session, ctx: Ctx, b: VendorBill, body: BillIn) -> None:
    s = own_supplier(db, ctx, body.supplier_id)
    if body.po_id and not db.scalar(select(PurchaseOrder.id).where(PurchaseOrder.id == body.po_id,
                                                                    PurchaseOrder.tenant_id == ctx.tenant_id)):
        raise HTTPException(404, "Purchase order not found")
    if body.tax > body.amount:
        raise HTTPException(422, "Tax can't be more than the bill total")
    due = body.due_date or body.bill_date + timedelta(days=s.payment_terms_days or 0)
    if due < body.bill_date:
        raise HTTPException(422, "The due date is before the bill date")
    no = body.bill_no.strip()
    if no and db.scalar(select(VendorBill.id).where(VendorBill.tenant_id == ctx.tenant_id, VendorBill.supplier_id == s.id,
                                                    VendorBill.bill_no == no, VendorBill.id != (b.id or ""))):
        raise HTTPException(409, f"Bill {no} from {s.name} is already entered")
    b.supplier_id, b.po_id, b.bill_no = s.id, body.po_id or None, no
    b.bill_date, b.due_date = body.bill_date, due
    b.amount, b.tax, b.note = Decimal(str(body.amount)), Decimal(str(body.tax)), body.note.strip()


@router.post("/bills", status_code=201)
def add_bill(body: BillIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    b = VendorBill(tenant_id=ctx.tenant_id, created_by=ctx.user.name, supplier_id=body.supplier_id, bill_date=body.bill_date,
                   due_date=body.bill_date, amount=Decimal(0))
    apply(db, ctx, b, body)
    db.add(b)
    audit(db, ctx, "vendor_bill", amount=b.amount, detail=f"Bill {b.bill_no or NO_NUMBER} entered")
    db.commit()
    return bill_out(load(db, b.id), names_of(db, ctx), today(ctx))


def own_bill(db: Session, ctx: Ctx, bid: str) -> VendorBill:
    b = db.scalar(select(VendorBill).where(VendorBill.id == bid, VendorBill.tenant_id == ctx.tenant_id)
                  .options(selectinload(VendorBill.payments)))
    if not b:
        raise HTTPException(404, "Bill not found")
    return b


@router.put("/bills/{bid}")
def edit_bill(bid: str, body: BillIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    b = own_bill(db, ctx, bid)
    apply(db, ctx, b, body)
    if paid_of(b) > D(b.amount) + Decimal("0.005"):
        raise HTTPException(409, "More than this has already been paid on the bill")
    db.commit()
    return bill_out(b, names_of(db, ctx), today(ctx))


@router.delete("/bills/{bid}")
def delete_bill(bid: str, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    b = own_bill(db, ctx, bid)
    if b.payments:
        raise HTTPException(409, "This bill has payments. Remove them first.")
    audit(db, ctx, "vendor_bill", amount=b.amount, detail=f"Bill {b.bill_no or NO_NUMBER} deleted")
    db.delete(b)
    db.commit()
    return {"ok": True}


class PaymentIn(BaseModel):
    amount: float = Field(gt=0, le=100_000_000)
    method: str = Field(default="bank", pattern=METHODS)
    reference: str = Field(default="", max_length=80)
    paid_on: date | None = None


@router.post("/bills/{bid}/payments", status_code=201)
def pay_bill(bid: str, body: PaymentIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    b = own_bill(db, ctx, bid)
    amt = Decimal(str(body.amount)).quantize(Decimal("0.01"))
    left = D(b.amount) - paid_of(b)
    if amt > left + Decimal("0.005"):
        raise HTTPException(409, f"Only {money(left)} is left on this bill")
    if body.method == "credit":
        bal = credit_balance(db, ctx, b.supplier_id)
        if amt > bal + Decimal("0.005"):
            raise HTTPException(409, f"The supplier's credit is {money(bal)}")
    b.payments.append(VendorPayment(tenant_id=ctx.tenant_id, amount=amt, method=body.method, reference=body.reference.strip(),
                                    paid_on=body.paid_on or today(ctx), user_name=ctx.user.name))
    ref = f" · {body.reference.strip()}" if body.reference.strip() else ""
    audit(db, ctx, "vendor_payment", amount=amt, detail=f"{body.method} · bill {b.bill_no or NO_NUMBER}{ref}")
    db.commit()
    return bill_out(b, names_of(db, ctx), today(ctx))


@router.delete("/bills/{bid}/payments/{pid}")
def remove_payment(bid: str, pid: str, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    b = own_bill(db, ctx, bid)
    p = next((x for x in b.payments if x.id == pid), None)
    if not p:
        raise HTTPException(404, "Payment not found")
    audit(db, ctx, "vendor_payment", amount=-D(p.amount), detail=f"Payment removed · bill {b.bill_no or NO_NUMBER}")
    b.payments.remove(p)
    db.commit()
    return bill_out(b, names_of(db, ctx), today(ctx))


@router.post("/purchase-orders/{pid}/bill", status_code=201)
def bill_from_po(pid: str, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    """Start a bill from a received purchase order: what arrived, at the agreed cost."""
    po = db.scalar(select(PurchaseOrder).where(PurchaseOrder.id == pid, PurchaseOrder.tenant_id == ctx.tenant_id)
                   .options(selectinload(PurchaseOrder.lines)))
    if not po:
        raise HTTPException(404, "Purchase order not found")
    if not po.supplier_id:
        raise HTTPException(409, "Give the purchase order a supplier first")
    if db.scalar(select(VendorBill.id).where(VendorBill.po_id == po.id)):
        raise HTTPException(409, f"PO {po.number} already has a bill")
    total = sum((D(ln.received_qty or ln.qty) * D(ln.unit_cost) for ln in po.lines), Decimal(0)).quantize(Decimal("0.01"))
    if total <= 0:
        raise HTTPException(409, "Nothing on this purchase order has a cost yet")
    on = po.received_at.astimezone(tenant_tz(ctx.tenant)).date() if po.received_at else today(ctx)
    return add_bill(BillIn(supplier_id=po.supplier_id, po_id=po.id, bill_no="", bill_date=on, amount=float(total),
                           note=f"From PO {po.number}"), ctx, db)


class CreditIn(BaseModel):
    amount: float = Field(gt=0, le=100_000_000)
    reason: str = Field(min_length=2, max_length=200)
    on_date: date | None = None


@router.post("/suppliers/{sid}/credits", status_code=201)
def add_credit(sid: str, body: CreditIn, ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    s = own_supplier(db, ctx, sid)
    amt = Decimal(str(body.amount))
    db.add(VendorCredit(tenant_id=ctx.tenant_id, supplier_id=s.id, amount=amt, reason=body.reason.strip(),
                        on_date=body.on_date or today(ctx), user_name=ctx.user.name))
    audit(db, ctx, "vendor_credit", amount=amt, detail=f"{s.name} · {body.reason.strip()}")
    db.commit()
    return {"supplier_id": s.id, "credit": money(credit_balance(db, ctx, s.id))}


def bucket_of(late: int) -> str:
    return "current" if late <= 0 else "d30" if late <= 30 else "d60" if late <= 60 else "d90" if late <= 90 else "d90p"


@router.get("/payables")
def payables(ctx: Ctx = Depends(MANAGE), db: Session = Depends(get_db)):
    """What's owed to each supplier, aged by how late it is, plus credits they hold for you."""
    on = today(ctx)
    names = names_of(db, ctx)
    rows = db.scalars(select(VendorBill).where(VendorBill.tenant_id == ctx.tenant_id)
                      .options(selectinload(VendorBill.payments))).all()
    zero = {k: Decimal(0) for k, _ in BUCKETS}
    per: dict[str, dict] = {}
    totals = defaultdict(Decimal)
    month_start = on.replace(day=1)
    for b in rows:
        totals["paid_month"] += sum((D(p.amount) for p in b.payments if p.paid_on >= month_start and p.method != "credit"),
                                    Decimal(0))
        due = D(b.amount) - paid_of(b)
        if due <= Decimal("0.005"):
            continue
        k = bucket_of((on - b.due_date).days)
        r = per.setdefault(b.supplier_id, {"bills": 0, "due": Decimal(0), **zero})
        r["bills"] += 1
        r["due"] += due
        r[k] += due
        totals[k] += due
        totals["due"] += due
        if 0 <= (b.due_date - on).days <= 7:
            totals["week"] += due
    sids = set(per) | set(db.scalars(select(VendorCredit.supplier_id).where(VendorCredit.tenant_id == ctx.tenant_id)))
    out = []
    for sid in sids:
        r = per.get(sid) or {"bills": 0, "due": Decimal(0), **zero}
        credit = credit_balance(db, ctx, sid)
        if r["due"] or credit:
            out.append({"supplier_id": sid, "supplier": names.get(sid, ""), "bills": r["bills"], "due": money(r["due"]),
                        **{k: money(r[k]) for k, _ in BUCKETS}, "credit": money(credit)})
    return {"buckets": [{"key": k, "label": label} for k, label in BUCKETS], "due": money(totals["due"]),
            "overdue": money(totals["due"] - totals["current"]), "due_this_week": money(totals["week"]),
            "paid_this_month": money(totals["paid_month"]), **{k: money(totals[k]) for k, _ in BUCKETS},
            "suppliers": sorted(out, key=lambda r: -r["due"])}
