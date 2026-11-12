import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

# On Vercel each serverless invocation is short-lived; let the provider's pooler (Neon/PgBouncer) pool.
_serverless = bool(os.environ.get("VERCEL"))
engine = create_engine(
    settings.sqlalchemy_url,
    pool_pre_ping=True,
    **({"poolclass": NullPool} if _serverless else {}),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
