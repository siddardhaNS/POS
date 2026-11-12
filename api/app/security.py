from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings


def hash_secret(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt()).decode()


def verify_secret(raw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user_id: str, tenant_id: str | None, role: str) -> str:
    payload = {
        "sub": user_id,
        "tid": tenant_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_ttl_hours),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
