"""Cash drawer: open with a float, record paid-ins / paid-outs, close with a count (over / short)."""
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..db import get_db
from ..deps import Ctx, require
from ..models import CashMovement, CashSession, Payment, User, now
from ..live import audit
from .pos import money, q

router = APIRouter(tags=["cash"])


def payments_between(db: Session, ctx: Ctx, start: datetime, end: datetime | None) -> list[Payment]:
    stmt = select(Payment).where(Payment.tenant_id == ctx.tenant_id, Payment.created_at >= start)
    if end:
        stmt = stmt.where(Payment.created_at < end)
    return list(db.scalars(stmt).all())


def summarize(db: Session, ctx: Ctx, s: CashSession) -> dict:
    pays = payments_between(db, ctx, s.opened_at, s.closed_at)
    by_method: dict[str, dict] = {}
    for p in pays:
        row = by_method.setdefault(p.method, {"sales": 0.0, "tips": 0.0, "refunds": 0.0, "count": 0})
        if p.kind == "payment":
            row["sales"] += money(p.amount)
            row["tips"] += money(p.tip)
            row["count"] += 1
        else:
            row["refunds"] += money(p.amount)
    cash = by_method.get("cash", {"sales": 0, "tips": 0, "refunds": 0})
    paid_in = sum((m.amount for m in s.movements if m.kind == "in"), Decimal(0))
    paid_out = sum((m.amount for m in s.movements if m.kind == "out"), Decimal(0))
    expected = (Decimal(s.opening_float) + Decimal(str(cash["sales"])) + Decimal(str(cash["tips"]))
                - Decimal(str(cash["refunds"])) + paid_in - paid_out)
    names = {u.id: u.name for u in db.scalars(select(User).where(User.tenant_id == ctx.tenant_id))}
    closed = s.closed_at is not None
    return {
        "id": s.id, "opened_at": s.opened_at.isoformat(), "opened_by": names.get(s.opened_by, ""),
        "closed_at": s.closed_at.isoformat() if closed else None, "closed_by": names.get(s.closed_by, ""),
        "opening_float": money(s.opening_float), "paid_in": money(paid_in), "paid_out": money(paid_out),
        "cash_sales": money(cash["sales"]), "cash_tips": money(cash["tips"]), "cash_refunds": money(cash["refunds"]),
        "expected_cash": money(s.expected_cash if closed else expected),
        "counted_cash": money(s.counted_cash) if closed else None,
        "difference": money(Decimal(s.counted_cash) - Decimal(s.expected_cash)) if closed else None,
        "note": s.note,
        "by_method": {k: {kk: round(vv, 2) if isinstance(vv, float) else vv for kk, vv in v.items()} for k, v in by_method.items()},
        "movements": [{"id": m.id, "kind": m.kind, "amount": money(m.amount), "reason": m.reason,
                       "by": names.get(m.user_id, ""), "created_at": m.created_at.isoformat()} for m in s.movements],
    }


def current(db: Session, ctx: Ctx) -> CashSession | None:
    return db.scalar(select(CashSession).where(CashSession.tenant_id == ctx.tenant_id, CashSession.closed_at.is_(None))
                     .options(selectinload(CashSession.movements)).order_by(CashSession.opened_at.desc()))


@router.get("/cash")
def drawer(ctx: Ctx = Depends(require("cash")), db: Session = Depends(get_db)):
    s = current(db, ctx)
    recent = db.scalars(select(CashSession).where(CashSession.tenant_id == ctx.tenant_id, CashSession.closed_at.is_not(None))
                        .options(selectinload(CashSession.movements)).order_by(CashSession.closed_at.desc()).limit(10)).all()
    return {"session": summarize(db, ctx, s) if s else None, "recent": [summarize(db, ctx, r) for r in recent]}


class OpenIn(BaseModel):
    opening_float: float = Field(ge=0, le=10_000_000)


@router.post("/cash/open")
def open_drawer(body: OpenIn, ctx: Ctx = Depends(require("cash")), db: Session = Depends(get_db)):
    if current(db, ctx):
        raise HTTPException(409, "The drawer is already open")
    db.add(CashSession(tenant_id=ctx.tenant_id, opened_by=ctx.user.id, opening_float=q(Decimal(str(body.opening_float)))))
    db.commit()
    return drawer(ctx, db)


class MoveIn(BaseModel):
    kind: str = Field(pattern=r"^(in|out)$")
    amount: float = Field(gt=0, le=10_000_000)
    reason: str = Field(min_length=2, max_length=200)


@router.post("/cash/movements")
def movement(body: MoveIn, ctx: Ctx = Depends(require("cash")), db: Session = Depends(get_db)):
    s = current(db, ctx)
    if not s:
        raise HTTPException(409, "Open the drawer first")
    s.movements.append(CashMovement(tenant_id=ctx.tenant_id, kind=body.kind, amount=q(Decimal(str(body.amount))),
                                    reason=body.reason.strip(), user_id=ctx.user.id))
    audit(db, ctx, f"cash_{body.kind}", amount=body.amount, detail=body.reason.strip())
    db.commit()
    return drawer(ctx, db)


class CloseIn(BaseModel):
    counted_cash: float = Field(ge=0, le=10_000_000)
    note: str = Field(default="", max_length=1000)


@router.post("/cash/close")
def close_drawer(body: CloseIn, ctx: Ctx = Depends(require("cash")), db: Session = Depends(get_db)):
    s = current(db, ctx)
    if not s:
        raise HTTPException(409, "The drawer isn't open")
    expected = Decimal(str(summarize(db, ctx, s)["expected_cash"]))
    s.expected_cash, s.counted_cash = expected, q(Decimal(str(body.counted_cash)))
    s.closed_at, s.closed_by, s.note = now(), ctx.user.id, body.note.strip()
    diff = s.counted_cash - s.expected_cash
    audit(db, ctx, "drawer_closed", amount=diff,
          detail=f"Expected {money(expected):.2f}, counted {money(s.counted_cash):.2f}" + (f" · {s.note}" if s.note else ""))
    db.commit()
    return {"closed": summarize(db, ctx, s), **drawer(ctx, db)}
