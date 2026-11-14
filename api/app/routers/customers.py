"""Customers: the guest list built from checks (by phone), with visits, spend, favourite dishes and notes."""
import csv
import io
from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .. import crm, loyalty
from ..live import audit
from ..db import get_db
from ..deps import Ctx, require
from ..models import Customer, LoyaltyEntry, Order, OrderItem
from .pos import GSTIN, money, tenant_tz

router = APIRouter(tags=["customers"])
SOLD = ("paid", "refunded")


def stats(db: Session, tenant_id: str, ids: list[str]) -> dict[str, dict]:
    """visits, spend (after discounts and refunds, with tax), first and last visit per customer."""
    if not ids:
        return {}
    rows = db.execute(select(Order.customer_id, func.count(Order.id),
                             func.coalesce(func.sum(Order.subtotal - Order.discount_amount + Order.tax - Order.refunded), 0),
                             func.min(Order.closed_at), func.max(Order.closed_at))
                      .where(Order.tenant_id == tenant_id, Order.customer_id.in_(ids), Order.status.in_(SOLD))
                      .group_by(Order.customer_id)).all()
    return {cid: {"visits": n, "spend": money(s), "first_visit": f.isoformat() if f else None,
                  "last_visit": last.isoformat() if last else None} for cid, n, s, f, last in rows}


def customer_out(c: Customer, st: dict | None = None) -> dict:
    st = st or {"visits": 0, "spend": 0.0, "first_visit": None, "last_visit": None}
    return {"id": c.id, "name": c.name, "phone": c.phone, "email": c.email, "gstin": c.gstin, "address": c.address,
            "birthday": c.birthday.isoformat() if c.birthday else None,
            "anniversary": c.anniversary.isoformat() if c.anniversary else None,
            "tags": c.tags or [], "notes": c.notes, "points": c.points, "marketing_ok": c.marketing_ok,
            "created_at": c.created_at.isoformat(), **st,
            "avg_spend": round(st["spend"] / st["visits"], 2) if st["visits"] else 0.0}


@router.get("/customers")
def list_customers(search: str = Query("", alias="q", max_length=80), sort: str = "recent", segment: str = "",
                   ctx: Ctx = Depends(require("customers")), db: Session = Depends(get_db)):
    """Search by name, phone, email or tag. sort: recent | spend | visits | name. segment: new | regular | lapsed | birthday."""
    stmt = select(Customer).where(Customer.tenant_id == ctx.tenant_id)
    s = search.strip()
    if s:
        digits = "".join(ch for ch in s if ch.isdigit())
        conds = [Customer.name.ilike(f"%{s}%"), Customer.email.ilike(f"%{s}%")]
        if len(digits) >= 3:
            conds.append(Customer.phone.contains(digits))
        stmt = stmt.where(or_(*conds))
    rows = db.scalars(stmt.order_by(Customer.created_at.desc()).limit(2000)).all()
    st = stats(db, ctx.tenant_id, [c.id for c in rows])
    out = [customer_out(c, st.get(c.id)) for c in rows]
    tz = tenant_tz(ctx.tenant)
    today = datetime.now(tz).date()
    if segment == "new":
        out = [x for x in out if x["visits"] <= 1]
    elif segment == "regular":
        out = [x for x in out if x["visits"] >= 3]
    elif segment == "lapsed":  # came at least twice, not in the last 60 days
        cutoff = (datetime.now(tz) - timedelta(days=60)).isoformat()
        out = [x for x in out if x["visits"] >= 2 and x["last_visit"] and x["last_visit"] < cutoff]
    elif segment == "birthday":  # birthday or anniversary in the next 14 days
        def soon(d: str | None) -> bool:
            if not d:
                return False
            dd = date.fromisoformat(d)
            for y in (today.year, today.year + 1):
                try:
                    nxt = dd.replace(year=y)
                except ValueError:  # 29 Feb
                    nxt = date(y, 3, 1)
                if 0 <= (nxt - today).days <= 14:
                    return True
            return False
        out = [x for x in out if soon(x["birthday"]) or soon(x["anniversary"])]
    key = {"spend": lambda x: -x["spend"], "visits": lambda x: -x["visits"], "name": lambda x: x["name"].lower()}.get(sort)
    if sort == "recent":
        out.sort(key=lambda x: x["last_visit"] or x["created_at"], reverse=True)
    elif key:
        out.sort(key=key)
    return {"customers": out[:500], "total": len(out)}


