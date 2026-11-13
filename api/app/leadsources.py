"""Find restaurants to approach: OpenStreetMap (Nominatim + Overpass, free) and Google Places API (New, needs a key).

Both return the same candidate shape; candidates found in both sources (same name within ~120 m) are merged.
Google is only used through the official Places API, never by scraping Google Maps.
"""
import math
import os
import re
import unicodedata

import httpx
from fastapi import HTTPException

UA = {"User-Agent": "TiffinPOS-LeadFinder/1.0"}  # Nominatim / Overpass ask for an identifying client name
NOMINATIM = "https://nominatim.openstreetmap.org/search"
# Public Overpass servers are free but often busy: a 1-2 km search can take 30-40 s, so allow up to a minute.
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter")
OVERPASS_TIMEOUT = httpx.Timeout(60, connect=8)
GOOGLE = "https://places.googleapis.com/v1/places:searchText"
GOOGLE_FIELDS = ",".join([
    "places.id", "places.displayName", "places.formattedAddress", "places.shortFormattedAddress", "places.location",
    "places.nationalPhoneNumber", "places.internationalPhoneNumber", "places.websiteUri", "places.rating",
    "places.userRatingCount", "places.primaryType", "places.primaryTypeDisplayName", "places.businessStatus",
    "places.addressComponents", "nextPageToken",
])

# category -> (OSM amenity/shop values, Google included type, plural label for the Google text query)
CATEGORIES: dict[str, tuple[tuple[str, ...], str, str]] = {
    "restaurant": (("restaurant", "food_court"), "restaurant", "restaurants"),
    "cafe": (("cafe", "ice_cream"), "cafe", "cafes"),
    "fast_food": (("fast_food",), "fast_food_restaurant", "fast food restaurants"),
    "bar": (("bar", "pub", "biergarten"), "bar", "bars and pubs"),
    "bakery": (("bakery",), "bakery", "bakeries"),
}


def google_enabled() -> bool:
    return bool(os.environ.get("GOOGLE_PLACES_API_KEY"))


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(the|restaurant|restaurants|cafe|café|bar|kitchen|and|&)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def meters(a_lat, a_lon, b_lat, b_lon) -> float:
    if None in (a_lat, a_lon, b_lat, b_lon):
        return float("inf")
    r = 6371000
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def candidate(**kw) -> dict:
    base = {"osm_id": None, "google_place_id": None, "name": "", "category": "", "cuisine": "", "address": "", "area": "",
            "city": "", "postcode": "", "lat": None, "lon": None, "phone": "", "website": "", "email": "", "rating": None,
            "reviews": None, "opening_hours": "", "business_status": "", "sources": []}
    base.update(kw)
    return base


# ---------- OpenStreetMap ----------

def geocode(client: httpx.Client, area: str) -> dict:
    r = client.get(NOMINATIM, params={"q": area, "format": "jsonv2", "limit": 1, "addressdetails": 1}, headers=UA)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise HTTPException(404, f"Couldn't find “{area}”. Try a neighbourhood and city, e.g. Indiranagar, Bengaluru")
    g = rows[0]
    addr = g.get("address") or {}
    return {"lat": float(g["lat"]), "lon": float(g["lon"]), "label": g.get("display_name", area),
            "city": addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or ""}


