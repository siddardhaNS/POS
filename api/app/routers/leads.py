"""Platform admin: find restaurants to approach (OpenStreetMap, Google Places) and work them through a sales pipeline."""
import csv
import io
from datetime import date

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.orm import Session, selectinload

from .. import leadsources as src
from ..db import get_db
from ..deps import Ctx, platform_admin
from ..models import Lead, LeadActivity, Tenant, now

router = APIRouter(prefix="/admin/leads", tags=["leads"])

STATUSES = ("new", "contacted", "interested", "demo", "won", "lost", "not_fit")
STATUS_LABEL = {"new": "New", "contacted": "Contacted", "interested": "Interested", "demo": "Demo booked", "won": "Won",
                "lost": "Lost", "not_fit": "Not a fit"}
# Sales attributes captured per lead (key -> label); stored in Lead.details.
DETAILS: dict[str, str] = {
    "alt_phone": "Alternate phone", "whatsapp": "WhatsApp", "instagram": "Instagram", "facebook": "Facebook",
    "current_pos": "Current POS", "outlets": "Outlets", "seats": "Seats", "service_style": "Service style",
    "delivery_apps": "Delivery apps", "daily_orders": "Orders per day", "avg_check": "Average check",
    "best_time": "Best time to call", "language": "Language", "referred_by": "Referred by", "budget": "Budget / plan",
}
FIELDS = ("name", "category", "cuisine", "address", "area", "city", "postcode", "phone", "website", "email", "rating",
          "reviews", "opening_hours")


def fnum(v) -> float | None:
    return float(v) if v is not None else None


def lead_out(x: Lead, full: bool = False) -> dict:
    out = {"id": x.id, "osm_id": x.osm_id, "google_place_id": x.google_place_id, "name": x.name, "category": x.category,
           "cuisine": x.cuisine, "address": x.address, "area": x.area, "city": x.city, "postcode": x.postcode,
           "lat": fnum(x.lat), "lon": fnum(x.lon), "phone": x.phone, "website": x.website, "email": x.email,
           "contact_name": x.contact_name, "contacts": x.contacts or [], "details": x.details or {},
           "custom_fields": x.custom_fields or [], "rating": fnum(x.rating), "reviews": x.reviews, "opening_hours": x.opening_hours,
           "sources": x.sources or [], "status": x.status, "follow_up_on": x.follow_up_on.isoformat() if x.follow_up_on else None,
           "notes": x.notes, "tenant_id": x.tenant_id, "created_at": x.created_at.isoformat(),
           "last_contacted_at": x.last_contacted_at.isoformat() if x.last_contacted_at else None}
    if full:
        out["activities"] = [{"id": a.id, "kind": a.kind, "text": a.text, "user": a.user_name, "created_at": a.created_at.isoformat()}
                             for a in x.activities]
    return out


# ---------- Finding ----------

@router.get("/fields")
def fields(_: Ctx = Depends(platform_admin)):
    """The sales attributes a lead can capture, in display order."""
    return [{"key": k, "label": v} for k, v in DETAILS.items()]


@router.get("/sources")
def sources(_: Ctx = Depends(platform_admin)):
    return {"osm": True, "google": src.google_enabled(),
            "categories": [{"key": k, "label": v[2].capitalize()} for k, v in src.CATEGORIES.items()]}


class SearchIn(BaseModel):
    area: str = Field(min_length=2, max_length=200)
    radius_km: float = Field(default=2, ge=0.2, le=15)
    categories: list[str] = Field(default_factory=lambda: ["restaurant", "cafe", "fast_food"], min_length=1, max_length=10)
    sources: list[str] = Field(default_factory=lambda: ["osm"], min_length=1, max_length=2)