@router.get("/customers/lookup")
def lookup(phone: str = Query(max_length=40), ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    """While taking an order: is this a known guest? Name, visits, points, notes."""
    c = crm.find(db, ctx.tenant_id, phone, ctx.tenant.market)
    if not c:
        return None
    return customer_out(c, stats(db, ctx.tenant_id, [c.id]).get(c.id))


def own(db: Session, ctx: Ctx, cid: str) -> Customer:
    c = db.scalar(select(Customer).where(Customer.id == cid, Customer.tenant_id == ctx.tenant_id))
    if not c:
        raise HTTPException(404, "Customer not found")
    return c


@router.get("/customers/{cid}")
def get_customer(cid: str, ctx: Ctx = Depends(require("customers")), db: Session = Depends(get_db)):
    c = own(db, ctx, cid)
    orders = db.scalars(select(Order).where(Order.tenant_id == ctx.tenant_id, Order.customer_id == c.id)
                        .order_by(Order.opened_at.desc()).limit(50)).all()
    fav = db.execute(select(OrderItem.name, func.sum(OrderItem.qty)).join(Order, Order.id == OrderItem.order_id)
                     .where(Order.tenant_id == ctx.tenant_id, Order.customer_id == c.id, Order.status.in_(SOLD))
                     .group_by(OrderItem.name).order_by(func.sum(OrderItem.qty).desc()).limit(5)).all()
    return {**customer_out(c, stats(db, ctx.tenant_id, [c.id]).get(c.id)),
            "favourites": [{"name": n, "qty": int(q)} for n, q in fav],
            "orders": [{"id": o.id, "number": o.number, "status": o.status, "channel": o.channel,
                        "total": money(Decimal(o.subtotal) - Decimal(o.discount_amount) + Decimal(o.tax)),
                        "refunded": money(o.refunded), "invoice_no": o.invoice_no,
                        "at": (o.closed_at or o.opened_at).isoformat()} for o in orders]}


class CustomerIn(BaseModel):
    name: str = Field(default="", max_length=120)
    phone: str = Field(min_length=6, max_length=40)
    email: EmailStr | None = None
    birthday: date | None = None
    anniversary: date | None = None
    gstin: str = Field(default="", max_length=15)
    address: str = Field(default="", max_length=400)
    tags: list[str] = Field(default_factory=list, max_length=10)
    notes: str = Field(default="", max_length=2000)
    marketing_ok: bool = True


def apply(db: Session, ctx: Ctx, c: Customer, body: CustomerIn) -> None:
    p = crm.norm_phone(body.phone, ctx.tenant.market)
    if len(p) < 6:
        raise HTTPException(422, "Enter a phone number")
    clash = db.scalar(select(Customer.id).where(Customer.tenant_id == ctx.tenant_id, Customer.phone == p))
    if clash and clash != c.id:
        raise HTTPException(409, "Another customer already has this phone number")
    g = body.gstin.strip().upper()
    if g and ctx.tenant.market == "IN" and not GSTIN.match(g):
        raise HTTPException(422, "That GSTIN doesn't look right: 15 characters like 29ABCDE1234F1Z5")
    c.name, c.phone, c.email, c.gstin = body.name.strip(), p, str(body.email or ""), g
    c.birthday, c.anniversary, c.address, c.notes = body.birthday, body.anniversary, body.address.strip(), body.notes.strip()
    c.tags = list(dict.fromkeys(t.strip()[:30] for t in body.tags if t.strip()))
    c.marketing_ok = body.marketing_ok


@router.post("/customers", status_code=201)
def add_customer(body: CustomerIn, ctx: Ctx = Depends(require("customers")), db: Session = Depends(get_db)):
    c = Customer(tenant_id=ctx.tenant_id, phone="")
    apply(db, ctx, c, body)
    db.add(c)
    db.commit()
    return customer_out(c)


@router.put("/customers/{cid}")
def edit_customer(cid: str, body: CustomerIn, ctx: Ctx = Depends(require("customers")), db: Session = Depends(get_db)):
    c = own(db, ctx, cid)
    apply(db, ctx, c, body)
    db.commit()
    return get_customer(cid, ctx, db)


@router.get("/customers-export.csv")
def export(ctx: Ctx = Depends(require("customers")), db: Session = Depends(get_db)):
    rows = db.scalars(select(Customer).where(Customer.tenant_id == ctx.tenant_id).order_by(Customer.created_at)).all()
    st = stats(db, ctx.tenant_id, [c.id for c in rows])
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Phone", "Email", "Birthday", "Anniversary", "GSTIN", "Tags", "Visits", "Spend", "Last visit",
                "Points", "Marketing OK", "Notes"])
    for c in rows:
        x = customer_out(c, st.get(c.id))
        w.writerow([x["name"], x["phone"], x["email"], x["birthday"] or "", x["anniversary"] or "", x["gstin"],
                    ", ".join(x["tags"]), x["visits"], x["spend"], (x["last_visit"] or "")[:10], x["points"],
                    "yes" if x["marketing_ok"] else "no", x["notes"]])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"content-disposition": 'attachment; filename="customers.csv"'})


@router.get("/customers/{cid}/points")
def points_history(cid: str, ctx: Ctx = Depends(require("customers")), db: Session = Depends(get_db)):
    c = own(db, ctx, cid)
    rows = db.execute(select(LoyaltyEntry, Order.number).outerjoin(Order, Order.id == LoyaltyEntry.order_id)
                      .where(LoyaltyEntry.customer_id == c.id).order_by(LoyaltyEntry.created_at.desc()).limit(100)).all()
    return {"points": c.points, "value": money(loyalty.value_of(ctx.tenant, c.points)),
            "entries": [{"id": e.id, "kind": e.kind, "points": e.points, "note": e.note, "user": e.user_name, "order_number": n,
                         "created_at": e.created_at.isoformat()} for e, n in rows]}


class AdjustIn(BaseModel):
    points: int = Field(ge=-1_000_000, le=1_000_000)
    note: str = Field(min_length=2, max_length=200)


@router.post("/customers/{cid}/points")
def adjust_points(cid: str, body: AdjustIn, ctx: Ctx = Depends(require("discount")), db: Session = Depends(get_db)):
    """Managers add or take points by hand (a welcome bonus, a correction), with a reason."""
    c = own(db, ctx, cid)
    if not body.points:
        raise HTTPException(422, "Enter the points to add or remove")
    if (c.points or 0) + body.points < 0:
        raise HTTPException(409, f"{c.name or 'This customer'} only has {c.points} points")
    loyalty.adjust(db, ctx.tenant, c, body.points, body.note.strip(), ctx.user.name)
    audit(db, ctx, "points_adjust", detail=f"{c.name or c.phone}: {body.points:+d} points · {body.note.strip()}")
    db.commit()
    return points_history(cid, ctx, db)
