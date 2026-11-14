"""Table QR ordering. Guests open /t/{token} from the code on their table: menu, their check, order more,
call a waiter, ask for the bill. No login: the unguessable per-table token is the key, so every public route
looks the table up by token and only ever touches that table's tenant. Optional module "qr_ordering".
"""
import secrets
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import menurules, taxes
from ..db import get_db
from ..deps import LIVE_STATUSES, Ctx, has_module, needs, require
from ..models import DiningTable, Kot, MenuItem, Order, OrderItem, ServiceRequest, Tenant, now
from .backoffice import _menu
from .pos import check_sellable, load_order, next_number, order_out, resolve_modifiers, settle

router = APIRouter(tags=["guest"])

ORDER_WINDOW = timedelta(minutes=2)
ORDERS_PER_WINDOW = 4  # guest orders per table per window
MAX_PENDING_LINES = 60  # unsent guest lines waiting on a table before we stop taking more
KINDS = {"order": "New guest order", "waiter": "Waiter called", "bill": "Bill requested"}


def new_token() -> str:
    return secrets.token_urlsafe(18)


def guest_table(db: Session, token: str) -> tuple[DiningTable, Tenant]:
    t = db.scalar(select(DiningTable).where(DiningTable.qr_token == token)) if token and len(token) >= 16 else None
    tenant = db.get(Tenant, t.tenant_id) if t else None
    if not t or not tenant or tenant.status not in LIVE_STATUSES or not has_module(tenant, "qr_ordering"):
        raise HTTPException(404, "This QR code isn't active. Please ask a member of staff.")
    return t, tenant


def as_ctx(tenant: Tenant) -> SimpleNamespace:
    """Enough of a request context for the shared order helpers (no signed-in user: it's a guest)."""
    return SimpleNamespace(tenant=tenant, tenant_id=tenant.id, user=None)


def open_check(db: Session, t: DiningTable) -> Order | None:
    return db.scalar(select(Order).where(Order.tenant_id == t.tenant_id, Order.table_id == t.id, Order.status == "open"))


def check_out(o: Order | None) -> dict | None:
    if not o:
        return None
    full = order_out(o)
    return {"number": o.number, "subtotal": full["subtotal"], "discount": full["discount"]["amount"], "tax": full["tax"],
            "due": full["due"], "paid": full["paid"], "balance": full["balance"],
            "items": [{"name": i["name"], "qty": i["qty"], "modifiers": [m["name"] for m in i["modifiers"]], "note": i["note"],
                       "line_total": i["line_total"], "sent": i["sent"], "done": i["done"]} for i in full["items"]]}


# ---------- Public (guest) ----------

@router.get("/guest/{token}")
def guest_view(token: str, db: Session = Depends(get_db)):
    t, tenant = guest_table(db, token)
    # Only what the table can order right now: in stock, offered on the QR menu, and inside serving hours.
    menu = [{"id": c["id"], "name": c["name"],
             "items": [i for i in c["items"] if i["available"] and (not i["channels"] or "qr" in i["channels"])]}
            for c in _menu(as_ctx(tenant), db, "qr") if c["open_now"]]
    o = open_check(db, t)
    o = load_order(db, as_ctx(tenant), o.id) if o else None
    asks = db.scalars(select(ServiceRequest.kind).where(ServiceRequest.table_id == t.id, ServiceRequest.status == "open")).all()
    return {
        "restaurant": {"name": tenant.name, "location_name": tenant.location_name or "", "currency": tenant.currency,
                       "tax_label": tenant.tax_label, "tax_rate": float(tenant.tax_rate), "auto_send": tenant.qr_auto_send,
                       "prices_include_tax": tenant.prices_include_tax},
        "table": {"name": t.name, "seats": t.seats},
        "menu": [c for c in menu if c["items"]],
        "check": check_out(o),
        "open_requests": sorted(set(asks)),
    }


class GuestLine(BaseModel):
    menu_item_id: str = Field(max_length=36)
    qty: int = Field(default=1, ge=1, le=20)
    modifier_ids: list[str] = Field(default_factory=list, max_length=30)
    note: str = Field(default="", max_length=120)


class GuestOrderIn(BaseModel):
    items: list[GuestLine] = Field(min_length=1, max_length=30)
    name: str = Field(default="", max_length=40)


