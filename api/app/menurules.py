"""When and where a dish can be sold: category serving hours (breakfast 7-11, weekday lunch...) and the sales
channels an item is offered on (dine-in, takeaway, delivery, online apps, table QR).

Kept free of router imports so pos.py, guest.py and backoffice.py can all use it.
"""
from datetime import datetime, time
from zoneinfo import ZoneInfo

from fastapi import HTTPException

# Sales channels an item can be limited to. An empty list on the item means "everywhere".
CHANNELS = ("dine_in", "takeaway", "delivery", "online", "qr")
CHANNEL_LABEL = {"dine_in": "dine-in", "takeaway": "takeaway", "delivery": "delivery", "online": "delivery apps", "qr": "table QR"}
DAY_LABEL = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
ONLINE = {"swiggy", "zomato", "doordash", "ubereats", "website"}


def channel_of(order_channel: str, source: str = "") -> str:
    """Map an order's channel (and who placed the line) onto the menu channel it sells through."""
    if source == "guest":
        return "qr"
    if order_channel in ONLINE:
        return "online"
    return order_channel if order_channel in CHANNELS else "dine_in"


def parse_hhmm(v: str) -> time:
    h, m = v.split(":")
    return time(int(h), int(m))


def clean_schedule(s: dict | None) -> dict:
    """Validate {"days": [0..6], "from": "HH:MM", "to": "HH:MM"}. Empty dict = always served."""
    if not s:
        return {}
    days = sorted({int(d) for d in s.get("days") or []})
    if any(d < 0 or d > 6 for d in days):
        raise HTTPException(422, "Days run from 0 (Monday) to 6 (Sunday)")
    start, end = (s.get("from") or "").strip(), (s.get("to") or "").strip()
    if bool(start) != bool(end):
        raise HTTPException(422, "Give both a start and an end time")
    try:
        if start:
            parse_hhmm(start), parse_hhmm(end)
    except Exception:
        raise HTTPException(422, "Times look like 07:30")
    if start and start == end:
        raise HTTPException(422, "Start and end time can't be the same")
    out: dict = {}
    if days and len(days) < 7:
        out["days"] = days
    if start:
        out["from"], out["to"] = start, end
    return out


def open_now(schedule: dict | None, tz: ZoneInfo, at: datetime | None = None) -> bool:
    if not schedule:
        return True
    local = (at or datetime.now(tz)).astimezone(tz)
    day, t = local.weekday(), local.time()
    if "from" in schedule:
        start, end = parse_hhmm(schedule["from"]), parse_hhmm(schedule["to"])
        if start < end:
            inside = start <= t < end
        else:  # runs past midnight (e.g. 22:00-02:00): the early hours belong to the previous day's service
            inside = t >= start or t < end
            if t < end:
                day = (day - 1) % 7
        if not inside:
            return False
    return not schedule.get("days") or day in schedule["days"]


def schedule_label(schedule: dict | None) -> str:
    """'Mon-Fri · 07:00-11:00' style summary ('' = always)."""
    if not schedule:
        return ""
    parts = []
    days = schedule.get("days")
    if days:
        runs, start = [], days[0]
        for a, b in zip(days, days[1:] + [None]):
            if b != a + 1:
                runs.append(DAY_LABEL[start] if start == a else f"{DAY_LABEL[start]}-{DAY_LABEL[a]}")
                start = b
        parts.append(", ".join(runs))
    if "from" in schedule:
        parts.append(f"{schedule['from']}-{schedule['to']}")
    return " · ".join(parts)


def check_sellable(item_name: str, item_channels: list | None, category_name: str, schedule: dict | None,
                   channel: str, tz: ZoneInfo) -> None:
    """Raise 409 when the item can't be sold right now on this channel."""
    if item_channels and channel not in item_channels:
        raise HTTPException(409, f"{item_name} isn't offered on {CHANNEL_LABEL.get(channel, channel)}")
    if not open_now(schedule, tz):
        raise HTTPException(409, f"{category_name} is served {schedule_label(schedule)}")
