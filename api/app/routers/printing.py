"""Direct thermal printing through a server-side print queue.

Browsers can't open sockets to LAN printers and the API is serverless, so printing works like this:
  1. Something printable happens (KOT sent, bill or receipt asked for, test page) and a PrintJob is queued per printer.
  2. A print host claims queued jobs and delivers the ESC/POS bytes:
       - a POS device with a USB / serial printer paired in the browser (WebUSB / Web Serial), via /print/claim
       - the print bridge on a shop PC, for network and Windows-shared printers, via /print/bridge/claim
  3. The host reports the result; failed jobs can be retried or sent to another printer from Settings.

Kitchen tickets are split by station: each kitchen printer lists the stations it prints; a kitchen printer with
no stations is the catch-all for every station that has no printer of its own.
"""
import base64
import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, or_, select, text, update
from sqlalchemy.orm import Session

from .. import escpos, printdocs
from ..db import get_db
from ..deps import LIVE_STATUSES, PERMISSIONS, Ctx, has_module, needs, require, tenant_user
from ..models import Kot, Order, OrderItem, Printer, PrintJob, Tenant, now
from .pos import load_order

router = APIRouter(tags=["printing"])

STALE = timedelta(seconds=60)  # a job "printing" this long without a result is claimed again
ONLINE = timedelta(seconds=30)
MAX_ATTEMPTS = 3
BATCH = 10
BRIDGE_CONNECTIONS = ("network", "windows")


# ---------- Queueing (also used by pos.send_kot) ----------

def kitchen_printers(db: Session, tenant_id: str) -> list[Printer]:
    return list(db.scalars(select(Printer).where(Printer.tenant_id == tenant_id, Printer.role == "kitchen",
                                                 Printer.enabled.is_(True)).order_by(Printer.sort, Printer.created_at)).all())


def queue_kot(db: Session, ctx: Ctx, o: Order, k: Kot, items: list[OrderItem]) -> tuple[int, bool]:
    """Queue one ticket per kitchen printer with just its items. Returns (jobs queued, restaurant has kitchen printers)."""
    if not has_module(ctx.tenant, "printing"):
        return 0, False
    printers = kitchen_printers(db, ctx.tenant_id)
    if not printers:
        return 0, False
    if not ctx.tenant.auto_print_kot:
        return 0, True
    catch_all = [p for p in printers if not p.stations]
    routed: dict[str, list[OrderItem]] = {}
    for i in items:
        st = (i.station or "").strip().lower()
        targets = [p for p in printers if st and st in {s.strip().lower() for s in p.stations or []}] or catch_all
        for p in targets:
            routed.setdefault(p.id, []).append(i)
    jobs = 0
    for p in printers:
        if p.id in routed:
            db.add(PrintJob(tenant_id=ctx.tenant_id, printer_id=p.id, order_id=o.id, kind="kot",
                            title=f"KOT {k.number} · {printdocs.kds_title(o)}"[:160],
                            payload=printdocs.kot_doc(ctx.tenant, o, k, routed[p.id], p)))
            jobs += 1
    return jobs, True


def add_job(db: Session, tenant_id: str, p: Printer, kind: str, title: str, doc: dict, order_id: str | None = None) -> PrintJob:
    j = PrintJob(tenant_id=tenant_id, printer_id=p.id, order_id=order_id, kind=kind, title=title[:160], payload=doc)
    db.add(j)
    db.commit()
    return j


# ---------- Printers ----------

def printer_out(p: Printer) -> dict:
    seen = p.last_seen_at
    return {"id": p.id, "name": p.name, "role": p.role, "stations": p.stations or [], "connection": p.connection,
            "address": p.address, "width": p.width, "copies": p.copies, "cash_drawer": p.cash_drawer, "enabled": p.enabled,
            "sort": p.sort, "last_seen_at": seen.isoformat() if seen else None,
            "online": bool(seen and now() - seen < ONLINE), "last_error": p.last_error, "created_at": p.created_at.isoformat()}


