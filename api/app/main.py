from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import Base, SessionLocal, engine
from .routers import admin, auth, backoffice, pos
from .seed import bootstrap


def init_db() -> None:
    Base.metadata.create_all(engine)
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

for r in (auth.router, admin.router, pos.router, backoffice.router):
    app.include_router(r)


@app.get("/health")
def health():
    return {"ok": True}
