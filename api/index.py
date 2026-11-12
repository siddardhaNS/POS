# Vercel serverless entrypoint: exposes the FastAPI ASGI app.
# Serverless runtimes don't reliably fire ASGI lifespan events, so initialise on cold start.
from app.main import app, init_db  # noqa: F401

init_db()
