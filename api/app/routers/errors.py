"""Errors: browsers and apps report crashes here, and the platform admin reviews them per restaurant."""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import errorlog
from ..db import get_db
from ..deps import Ctx, platform_admin
from ..models import ErrorLog, Tenant, now

router = APIRouter(tags=["errors"])
_recent: dict[str, list] = {}


class ClientErrorIn(BaseModel):
    source: str = Field(default="web", pattern=r"^(web|mobile|desktop)$")
    message: str = Field(min_length=1, max_length=500)
    stack: str = Field(default="", max_length=20000)
    path: str = Field(default="", max_length=300)  # the screen / page it happened on


@router.post("/client-errors", status_code=204)
def client_error(body: ClientErrorIn, request: Request):
    """A crash in the web app, phone app or counter app. Works signed in or not; a light per-address limit keeps a
    crash loop from flooding the log."""
    ip = request.client.host if request.client else "?"
    t = now()
    hits = [x for x in _recent.get(ip, []) if t - x < timedelta(minutes=1)]
    if len(hits) >= 20:
        return None
    _recent[ip] = hits + [t]
    tid, uid = errorlog.who(request.headers.get("authorization"))
    errorlog.record(source=body.source, message=body.message, detail=body.stack, path=body.path, status=0,
                    tenant_id=tid, user_id=uid, user_agent=request.headers.get("user-agent", ""))
    return None


def error_out(e: ErrorLog, names: dict[str, str]) -> dict:
    return {"id": e.id, "tenant_id": e.tenant_id, "restaurant": names.get(e.tenant_id or "", "Not signed in"),
            "source": e.source, "message": e.message, "detail": e.detail, "method": e.method, "path": e.path,
            "status": e.status, "user": e.user_name, "user_agent": e.user_agent, "count": e.count, "resolved": e.resolved,
            "first_seen": e.first_seen.isoformat(), "last_seen": e.last_seen.isoformat()}


def names_of(db: Session) -> dict[str, str]:
    return {t.id: (t.name + (f" · {t.location_name}" if t.location_name else ""))
            for t in db.scalars(select(Tenant))}


@router.get("/admin/errors")
def list_errors(tenant_id: str = "", source: str = "", resolved: bool = False, _: Ctx = Depends(platform_admin),
                db: Session = Depends(get_db)):
    stmt = select(ErrorLog).where(ErrorLog.resolved.is_(resolved))
    if tenant_id == "none":
        stmt = stmt.where(ErrorLog.tenant_id.is_(None))
    elif tenant_id:
        stmt = stmt.where(ErrorLog.tenant_id == tenant_id)
    if source:
        stmt = stmt.where(ErrorLog.source == source)
    rows = db.scalars(stmt.order_by(ErrorLog.last_seen.desc()).limit(300)).all()
    names = names_of(db)
    since = now() - timedelta(days=7)
    per = db.execute(select(ErrorLog.tenant_id, func.count(ErrorLog.id), func.coalesce(func.sum(ErrorLog.count), 0))
                     .where(ErrorLog.resolved.is_(False), ErrorLog.last_seen >= since).group_by(ErrorLog.tenant_id)).all()
    return {"errors": [error_out(e, names) for e in rows],
            "by_restaurant": sorted([{"tenant_id": tid or "none", "restaurant": names.get(tid or "", "Not signed in"),
                                      "open": n, "events": int(c)} for tid, n, c in per], key=lambda r: -r["events"])}


class ResolveIn(BaseModel):
    resolved: bool = True


@router.patch("/admin/errors/{eid}")
def resolve(eid: str, body: ResolveIn, _: Ctx = Depends(platform_admin), db: Session = Depends(get_db)):
    e = db.get(ErrorLog, eid)
    if not e:
        raise HTTPException(404, "Error not found")
    e.resolved = body.resolved
    db.commit()
    return error_out(e, names_of(db))
