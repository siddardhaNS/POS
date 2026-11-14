"""Self-order kiosk. A screen at the counter opens /k/{token}: guests browse the menu, order, and pay at the till.

No login: the unguessable kiosk token is the key, and every public route only touches that token's restaurant.
Orders arrive as takeaway checks with a number to call out. Optional module "kiosk"."""
import secrets
from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import crm, menurules, taxes
from ..db import get_db
from ..deps import LIVE_STATUSES, Ctx, has_module, needs, require
from ..live import audit
from ..models import Kot, MenuItem, Order, OrderItem, Tenant, now
from .backoffice import _menu
from .guest import as_ctx
from .pos import check_sellable, load_order, next_number, order_out, resolve_modifiers, settle

router = APIRouter(tags=["kiosk"])
WINDOW = timedelta(minutes=1)
PER_WINDOW = 6  # kiosk orders a minute, so a stuck screen or a prank can't flood the kitchen


def kiosk_tenant(db: Session, token: str) -> Tenant:
    t = db.scalar(select(Tenant).where(Tenant.kiosk_token == token)) if token and len(token) >= 16 else None
    if not t or t.status not in LIVE_STATUSES or not has_module(t, "kiosk"):
        raise HTTPException(404, "This kiosk isn't active. Please order at the counter.")
    return t


@router.get("/kiosk/{token}")
def kiosk_view(token: str, db: Session = Depends(get_db)):
    t = kiosk_tenant(db, token)
    menu = [{"id": c["id"], "name": c["name"],
             "items": [i for i in c["items"] if i["available"] and (not i["channels"] or "kiosk" in i["channels"])]}
            for c in _menu(as_ctx(t), db, "kiosk") if c["open_now"]]
    return {"restaurant": {"name": t.name, "location_name": t.location_name or "", "currency": t.currency,
                           "tax_label": t.tax_label, "auto_send": t.kiosk_auto_send,
                           "prices_include_tax": t.prices_include_tax},
            "menu": [c for c in menu if c["items"]]}


class KioskLine(BaseModel):
    menu_item_id: str = Field(max_length=36)
    qty: int = Field(default=1, ge=1, le=20)
    modifier_ids: list[str] = Field(default_factory=list, max_length=30)
    note: str = Field(default="", max_length=120)


class KioskOrderIn(BaseModel):
    items: list[KioskLine] = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=40)
    phone: str = Field(default="", max_length=20)


@router.post("/kiosk/{token}/order", status_code=201)
def kiosk_order(token: str, body: KioskOrderIn, db: Session = Depends(get_db)):
    t = kiosk_tenant(db, token)
    ctx = as_ctx(t)
    recent = db.scalar(select(func.count()).select_from(Order).where(
        Order.tenant_id == t.id, Order.channel == "takeaway", Order.opened_by.is_(None), Order.opened_at >= now() - WINDOW)) or 0
    if recent >= PER_WINDOW:
        raise HTTPException(429, "Lots of orders right now. Please wait a moment or order at the counter.")
    o = Order(tenant_id=t.id, number=next_number(db, Order, t.id), channel="takeaway", customer_name=body.name.strip(),
              customer_phone=body.phone.strip(), opened_by=None)
    db.add(o)
    db.flush()
    o = load_order(db, ctx, o.id)
    pricing, tax = menurules.Pricing(db, t, "kiosk"), taxes.Resolver(db, t)
    for x in body.items:
        m = db.scalar(select(MenuItem).where(MenuItem.id == x.menu_item_id, MenuItem.tenant_id == t.id))
        if not m:
            raise HTTPException(404, "Something in your order is no longer on the menu. Please start again.")
        check_sellable(db, ctx, m, "kiosk")
        mods = resolve_modifiers(db, ctx, m, x.modifier_ids)
        base, plist = pricing.price(m)
        line = OrderItem(tenant_id=t.id, menu_item_id=m.id, name=m.name, qty=x.qty, note=x.note.strip(), modifiers=mods,
                         unit_price=base + sum((Decimal(str(md["price"])) for md in mods), Decimal(0)), station=m.station,
                         source="kiosk", price_list=plist)
        tax.stamp(line, m)
        o.items.append(line)
    if o.customer_phone:
        crm.link(db, t, o)
    settle(db, t, o)
    sent = False
    if t.kiosk_auto_send:
        k = Kot(tenant_id=t.id, order_id=o.id, number=next_number(db, Kot, t.id), course=0)
        db.add(k)
        db.flush()
        for i in o.items:
            i.kot_id = k.id
        from .printing import queue_kot  # late import: printing imports pos
        queue_kot(db, ctx, o, k, list(o.items))
        sent = True
    db.commit()
    out = order_out(load_order(db, ctx, o.id))
    return {"number": out["number"], "due": out["due"], "sent_to_kitchen": sent,
            "items": [{"name": i["name"], "qty": i["qty"], "line_total": i["line_total"]} for i in out["items"]]}


# ---------- Staff: the kiosk link ----------

@router.get("/kiosk-settings", dependencies=[Depends(needs("kiosk"))])
def kiosk_settings(ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    t = db.merge(ctx.tenant)
    if not t.kiosk_token:
        t.kiosk_token = secrets.token_urlsafe(18)
        db.commit()
    return {"token": t.kiosk_token, "auto_send": t.kiosk_auto_send}


class KioskSettingsIn(BaseModel):
    auto_send: bool | None = None
    rotate: bool = False


@router.put("/kiosk-settings", dependencies=[Depends(needs("kiosk"))])
def save_kiosk_settings(body: KioskSettingsIn, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    t = db.merge(ctx.tenant)
    if body.auto_send is not None:
        t.kiosk_auto_send = body.auto_send
    if body.rotate:
        t.kiosk_token = secrets.token_urlsafe(18)
        audit(db, ctx, "settings", detail="Kiosk link replaced")
    db.commit()
    return {"token": t.kiosk_token, "auto_send": t.kiosk_auto_send}