@router.post("/guest/{token}/order", status_code=201)
def guest_order(token: str, body: GuestOrderIn, db: Session = Depends(get_db)):
    t, tenant = guest_table(db, token)
    ctx = as_ctx(tenant)
    recent = db.scalar(select(func.count()).select_from(ServiceRequest).where(
        ServiceRequest.table_id == t.id, ServiceRequest.kind == "order", ServiceRequest.created_at >= now() - ORDER_WINDOW)) or 0
    if recent >= ORDERS_PER_WINDOW:
        raise HTTPException(429, "That's a lot of orders in a short time. Please wait a moment or ask a member of staff.")
    o = open_check(db, t)
    if o is None:
        o = Order(tenant_id=tenant.id, number=next_number(db, Order, tenant.id), table_id=t.id, channel="dine_in", opened_by=None)
        db.add(o)
        db.flush()
    o = load_order(db, ctx, o.id)
    pending = sum(i.qty for i in o.items if i.kot_id is None and i.source == "guest")
    if pending + sum(x.qty for x in body.items) > MAX_PENDING_LINES:
        raise HTTPException(429, "Your table already has a lot waiting to be confirmed. A member of staff will be with you shortly.")
    added: list[OrderItem] = []
    pricing = menurules.Pricing(db, tenant, "qr")
    tax = taxes.Resolver(db, tenant)
    for x in body.items:
        m = db.scalar(select(MenuItem).where(MenuItem.id == x.menu_item_id, MenuItem.tenant_id == tenant.id))
        if not m:
            raise HTTPException(404, "Something on your order is no longer on the menu. Please refresh.")
        if not m.available:
            raise HTTPException(409, f"Sorry, {m.name} just sold out.")
        check_sellable(db, ctx, m, "qr")
        mods = resolve_modifiers(db, ctx, m, x.modifier_ids)
        base, plist = pricing.price(m)
        unit = base + sum((Decimal(str(md["price"])) for md in mods), Decimal(0))
        line = OrderItem(tenant_id=tenant.id, menu_item_id=m.id, name=m.name, unit_price=unit, qty=x.qty, note=x.note.strip(),
                         modifiers=mods, station=m.station, source="guest", price_list=plist)
        tax.stamp(line, m)
        o.items.append(line)
        added.append(line)
    if body.name.strip() and not o.customer_name:
        o.customer_name = body.name.strip()
    db.flush()
    settle(db, tenant, o)
    count = sum(i.qty for i in added)
    summary = ", ".join(f"{i.qty} × {i.name}" for i in added)[:280]
    sent = False
    if tenant.qr_auto_send:
        k = Kot(tenant_id=tenant.id, order_id=o.id, number=next_number(db, Kot, tenant.id), course=0)
        db.add(k)
        db.flush()
        for i in added:
            i.kot_id = k.id
        from .printing import queue_kot  # late import: printing imports pos
        queue_kot(db, ctx, o, k, added)
        sent = True
    db.add(ServiceRequest(tenant_id=tenant.id, table_id=t.id, order_id=o.id, kind="order",
                          note=f"{count} item{'s' if count != 1 else ''}{' (sent to kitchen)' if sent else ''}: {summary}"))
    db.commit()
    return {"ok": True, "sent_to_kitchen": sent, "check": check_out(load_order(db, ctx, o.id))}


class GuestAskIn(BaseModel):
    kind: str = Field(pattern=r"^(waiter|bill)$")
    note: str = Field(default="", max_length=120)


@router.post("/guest/{token}/request", status_code=201)
def guest_request(token: str, body: GuestAskIn, db: Session = Depends(get_db)):
    t, tenant = guest_table(db, token)
    if db.scalar(select(ServiceRequest.id).where(ServiceRequest.table_id == t.id, ServiceRequest.kind == body.kind,
                                                 ServiceRequest.status == "open")):
        return {"ok": True, "already": True}
    o = open_check(db, t)
    db.add(ServiceRequest(tenant_id=tenant.id, table_id=t.id, order_id=o.id if o else None, kind=body.kind, note=body.note.strip()))
    db.commit()
    return {"ok": True, "already": False}


# ---------- Staff ----------

def request_out(r: ServiceRequest, names: dict[str, str]) -> dict:
    return {"id": r.id, "table_id": r.table_id, "table": names.get(r.table_id, ""), "order_id": r.order_id, "kind": r.kind,
            "label": KINDS[r.kind], "note": r.note, "created_at": r.created_at.isoformat()}


@router.get("/service-requests", dependencies=[Depends(needs("qr_ordering"))])
def open_requests(ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    rows = db.scalars(select(ServiceRequest).where(ServiceRequest.tenant_id == ctx.tenant_id, ServiceRequest.status == "open")
                      .order_by(ServiceRequest.created_at)).all()
    names = dict(db.execute(select(DiningTable.id, DiningTable.name).where(DiningTable.tenant_id == ctx.tenant_id)).all())
    return [request_out(r, names) for r in rows]


@router.post("/service-requests/{rid}/done", dependencies=[Depends(needs("qr_ordering"))])
def request_done(rid: str, ctx: Ctx = Depends(require("floor")), db: Session = Depends(get_db)):
    r = db.scalar(select(ServiceRequest).where(ServiceRequest.id == rid, ServiceRequest.tenant_id == ctx.tenant_id))
    if not r:
        raise HTTPException(404, "Request not found")
    if r.status == "open":
        r.status, r.done_at, r.done_by = "done", now(), ctx.user.name
        db.commit()
    return {"ok": True}


@router.get("/floor/qr", dependencies=[Depends(needs("qr_ordering"))])
def table_codes(ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    """Every table's QR token (created on first use) for printing the codes."""
    ts = db.scalars(select(DiningTable).where(DiningTable.tenant_id == ctx.tenant_id).order_by(DiningTable.section, DiningTable.sort)).all()
    for t in ts:
        if not t.qr_token:
            t.qr_token = new_token()
    db.commit()
    return {"auto_send": ctx.tenant.qr_auto_send,
            "tables": [{"id": t.id, "name": t.name, "section": t.section, "seats": t.seats, "token": t.qr_token} for t in ts]}


@router.post("/floor/tables/{tid}/qr/rotate", dependencies=[Depends(needs("qr_ordering"))])
def rotate_code(tid: str, ctx: Ctx = Depends(require("tables")), db: Session = Depends(get_db)):
    """Replace a table's code (e.g. a photo of it was shared): the old printed code stops working."""
    t = db.scalar(select(DiningTable).where(DiningTable.id == tid, DiningTable.tenant_id == ctx.tenant_id))
    if not t:
        raise HTTPException(404, "Table not found")
    t.qr_token = new_token()
    db.commit()
    return {"id": t.id, "token": t.qr_token}


class QrSettingsIn(BaseModel):
    auto_send: bool


@router.put("/floor/qr/settings", dependencies=[Depends(needs("qr_ordering"))])
def qr_settings(body: QrSettingsIn, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    ctx.tenant.qr_auto_send = body.auto_send
    db.commit()
    return {"auto_send": body.auto_send}
