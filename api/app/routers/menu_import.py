"""Bulk menu import: CSV upload or OCR of menu photos/PDFs. Both return a preview; /commit writes it."""
import base64
import csv
import io
import os
import re
from decimal import Decimal, InvalidOperation

import anthropic
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Ctx, needs, require
from ..models import MenuCategory, MenuItem

router = APIRouter(prefix="/menu/import", tags=["menu-import"])

MAX_BYTES = 10 * 1024 * 1024
OCR_MODEL = "claude-opus-5-5"
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
STATIONS = ["Curry", "Tandoor", "Fry", "Cold", "Bar", "Kitchen"]


class Row(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    price: float = Field(ge=0, le=1_000_000)
    category: str = Field(default="Uncategorised", max_length=80)
    is_veg: bool = True
    station: str = Field(default="Kitchen", max_length=40)
    available: bool = True


class Preview(BaseModel):
    rows: list[Row]
    warnings: list[str] = []


# ---------------- CSV ----------------

HEADER_ALIASES = {
    "name": {"name", "item", "item name", "dish", "dish name", "product", "title"},
    "price": {"price", "rate", "mrp", "amount", "cost", "selling price", "price (inr)", "price (usd)"},
    "category": {"category", "section", "group", "menu section", "course", "type of dish"},
    "is_veg": {"veg", "is_veg", "veg/non-veg", "veg / non-veg", "food type", "diet", "type", "vegetarian"},
    "station": {"station", "kitchen station", "kot station", "printer"},
    "available": {"available", "in stock", "active", "status"},
}
TRUE = {"1", "true", "yes", "y", "veg", "vegetarian", "v", "available", "active", "in stock"}
FALSE = {"0", "false", "no", "n", "non-veg", "nonveg", "non veg", "non-vegetarian", "nv", "egg", "out of stock", "inactive", "86"}


def parse_price(raw: str) -> float | None:
    cleaned = re.sub(r"[^\d.]", "", (raw or "").replace(",", ""))
    try:
        return float(Decimal(cleaned)) if cleaned else None
    except InvalidOperation:
        return None


def parse_bool(raw: str, default: bool) -> bool:
    v = (raw or "").strip().lower()
    if v in TRUE:
        return True
    if v in FALSE:
        return False
    return default


def csv_template() -> str:
    return (
        "name,price,category,veg,station,available\n"
        "Paneer Tikka,279,Starters,veg,Tandoor,yes\n"
        "Chicken 65,289,Starters,non-veg,Fry,yes\n"
        "Butter Naan,59,Breads,veg,Tandoor,yes\n"
    )


@router.get("/template.csv", response_class=PlainTextResponse)
def template():
    return PlainTextResponse(csv_template(), headers={"Content-Disposition": 'attachment; filename="tiffin-menu-template.csv"'})


async def read_upload(f: UploadFile) -> bytes:
    data = await f.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"{f.filename} is larger than 10 MB")
    return data


@router.post("/csv", response_model=Preview)
async def import_csv(file: UploadFile = File(...), _: Ctx = Depends(require("menu_edit"))):
    raw = await read_upload(file)
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows_in = [r for r in reader if any(c.strip() for c in r)]
    if len(rows_in) < 2:
        raise HTTPException(422, "The CSV needs a header row and at least one item")

    header = [h.strip().lower() for h in rows_in[0]]
    col: dict[str, int] = {}
    for key, aliases in HEADER_ALIASES.items():
        for i, h in enumerate(header):
            if h in aliases and key not in col:
                col[key] = i
    if "name" not in col or "price" not in col:
        raise HTTPException(422, "Couldn't find 'name' and 'price' columns. Download the template to see the expected format.")

    def cell(r: list[str], key: str) -> str:
        i = col.get(key)
        return r[i].strip() if i is not None and i < len(r) else ""

    out, warnings = [], []
    for n, r in enumerate(rows_in[1:], start=2):
        name, price = cell(r, "name"), parse_price(cell(r, "price"))
        if not name:
            continue
        if price is None:
            warnings.append(f"Row {n}: '{name}' has no valid price, so it's set to 0")
            price = 0.0
        station = cell(r, "station").title()
        out.append(Row(
            name=name[:160], price=price, category=(cell(r, "category") or "Uncategorised")[:80],
            is_veg=parse_bool(cell(r, "is_veg"), True),
            station=station if station in STATIONS else "Kitchen",
            available=parse_bool(cell(r, "available"), True),
        ))
    if not out:
        raise HTTPException(422, "No items found in the CSV")
    return Preview(rows=out, warnings=warnings)


# ---------------- OCR (Claude vision) ----------------

class OcrItem(BaseModel):
    name: str
    price: float | None
    category: str
    is_veg: bool | None
    station: str


class OcrResult(BaseModel):
    items: list[OcrItem]
    notes: list[str]