def clean_stations(v: list[str]) -> list[str]:
    out: list[str] = []
    for s in v:
        s = s.strip()[:40]
        if s and s.lower() not in {x.lower() for x in out}:
            out.append(s)
    return out


class PrinterIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    role: str = Field(default="receipt", pattern=r"^(receipt|kitchen)$")
    stations: list[str] = Field(default_factory=list, max_length=40)
    connection: str = Field(default="network", pattern=r"^(usb|serial|network|windows)$")
    address: str = Field(default="", max_length=200)
    width: int = 48
    copies: int = Field(default=1, ge=1, le=3)
    cash_drawer: bool = False
    enabled: bool = True
    sort: int | None = Field(default=None, ge=0, le=999)

    @field_validator("width")
    @classmethod
    def _width(cls, v: int) -> int:
        if v not in (32, 42, 48):
            raise ValueError("Paper width must be 32, 42 or 48 characters")
        return v


class PrinterPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    role: str | None = Field(default=None, pattern=r"^(receipt|kitchen)$")
    stations: list[str] | None = Field(default=None, max_length=40)
    connection: str | None = Field(default=None, pattern=r"^(usb|serial|network|windows)$")
    address: str | None = Field(default=None, max_length=200)
    width: int | None = None
    copies: int | None = Field(default=None, ge=1, le=3)
    cash_drawer: bool | None = None
    enabled: bool | None = None
    sort: int | None = Field(default=None, ge=0, le=999)

    @field_validator("width")
    @classmethod
    def _width(cls, v: int | None) -> int | None:
        if v is not None and v not in (32, 42, 48):
            raise ValueError("Paper width must be 32, 42 or 48 characters")
        return v


def normalize(p: Printer) -> None:
    p.name = p.name.strip()
    p.stations = clean_stations(p.stations or []) if p.role == "kitchen" else []
    p.address = (p.address or "").strip()
    if p.connection == "network":
        if not p.address:
            raise HTTPException(422, "Enter the printer's IP address, e.g. 192.168.1.50")
        if ":" not in p.address:
            p.address += ":9100"
    elif p.connection == "windows":
        if not p.address:
            raise HTTPException(422, r"Enter the shared printer path, e.g. \\localhost\POS80")
    else:
        p.address = ""
    if p.role != "receipt":
        p.cash_drawer = False


def get_printer(db: Session, ctx: Ctx, pid: str) -> Printer:
    p = db.scalar(select(Printer).where(Printer.id == pid, Printer.tenant_id == ctx.tenant_id))
    if not p:
        raise HTTPException(404, "Printer not found")
    return p


@router.get("/printers", dependencies=[Depends(needs("printing"))])
def list_printers(ctx: Ctx = Depends(tenant_user), db: Session = Depends(get_db)):
    ps = db.scalars(select(Printer).where(Printer.tenant_id == ctx.tenant_id).order_by(Printer.sort, Printer.created_at)).all()
    return [printer_out(p) for p in ps]


