"""Record errors per restaurant for the admin console. Writes in its own session so a failed request's rollback
can't take the log with it, and never raises: logging must not become a second error."""
import hashlib
import logging
import re

from sqlalchemy import select

from .db import SessionLocal
from .models import ErrorLog, Tenant, User, now
from .security import decode_token

log = logging.getLogger("tiffin.errors")
IDS = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b\d+\b")


def who(auth_header: str | None) -> tuple[str | None, str | None]:
    """(tenant_id, user_id) from a bearer token, if it's valid."""
    if not auth_header or not auth_header.lower().startswith("bearer "):
        return None, None
    try:
        data = decode_token(auth_header.split(" ", 1)[1])
        return data.get("tid"), data.get("sub")
    except Exception:
        return None, None


def record(*, source: str, message: str, detail: str = "", method: str = "", path: str = "", status: int = 500,
           tenant_id: str | None = None, user_id: str | None = None, user_agent: str = "") -> None:
    try:
        # Group by where it happened, not by the ids in it: /orders/<id>/pay failing for 50 checks is one problem.
        place = IDS.sub(":id", path or "")
        first_line = IDS.sub(":n", (message or "").splitlines()[0] if message else "")[:200]
        fp = hashlib.sha256(f"{source}|{method}|{place}|{first_line}".encode()).hexdigest()
        with SessionLocal() as db:
            if tenant_id and not db.get(Tenant, tenant_id):
                tenant_id = None
            name = ""
            if user_id:
                u = db.get(User, user_id)
                name = u.name if u else ""
            row = db.scalar(select(ErrorLog).where(ErrorLog.fingerprint == fp, ErrorLog.tenant_id.is_(tenant_id)
                                                   if tenant_id is None else ErrorLog.tenant_id == tenant_id,
                                                   ErrorLog.resolved.is_(False)))
            if row:
                row.count += 1
                row.last_seen = now()
                row.message, row.detail = message[:500], detail[:20000]
                row.user_name = name or row.user_name
            else:
                db.add(ErrorLog(tenant_id=tenant_id, source=source, fingerprint=fp, message=message[:500], detail=detail[:20000],
                                method=method[:10], path=path[:300], status=status, user_name=name, user_agent=user_agent[:300]))
            db.commit()
    except Exception:  # pragma: no cover - last resort
        log.exception("could not record an error")