OCR_PROMPT = """You are digitising a restaurant's printed menu for its point-of-sale system.
Read every dish in the attached menu page(s) and return one entry per orderable item.

- name: the dish name as printed, in title case, without the price or description.
- price: the number only, in {currency} (no symbol). If a dish has several sizes or portions
  (e.g. Half/Full, Small/Large), create one entry per size and put the size in the name, like "Chicken Biryani (Full)".
  If no price is printed, use null.
- category: the menu section heading the dish appears under (e.g. Starters, Mains, Breads, Beverages, Desserts).
  If there's no heading, infer a sensible one.
- is_veg: true for vegetarian, false for non-veg (meat, fish, egg). Use the green/red dot symbol if printed,
  otherwise judge from the dish. Use null only if you can't tell.
- station: the kitchen station that likely cooks it, one of: {stations}.

Skip headings, taglines, taxes and service-charge lines, and combo descriptions that aren't separate items.
In notes, briefly list anything you couldn't read clearly (keep it short; an empty list is fine)."""


def ocr_client() -> anthropic.Anthropic:
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise HTTPException(503, "Menu scanning isn't configured on this server yet (missing ANTHROPIC_API_KEY)")
    return anthropic.Anthropic(timeout=240.0)


@router.post("/ocr", response_model=Preview, dependencies=[Depends(needs("menu_scan"))])
async def import_ocr(files: list[UploadFile] = File(...), ctx: Ctx = Depends(require("menu_edit"))):
    if not files or len(files) > 8:
        raise HTTPException(422, "Upload between 1 and 8 menu photos or PDFs")
    content: list[dict] = []
    for f in files:
        data = await read_upload(f)
        mime = (f.content_type or "").lower()
        b64 = base64.standard_b64encode(data).decode("utf-8")
        if mime == "application/pdf":
            content.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}})
        elif mime in IMAGE_TYPES:
            content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}})
        else:
            raise HTTPException(415, f"{f.filename}: upload JPG, PNG, WEBP or PDF files")
    content.append({"type": "text", "text": OCR_PROMPT.format(currency=ctx.tenant.currency, stations=", ".join(STATIONS))})

    client = ocr_client()
    try:
        response = client.beta.messages.parse(
            model=OCR_MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": content}],
            output_format=OcrResult,
        )
    except anthropic.RateLimitError:
        raise HTTPException(429, "Menu scanning is busy right now. Try again in a minute.")
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"Couldn't read the menu ({e.status_code}). Try a clearer photo.")
    except anthropic.APIConnectionError:
        raise HTTPException(502, "Couldn't reach the menu-reading service. Try again.")

    if response.stop_reason == "refusal" or response.parsed_output is None:
        raise HTTPException(422, "Couldn't read a menu from these files. Try a clearer, well-lit photo.")
    if response.stop_reason == "max_tokens":
        warnings = ["This menu is very long, so only part of it was read. Upload fewer pages at a time."]
    else:
        warnings = []

    result: OcrResult = response.parsed_output
    rows = []
    for it in result.items:
        name = it.name.strip()[:160]
        if not name:
            continue
        if it.price is None:
            warnings.append(f"No price found for '{name}', so it's set to 0")
        rows.append(Row(
            name=name, price=max(0.0, it.price or 0.0), category=(it.category.strip() or "Uncategorised")[:80],
            is_veg=True if it.is_veg is None else it.is_veg,
            station=it.station if it.station in STATIONS else "Kitchen",
        ))
    if not rows:
        raise HTTPException(422, "No dishes found. Try a clearer photo of the menu.")
    return Preview(rows=rows, warnings=warnings + result.notes[:10])


# ---------------- Commit ----------------

class CommitIn(BaseModel):
    rows: list[Row] = Field(min_length=1, max_length=2000)
    # "merge": update price/details of items with the same name in the same category, add the rest
    # "append": always add new items
    mode: str = Field(default="merge", pattern=r"^(merge|append)$")


@router.post("/commit")
def commit(body: CommitIn, ctx: Ctx = Depends(require("menu_edit")), db: Session = Depends(get_db)):
    cats = {c.name.lower(): c for c in db.scalars(select(MenuCategory).where(MenuCategory.tenant_id == ctx.tenant_id))}
    next_sort = len(cats)
    existing = {
        (m.category_id, m.name.lower()): m
        for m in db.scalars(select(MenuItem).where(MenuItem.tenant_id == ctx.tenant_id))
    }
    item_sort = (db.scalar(select(func.max(MenuItem.sort)).where(MenuItem.tenant_id == ctx.tenant_id)) or 0) + 1
    created = updated = new_cats = 0
    for r in body.rows:
        key = r.category.strip().lower() or "uncategorised"
        cat = cats.get(key)
        if not cat:
            cat = MenuCategory(tenant_id=ctx.tenant_id, name=r.category.strip() or "Uncategorised", sort=next_sort)
            db.add(cat)
            db.flush()
            cats[key] = cat
            next_sort += 1
            new_cats += 1
        price = Decimal(str(r.price)).quantize(Decimal("0.01"))
        match = existing.get((cat.id, r.name.strip().lower())) if body.mode == "merge" else None
        if match:
            match.price, match.is_veg, match.station, match.available = price, r.is_veg, r.station, r.available
            updated += 1
        else:
            m = MenuItem(tenant_id=ctx.tenant_id, category_id=cat.id, name=r.name.strip(), price=price,
                         is_veg=r.is_veg, station=r.station, available=r.available, sort=item_sort)
            db.add(m)
            existing[(cat.id, m.name.lower())] = m
            item_sort += 1
            created += 1
    db.commit()
    return {"created": created, "updated": updated, "categories_created": new_cats}