def osm_search(client: httpx.Client, lat: float, lon: float, radius_m: int, categories: list[str], limit: int) -> list[dict]:
    amenities = sorted({a for c in categories for a in CATEGORIES[c][0] if a != "bakery"})
    parts = []
    if amenities:
        parts.append(f'nwr["amenity"~"^({"|".join(amenities)})$"]["name"](around:{radius_m},{lat},{lon});')
    if "bakery" in categories:
        parts.append(f'nwr["shop"="bakery"]["name"](around:{radius_m},{lat},{lon});')
    query = f"[out:json][timeout:55];({''.join(parts)});out center tags {limit};"
    data, last = None, None
    for url in OVERPASS:
        try:
            r = client.post(url, data={"data": query}, headers=UA, timeout=OVERPASS_TIMEOUT)
            r.raise_for_status()
            data = r.json()
            break
        except (httpx.HTTPError, ValueError) as e:  # busy mirror: try the next one
            last = e
    if data is None:
        raise HTTPException(502, f"OpenStreetMap search is busy right now, try again in a minute ({type(last).__name__})")
    out = []
    for el in data.get("elements", []):
        t = el.get("tags") or {}
        name = (t.get("name") or "").strip()
        if not name:
            continue
        c = el.get("center") or el
        street = " ".join(x for x in (t.get("addr:housenumber", ""), t.get("addr:street", "")) if x)
        area = t.get("addr:suburb") or t.get("addr:neighbourhood") or t.get("addr:district") or ""
        city = t.get("addr:city", "")
        out.append(candidate(
            osm_id=f"{el['type']}/{el['id']}", name=name, category=t.get("amenity") or t.get("shop") or "",
            cuisine=(t.get("cuisine") or "").replace(";", ", ").replace("_", " "),
            address=", ".join(x for x in (street, area, city, t.get("addr:postcode", "")) if x), area=area, city=city,
            postcode=t.get("addr:postcode", ""), lat=c.get("lat"), lon=c.get("lon"),
            phone=t.get("phone") or t.get("contact:phone") or "", website=t.get("website") or t.get("contact:website") or "",
            email=t.get("email") or t.get("contact:email") or "", opening_hours=t.get("opening_hours", ""), sources=["osm"]))
    return out


# ---------- Google Places (official API) ----------

def google_search(client: httpx.Client, area: str, lat: float, lon: float, radius_m: int, categories: list[str],
                  pages: int = 2) -> list[dict]:
    key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not key:
        raise HTTPException(503, "Google search isn't set up on this server yet (missing GOOGLE_PLACES_API_KEY)")
    headers = {"X-Goog-Api-Key": key, "X-Goog-FieldMask": GOOGLE_FIELDS, "Content-Type": "application/json"}
    out: dict[str, dict] = {}
    for cat in categories:
        _, gtype, label = CATEGORIES[cat]
        body: dict = {"textQuery": f"{label} in {area}", "pageSize": 20, "includedType": gtype, "strictTypeFiltering": False,
                      "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": float(min(radius_m, 50000))}}}
        for _ in range(pages):
            r = client.post(GOOGLE, json=body, headers=headers)
            if r.status_code >= 400:
                msg = (r.json().get("error", {}) if r.headers.get("content-type", "").startswith("application/json") else {}).get("message")
                raise HTTPException(502, f"Google Places refused the search: {msg or r.status_code}")
            data = r.json()
            for p in data.get("places", []):
                comps = {t: c.get("longText", "") for c in p.get("addressComponents", []) for t in c.get("types", [])}
                loc = p.get("location") or {}
                out[p["id"]] = candidate(
                    google_place_id=p["id"], name=(p.get("displayName") or {}).get("text", ""),
                    category=(p.get("primaryTypeDisplayName") or {}).get("text", "") or p.get("primaryType", ""),
                    address=p.get("formattedAddress", ""),
                    area=comps.get("sublocality_level_1") or comps.get("sublocality") or comps.get("neighborhood", ""),
                    city=comps.get("locality", ""), postcode=comps.get("postal_code", ""),
                    lat=loc.get("latitude"), lon=loc.get("longitude"),
                    phone=p.get("internationalPhoneNumber") or p.get("nationalPhoneNumber") or "",
                    website=p.get("websiteUri", ""), rating=p.get("rating"), reviews=p.get("userRatingCount"),
                    business_status=p.get("businessStatus", ""), sources=["google"])
            token = data.get("nextPageToken")
            if not token:
                break
            body = {**body, "pageToken": token}
    # Within the radius only (locationBias is a preference, not a fence), and still trading.
    return [c for c in out.values() if meters(lat, lon, c["lat"], c["lon"]) <= radius_m * 1.2
            and c["business_status"] not in ("CLOSED_PERMANENTLY",)]


# ---------- Merge ----------

def merge(rows: list[dict]) -> list[dict]:
    """Merge the same place found in several sources (same normalised name within ~120 m); fill empty fields."""
    merged: list[dict] = []
    for r in rows:
        key = norm(r["name"])
        hit = next((m for m in merged if key and norm(m["name"]) == key and meters(m["lat"], m["lon"], r["lat"], r["lon"]) < 120), None)
        if not hit:
            merged.append(dict(r))
            continue
        for k, v in r.items():
            if k == "sources":
                hit["sources"] = sorted(set(hit["sources"]) | set(v))
            elif v not in (None, "", []) and hit.get(k) in (None, "", []):
                hit[k] = v
    return merged
