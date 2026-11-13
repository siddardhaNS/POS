"""Course phases (drinks -> starters -> mains -> desserts) for the service timeline and clear-time estimates.

Each menu category has a phase. When the restaurant hasn't picked one, it's guessed from the category name, so
imported and older menus work without setup.
"""
import re
from statistics import median

PHASES = ("drinks", "starters", "mains", "sides", "desserts")
LABEL = {"drinks": "Drinks", "starters": "Starters", "mains": "Mains", "sides": "Sides", "desserts": "Desserts"}
RANK = {"drinks": 0, "starters": 1, "mains": 2, "sides": 2, "desserts": 3}
# Typical minutes from a phase's first fire until the check closes, used until a restaurant has its own history.
DEFAULT_CLEAR_MIN = {"drinks": 75, "starters": 55, "mains": 32, "sides": 32, "desserts": 14}
MIN_SAMPLES = 5

RULES: list[tuple[str, str]] = [
    ("desserts", r"dessert|sweet|cake|ice ?cream|kulfi|pastr|pudding|mithai|gelato|waffle"),
    ("drinks", r"drink|beverage|bar|juice|shake|lassi|mocktail|cocktail|coffee|tea\b|chai|soda|wine|beer|spirit|smoothie"),
    ("starters", r"starter|appeti[sz]er|small plate|snack|soup|salad|chaat|tandoor|kebab|tikka|tapas|share|mezze|finger"),
    ("mains", r"main|curr|biryani|entree|entrée|thali|meal|combo|noodle|pasta|pizza|burger|rice bowl|grill|sizzler|dosa|platter"),
    ("sides", r"side|bread|roti|naan|rice|raita|papad|accompan|extra|add[- ]?on|dip|sauce|condiment"),
]


def guess(name: str) -> str:
    n = (name or "").lower()
    for phase, pattern in RULES:
        if re.search(pattern, n):
            return phase
    return "mains"


def effective(phase: str | None, name: str) -> str:
    return phase if phase in PHASES else guess(name)


def clear_minutes(samples: dict[str, list[float]]) -> dict[str, dict]:
    """Median minutes to close per phase from history, falling back to defaults when there isn't enough of it."""
    out = {}
    for p in PHASES:
        s = samples.get(p, [])
        if len(s) >= MIN_SAMPLES:
            out[p] = {"minutes": round(median(s), 1), "samples": len(s), "learned": True}
        else:
            out[p] = {"minutes": float(DEFAULT_CLEAR_MIN[p]), "samples": len(s), "learned": False}
    return out
