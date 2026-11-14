from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import SessionLocal, engine
from .migrate import migrate
from . import live  # noqa: F401  (registers the change-tracking listener)
from .routers import (admin, auth, backoffice, cash, guest, inventory, leads, locations, menu_import, pos, pricelists, printing,
                      reports, reservations, taxrates, timeclock, customers, offers, payables)
from .seed import bootstrap


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
          pricelists.router, taxrates.router, customers.router, offers.router, payables.router):
    app.include_router(r)


@app.get("/health")
def health():
    return {"ok": True}