@router.post("/printers", status_code=201, dependencies=[Depends(needs("printing"))])
def create_printer(body: PrinterIn, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    first_kitchen = body.role == "kitchen" and not db.scalar(
        select(Printer.id).where(Printer.tenant_id == ctx.tenant_id, Printer.role == "kitchen").limit(1))
    data = body.model_dump()
    if data["sort"] is None:
        data["sort"] = len(db.scalars(select(Printer.id).where(Printer.tenant_id == ctx.tenant_id)).all())
    p = Printer(tenant_id=ctx.tenant_id, **data)
    normalize(p)
    db.add(p)
    if first_kitchen:  # the restaurant just got a kitchen printer: start printing tickets on it
        ctx.tenant.auto_print_kot = True
    db.commit()
    return printer_out(p)


@router.patch("/printers/{pid}", dependencies=[Depends(needs("printing"))])
def edit_printer(pid: str, body: PrinterPatch, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    p = get_printer(db, ctx, pid)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(p, k, v)
    normalize(p)
    if body.enabled is not None or body.connection is not None:
        p.last_error = ""
    db.commit()
    return printer_out(p)


@router.delete("/printers/{pid}", dependencies=[Depends(needs("printing"))])
def delete_printer(pid: str, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    db.delete(get_printer(db, ctx, pid))
    db.commit()
    return {"ok": True}


@router.post("/printers/{pid}/test", dependencies=[Depends(needs("printing"))])
def test_printer(pid: str, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    p = get_printer(db, ctx, pid)
    j = add_job(db, ctx.tenant_id, p, "test", f"Test page · {p.name}", printdocs.test_doc(ctx.tenant, p))
    return {"queued": True, "job_id": j.id, "printer": p.name}


# ---------- Bills, receipts, cash drawer ----------

def receipt_printer(db: Session, ctx: Ctx, pid: str | None) -> Printer:
    """This device's receipt printer if it's still set up, else the restaurant's first receipt printer."""
    q = select(Printer).where(Printer.tenant_id == ctx.tenant_id, Printer.role == "receipt", Printer.enabled.is_(True))
    p = db.scalar(q.where(Printer.id == pid)) if pid else None
    p = p or db.scalar(q.order_by(Printer.sort, Printer.created_at).limit(1))
    if not p:
        raise HTTPException(409, "No receipt printer set up")
    return p


class PrintOrderIn(BaseModel):
    kind: str = Field(default="receipt", pattern=r"^(bill|receipt)$")
    printer_id: str | None = Field(default=None, max_length=36)
    drawer: bool = False


@router.post("/print/orders/{oid}", dependencies=[Depends(needs("printing"))])
def print_order(oid: str, body: PrintOrderIn, ctx: Ctx = Depends(require("order")), db: Session = Depends(get_db)):
    o = load_order(db, ctx, oid)
    p = receipt_printer(db, ctx, body.printer_id)
    doc = printdocs.check_doc(ctx.tenant, o, body.kind)
    if body.drawer and p.cash_drawer and "pay" in PERMISSIONS.get(ctx.user.role, set()):
        doc["drawer"] = True
    label = "Bill" if body.kind == "bill" else "Receipt"
    j = add_job(db, ctx.tenant_id, p, body.kind, f"{label} · #{o.number}", doc, order_id=o.id)
    return {"queued": True, "job_id": j.id, "printer": p.name}


class DrawerIn(BaseModel):
    printer_id: str | None = Field(default=None, max_length=36)


@router.post("/print/drawer", dependencies=[Depends(needs("printing"))])
def kick_drawer(body: DrawerIn, ctx: Ctx = Depends(require("pay")), db: Session = Depends(get_db)):
    """Open the cash drawer wired to a receipt printer. No-op when that printer has no drawer."""
    p = receipt_printer(db, ctx, body.printer_id)
    if not p.cash_drawer:
        return {"queued": False, "printer": p.name}
    j = add_job(db, ctx.tenant_id, p, "drawer", f"Open drawer · {p.name}", printdocs.drawer_doc())
    return {"queued": True, "job_id": j.id, "printer": p.name}


# ---------- Job list (Settings) ----------

def job_out(j: PrintJob, names: dict[str, str]) -> dict:
    return {"id": j.id, "printer_id": j.printer_id, "printer": names.get(j.printer_id, ""), "order_id": j.order_id,
            "kind": j.kind, "title": j.title, "status": j.status, "attempts": j.attempts, "error": j.error,
            "created_at": j.created_at.isoformat(), "printed_at": j.printed_at.isoformat() if j.printed_at else None}


@router.get("/print/jobs", dependencies=[Depends(needs("printing"))])
def list_jobs(status: str = "recent", ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    q = select(PrintJob).where(PrintJob.tenant_id == ctx.tenant_id)
    if status == "failed":
        q = q.where(PrintJob.status == "failed")
    elif status == "active":
        q = q.where(PrintJob.status.in_(("queued", "printing")))
    jobs = db.scalars(q.order_by(PrintJob.created_at.desc()).limit(50 if status == "failed" else 30)).all()
    names = dict(db.execute(select(Printer.id, Printer.name).where(Printer.tenant_id == ctx.tenant_id)).all())
    return [job_out(j, names) for j in jobs]


class RetryIn(BaseModel):
    printer_id: str | None = Field(default=None, max_length=36)


@router.post("/print/jobs/{jid}/retry", dependencies=[Depends(needs("printing"))])
def retry_job(jid: str, body: RetryIn | None = None, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    j = db.scalar(select(PrintJob).where(PrintJob.id == jid, PrintJob.tenant_id == ctx.tenant_id))
    if not j:
        raise HTTPException(404, "Print job not found")
    if body and body.printer_id:
        j.printer_id = get_printer(db, ctx, body.printer_id).id
    j.status, j.attempts, j.error, j.claimed_at, j.printed_at = "queued", 0, "", None, None
    db.commit()
    return {"ok": True}


@router.delete("/print/jobs/{jid}", dependencies=[Depends(needs("printing"))])
def dismiss_job(jid: str, ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    j = db.scalar(select(PrintJob).where(PrintJob.id == jid, PrintJob.tenant_id == ctx.tenant_id))
    if j:
        db.delete(j)
        db.commit()
    return {"ok": True}


# ---------- Print hosts: claim + result ----------

def claim(db: Session, tenant_id: str, printers: list[Printer], bridge: bool = False) -> list[dict]:
    """Atomically take up to BATCH jobs for these printers. Concurrent hosts never get the same job (SKIP LOCKED)."""
    if not printers:
        return []
    by_id = {p.id: p for p in printers}
    t = now()
    jobs = db.scalars(
        select(PrintJob).where(
            PrintJob.tenant_id == tenant_id, PrintJob.printer_id.in_(list(by_id)),
            or_(PrintJob.status == "queued", and_(PrintJob.status == "printing", PrintJob.claimed_at < t - STALE)))
        .order_by(PrintJob.created_at).limit(BATCH).with_for_update(skip_locked=True)).all()
    out = []
    for j in jobs:
        if j.attempts >= MAX_ATTEMPTS:
            j.status = "failed"
            j.error = j.error or f"No result from the printer after {MAX_ATTEMPTS} tries"
            continue
        p = by_id[j.printer_id]
        j.status, j.claimed_at, j.attempts = "printing", t, j.attempts + 1
        row = {"id": j.id, "printer_id": p.id, "kind": j.kind, "title": j.title,
               "escpos": base64.b64encode(escpos.render(j.payload or {}, p.width, p.copies)).decode("ascii")}
        if bridge:
            row |= {"printer": p.name, "connection": p.connection, "address": p.address}
        out.append(row)
    # Heartbeat with a plain UPDATE so it doesn't bump the live "print" topic on every poll.
    db.execute(update(Printer).where(Printer.tenant_id == tenant_id, Printer.id.in_(list(by_id))).values(last_seen_at=t)
               .execution_options(synchronize_session=False))
    db.commit()
    return out


class ResultIn(BaseModel):
    ok: bool
    error: str = Field(default="", max_length=1000)


def apply_result(db: Session, tenant_id: str, jid: str, body: ResultIn) -> dict:
    j = db.scalar(select(PrintJob).where(PrintJob.id == jid, PrintJob.tenant_id == tenant_id))
    if not j:
        raise HTTPException(404, "Print job not found")
    p = db.get(Printer, j.printer_id)
    if body.ok:
        j.status, j.printed_at, j.error = "done", now(), ""
        if p and p.last_error:
            p.last_error = ""
    else:
        err = (body.error.strip() or "Print failed")[:300]
        j.error = err
        j.status = "queued" if j.attempts < MAX_ATTEMPTS else "failed"
        if p:
            p.last_error = err
    db.commit()
    return {"ok": True, "status": j.status}


class ClaimIn(BaseModel):
    printer_ids: list[str] = Field(default_factory=list, max_length=20)


@router.post("/print/claim", dependencies=[Depends(needs("printing"))])
def device_claim(body: ClaimIn, ctx: Ctx = Depends(tenant_user), db: Session = Depends(get_db)):
    """A POS device with paired USB / serial printers asks for their jobs (any signed-in role: it may be a chef's KDS)."""
    if not body.printer_ids:
        return []
    ps = db.scalars(select(Printer).where(Printer.tenant_id == ctx.tenant_id, Printer.id.in_(body.printer_ids),
                                          Printer.enabled.is_(True))).all()
    return claim(db, ctx.tenant_id, list(ps))


@router.post("/print/jobs/{jid}/result", dependencies=[Depends(needs("printing"))])
def device_result(jid: str, body: ResultIn, ctx: Ctx = Depends(tenant_user), db: Session = Depends(get_db)):
    return apply_result(db, ctx.tenant_id, jid, body)


# ---------- Print bridge (shop PC, network + Windows printers) ----------

def key_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def bridge_tenant(x_print_key: str = Header(default="", alias="X-Print-Key"), db: Session = Depends(get_db)) -> Tenant:
    key = x_print_key.strip()
    if not key.startswith("tpk_"):
        raise HTTPException(401, "Missing or invalid print key")
    tid = db.scalar(text("SELECT id FROM tenants WHERE print_key_hash = :h AND print_key_hash <> ''"), {"h": key_hash(key)})
    t = db.get(Tenant, tid) if tid else None
    if not t:
        raise HTTPException(401, "This print key is no longer valid. Generate a new one in Settings → Printers.")
    if t.status not in LIVE_STATUSES:
        raise HTTPException(403, f"Restaurant account is {t.status}")
    if not has_module(t, "printing"):
        raise HTTPException(403, "Direct printing isn't turned on for this restaurant")
    return t


@router.get("/print/bridge", dependencies=[Depends(needs("printing"))])
def bridge_status(ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    h = db.scalar(text("SELECT print_key_hash FROM tenants WHERE id = :id"), {"id": ctx.tenant_id})
    seen = db.scalar(select(Printer.last_seen_at).where(Printer.tenant_id == ctx.tenant_id,
                                                        Printer.connection.in_(BRIDGE_CONNECTIONS), Printer.enabled.is_(True))
                     .order_by(Printer.last_seen_at.desc().nulls_last()).limit(1))
    return {"has_key": bool(h), "last_seen_at": seen.isoformat() if seen else None, "online": bool(seen and now() - seen < ONLINE)}


@router.post("/print/bridge/key", dependencies=[Depends(needs("printing"))])
def bridge_key(ctx: Ctx = Depends(require("settings")), db: Session = Depends(get_db)):
    """Create a new print bridge key (replacing any old one). It is shown once; only its hash is stored."""
    key = "tpk_" + secrets.token_urlsafe(24)
    db.execute(text("UPDATE tenants SET print_key_hash = :h WHERE id = :id"), {"h": key_hash(key), "id": ctx.tenant_id})
    db.commit()
    return {"key": key}


@router.post("/print/bridge/claim")
def bridge_claim(t: Tenant = Depends(bridge_tenant), db: Session = Depends(get_db)):
    ps = db.scalars(select(Printer).where(Printer.tenant_id == t.id, Printer.enabled.is_(True),
                                          Printer.connection.in_(BRIDGE_CONNECTIONS))).all()
    return {"restaurant": t.name, "printers": len(ps), "jobs": claim(db, t.id, list(ps), bridge=True)}


@router.post("/print/bridge/jobs/{jid}/result")
def bridge_result(jid: str, body: ResultIn, t: Tenant = Depends(bridge_tenant), db: Session = Depends(get_db)):
    return apply_result(db, t.id, jid, body)