def known(db: Session, rows: list[dict]) -> None:
    """Flag candidates already saved as leads, or already Tiffin customers."""
    osm = {r["osm_id"] for r in rows if r["osm_id"]}
    gid = {r["google_place_id"] for r in rows if r["google_place_id"]}
    saved = db.execute(select(Lead.id, Lead.osm_id, Lead.google_place_id, Lead.name, Lead.lat, Lead.lon, Lead.status)
                       .where(or_(Lead.osm_id.in_(osm or {""}), Lead.google_place_id.in_(gid or {""}),
                                  Lead.city.in_({r["city"] for r in rows if r["city"]} or {""})))).all()
    tenants = [(src.norm(n), (c or "").lower()) for n, c in db.execute(select(Tenant.name, Tenant.city)).all()]
    for r in rows:
        hit = next((s for s in saved if (r["osm_id"] and s.osm_id == r["osm_id"]) or (r["google_place_id"] and s.google_place_id == r["google_place_id"])
                    or (src.norm(s.name) == src.norm(r["name"]) and src.meters(fnum(s.lat), fnum(s.lon), r["lat"], r["lon"]) < 120)), None)
        r["lead_id"], r["lead_status"] = (hit.id, hit.status) if hit else (None, None)
        n = src.norm(r["name"])
        r["customer"] = bool(n) and any(n == tn and (not tc or not r["city"] or r["city"].lower() in tc or tc in r["city"].lower())
                                        for tn, tc in tenants)


@router.post("/search")
def search(body: SearchIn, _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    cats = [c for c in body.categories if c in src.CATEGORIES]
    if not cats:
        raise HTTPException(422, "Pick at least one kind of place")
    radius = int(body.radius_km * 1000)
    rows: list[dict] = []
    notes: list[str] = []
    with httpx.Client(timeout=30) as client:
        try:
            center = src.geocode(client, body.area)
        except httpx.HTTPError:
            raise HTTPException(502, "Couldn't reach the OpenStreetMap place search. Try again in a minute.")
        if "osm" in body.sources:
            rows += src.osm_search(client, center["lat"], center["lon"], radius, cats, limit=400)
        if "google" in body.sources:
            if src.google_enabled():
                rows += src.google_search(client, body.area, center["lat"], center["lon"], radius, cats)
            else:
                notes.append("Google isn't set up yet, so only OpenStreetMap was searched.")
    rows = src.merge(rows)
    for r in rows:
        r["city"] = r["city"] or center["city"]
        r["distance_m"] = round(src.meters(center["lat"], center["lon"], r["lat"], r["lon"]))
    known(db, rows)
    rows.sort(key=lambda r: (r["lead_id"] is not None or r["customer"], r["distance_m"]))
    return {"center": center, "radius_m": radius, "results": rows, "notes": notes,
            "counts": {"total": len(rows), "with_phone": sum(1 for r in rows if r["phone"]),
                       "new": sum(1 for r in rows if not r["lead_id"] and not r["customer"])}}


class CandidateIn(BaseModel):
    osm_id: str | None = Field(default=None, max_length=40)
    google_place_id: str | None = Field(default=None, max_length=300)
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(default="", max_length=80)
    cuisine: str = Field(default="", max_length=200)
    address: str = Field(default="", max_length=2000)
    area: str = Field(default="", max_length=120)
    city: str = Field(default="", max_length=120)
    postcode: str = Field(default="", max_length=20)
    lat: float | None = None
    lon: float | None = None
    phone: str = Field(default="", max_length=60)
    website: str = Field(default="", max_length=300)
    email: str = Field(default="", max_length=200)
    rating: float | None = Field(default=None, ge=0, le=5)
    reviews: int | None = Field(default=None, ge=0)
    opening_hours: str = Field(default="", max_length=2000)
    sources: list[str] = Field(default_factory=list, max_length=3)


class ImportIn(BaseModel):
    items: list[CandidateIn] = Field(min_length=1, max_length=500)


@router.post("/import")
def import_leads(body: ImportIn, ctx: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    rows = [{**i.model_dump(), "sources": [s for s in i.sources if s in ("osm", "google")]} for i in body.items]
    known(db, rows)
    added = 0
    for r in rows:
        if r["lead_id"] or r["customer"]:
            continue
        x = Lead(**{k: r[k] for k in FIELDS}, osm_id=r["osm_id"], google_place_id=r["google_place_id"],
                 lat=r["lat"], lon=r["lon"], sources=r["sources"] or ["manual"])
        x.activities.append(LeadActivity(kind="note", text="Found on " + " and ".join(
            {"osm": "OpenStreetMap", "google": "Google"}[s] for s in x.sources if s in ("osm", "google")), user_name=ctx.user.name))
        db.add(x)
        added += 1
    db.commit()
    return {"added": added, "skipped": len(rows) - added}


# ---------- Pipeline ----------

@router.get("")
def list_leads(status: str = "", q: str = "", city: str = "", has_phone: bool = False, due: bool = False,
               _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    stmt = select(Lead)
    if status:
        stmt = stmt.where(Lead.status == status)
    if city:
        stmt = stmt.where(func.lower(Lead.city) == city.lower())
    if has_phone:
        stmt = stmt.where(Lead.phone != "")
    if due:
        stmt = stmt.where(Lead.follow_up_on.is_not(None), Lead.follow_up_on <= date.today())
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Lead.name).like(like), func.lower(Lead.area).like(like), func.lower(Lead.city).like(like),
                              func.lower(Lead.cuisine).like(like), Lead.phone.like(like), func.lower(Lead.email).like(like),
                              func.lower(Lead.contact_name).like(like), func.lower(cast(Lead.contacts, Text)).like(like),
                              func.lower(cast(Lead.details, Text)).like(like), func.lower(cast(Lead.custom_fields, Text)).like(like)))
    rows = db.scalars(stmt.order_by(Lead.follow_up_on.asc().nulls_last(), Lead.created_at.desc()).limit(1000)).all()
    counts = dict(db.execute(select(Lead.status, func.count()).group_by(Lead.status)).all())
    cities = [c for c, in db.execute(select(Lead.city).where(Lead.city != "").group_by(Lead.city).order_by(func.count().desc()).limit(30))]
    due_n = db.scalar(select(func.count()).select_from(Lead).where(Lead.follow_up_on.is_not(None), Lead.follow_up_on <= date.today(),
                                                                   Lead.status.notin_(("won", "lost", "not_fit"))))
    return {"leads": [lead_out(x) for x in rows], "counts": {s: counts.get(s, 0) for s in STATUSES},
            "total": sum(counts.values()), "due": due_n or 0, "cities": cities}


