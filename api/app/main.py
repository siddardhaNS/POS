from contextlib import asynccontextmanager

import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import SessionLocal, engine
from .migrate import migrate
from . import live  # noqa: F401  (registers the change-tracking listener)
from .routers import (admin, auth, backoffice, cash, guest, inventory, leads, locations, menu_import, pos, pricelists, printing,
                      reports, reservations, taxrates, timeclock, customers, offers, payables, transfers, events, kiosk, errors, counter)
from .seed import bootstrap
from . import errorlog


def init_db() -> None:
    migrate(engine)
    with SessionLocal() as db:
        bootstrap(db)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Tiffin POS API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, admin.router, pos.router, cash.router, menu_import.router, backoffice.router, printing.router,
          reports.router, inventory.router, leads.router, timeclock.router, locations.router, guest.router, reservations.router,
          pricelists.router, taxrates.router, customers.router, offers.router, payables.router, transfers.router,
          events.router, kiosk.router, errors.router, counter.router):
    app.include_router(r)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    """Anything that wasn't an expected HTTP error: log it for the restaurant it happened to, answer with a plain 500."""
    tid, uid = errorlog.who(request.headers.get("authorization"))
    errorlog.record(source="api", message=f"{type(exc).__name__}: {exc}",
                    detail="".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
                    method=request.method, path=request.url.path, tenant_id=tid, user_id=uid,
                    user_agent=request.headers.get("user-agent", ""))
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. It has been logged."})


@app.get("/health")
def health():
    return {"ok": True}