def get_lead(db: Session, lid: str) -> Lead:
    x = db.scalar(select(Lead).where(Lead.id == lid).options(selectinload(Lead.activities))
                  .execution_options(populate_existing=True))  # reload the timeline in order after an append
    if not x:
        raise HTTPException(404, "Lead not found")
    return x


@router.get("/{lid}")
def lead(lid: str, _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    return lead_out(get_lead(db, lid), full=True)


class ContactIn(BaseModel):
    name: str = Field(default="", max_length=120)
    role: str = Field(default="", max_length=60)
    phone: str = Field(default="", max_length=60)
    whatsapp: bool = False
    email: str = Field(default="", max_length=200)
    decision_maker: bool = False


class CustomFieldIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    value: str = Field(default="", max_length=500)


class LeadPatch(BaseModel):
    status: str | None = Field(default=None, pattern=r"^(new|contacted|interested|demo|won|lost|not_fit)$")
    follow_up_on: date | None = None
    clear_follow_up: bool = False
    notes: str | None = Field(default=None, max_length=5000)
    contact_name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=60)
    email: str | None = Field(default=None, max_length=200)
    website: str | None = Field(default=None, max_length=300)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    area: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=120)
    address: str | None = Field(default=None, max_length=2000)
    cuisine: str | None = Field(default=None, max_length=200)
    contacts: list[ContactIn] | None = Field(default=None, max_length=20)
    details: dict[str, str] | None = None
    custom_fields: list[CustomFieldIn] | None = Field(default=None, max_length=40)


@router.patch("/{lid}")
def edit_lead(lid: str, body: LeadPatch, ctx: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    x = get_lead(db, lid)
    if body.status and body.status != x.status:
        x.activities.append(LeadActivity(kind="status", text=f"{STATUS_LABEL[x.status]} → {STATUS_LABEL[body.status]}",
                                         user_name=ctx.user.name))
        x.status = body.status
        if body.status in ("won", "lost", "not_fit"):
            x.follow_up_on = None
    if body.clear_follow_up:
        x.follow_up_on = None
    elif body.follow_up_on:
        x.follow_up_on = body.follow_up_on
    for k in ("notes", "contact_name", "phone", "email", "website", "name", "area", "city", "address", "cuisine"):
        v = getattr(body, k)
        if v is not None:
            setattr(x, k, v.strip())
    if body.contacts is not None:
        x.contacts = [c.model_dump() | {k: c.model_dump()[k].strip() for k in ("name", "role", "phone", "email")}
                      for c in body.contacts if c.name.strip() or c.phone.strip() or c.email.strip()]
        lead_contact = next((c for c in x.contacts if c["decision_maker"]), x.contacts[0] if x.contacts else None)
        if lead_contact and lead_contact["name"]:
            x.contact_name = lead_contact["name"]
    if body.details is not None:
        unknown = set(body.details) - set(DETAILS)
        if unknown:
            raise HTTPException(422, f"Unknown detail: {', '.join(sorted(unknown))}")
        x.details = {k: str(v).strip()[:300] for k, v in body.details.items() if str(v).strip()}
    if body.custom_fields is not None:
        x.custom_fields = [{"label": f.label.strip(), "value": f.value.strip()} for f in body.custom_fields if f.label.strip()]
    x.updated_at = now()
    db.commit()
    return lead_out(get_lead(db, lid), full=True)


class ActivityIn(BaseModel):
    kind: str = Field(pattern=r"^(note|call|email|visit)$")
    text: str = Field(min_length=1, max_length=5000)
    follow_up_on: date | None = None


@router.post("/{lid}/activities", status_code=201)
def add_activity(lid: str, body: ActivityIn, ctx: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    x = get_lead(db, lid)
    x.activities.append(LeadActivity(kind=body.kind, text=body.text.strip(), user_name=ctx.user.name))
    if body.kind in ("call", "email", "visit"):
        x.last_contacted_at = now()
        if x.status == "new":
            x.activities.append(LeadActivity(kind="status", text="New → Contacted", user_name=ctx.user.name))
            x.status = "contacted"
    if body.follow_up_on:
        x.follow_up_on = body.follow_up_on
    x.updated_at = now()
    db.commit()
    return lead_out(get_lead(db, lid), full=True)


class ManualIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    city: str = Field(default="", max_length=120)
    area: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=60)
    email: str = Field(default="", max_length=200)
    contact_name: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=5000)


@router.post("", status_code=201)
def add_lead(body: ManualIn, ctx: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    x = Lead(**body.model_dump(), sources=["manual"])
    if body.contact_name.strip() or body.phone.strip() or body.email.strip():
        x.contacts = [{"name": body.contact_name.strip(), "role": "", "phone": body.phone.strip(), "whatsapp": False,
                       "email": body.email.strip(), "decision_maker": True}]
    x.activities.append(LeadActivity(kind="note", text="Added by hand", user_name=ctx.user.name))
    db.add(x)
    db.commit()
    return lead_out(get_lead(db, x.id), full=True)


@router.delete("/{lid}")
def delete_lead(lid: str, _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    db.delete(get_lead(db, lid))
    db.commit()
    return {"ok": True}


@router.get("/export/csv")
def export(status: str = "", _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    stmt = select(Lead).order_by(Lead.city, Lead.name)
    if status:
        stmt = stmt.where(Lead.status == status)
    cols = ["name", "status", "category", "cuisine", "area", "city", "address", "phone", "email", "website", "contact_name",
            "contacts", *DETAILS, "other_details", "rating", "reviews", "follow_up_on", "notes", "sources", "created_at"]
    titles = {**{c: c.replace("_", " ").capitalize() for c in cols}, **DETAILS}

    def rows():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow([titles[c] for c in cols])
        yield "﻿" + buf.getvalue()
        for x in db.scalars(stmt):
            buf.seek(0)
            buf.truncate()
            o = lead_out(x)
            o["status"] = STATUS_LABEL.get(o["status"], o["status"])
            o["sources"] = ", ".join(o["sources"])
            o["contacts"] = "; ".join(" ".join(filter(None, [c.get("name"), f"({c['role']})" if c.get("role") else "", c.get("phone"),
                                                             c.get("email")])) for c in o["contacts"])
            o.update(o["details"])
            o["other_details"] = "; ".join(f"{f['label']}: {f['value']}" for f in o["custom_fields"])
            w.writerow(["" if o.get(c) is None else o.get(c) for c in cols])
            yield buf.getvalue()

    return StreamingResponse(rows(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="tiffin-leads-{date.today()}.csv"'})
