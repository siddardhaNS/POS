"""Render a print document (see printdocs.py) to raw ESC/POS bytes for thermal printers.

A document is {"lines": [...], "cut": bool = True, "drawer": bool = False} where each line is one of
  {"t": "text", "s": str, "a": "l"|"c"|"r", "b": bool, "z": 1|2}
  {"t": "lr", "l": str, "r": str, "b": bool, "z": 1|2}     left text, right-aligned value
  {"t": "hr"}                                               dashed rule
  {"t": "feed", "n": int}                                   blank lines
Printers only get ASCII: currency signs and typographic characters are transliterated.
"""
import textwrap
import unicodedata

ESC, GS = b"\x1b", b"\x1d"
INIT = ESC + b"@"
ALIGN = {"l": ESC + b"a\x00", "c": ESC + b"a\x01", "r": ESC + b"a\x02"}
BOLD = (ESC + b"E\x00", ESC + b"E\x01")
SIZE = {1: GS + b"!\x00", 2: GS + b"!\x11"}  # 0x11 = double width + double height
CUT = GS + b"V\x42\x00"  # feed to the cutter, then partial cut
DRAWER = ESC + b"p\x00\x19\xfa"  # pulse pin 2: 25 x 2 ms on, 250 x 2 ms off

ASCII_MAP = {
    "₹": "Rs.", "€": "EUR", "£": "GBP", "¥": "JPY", "¢": "c",
    "×": "x", "−": "-", "–": "-", "—": "-", "‐": "-", "‑": "-",
    "‘": "'", "’": "'", "‚": "'", "′": "'", "“": '"', "”": '"', "„": '"', "″": '"', "«": '"', "»": '"',
    "·": "-", "•": "*", "…": "...", "→": "->", "←": "<-", "✓": "v", "°": "o", "½": "1/2", "¼": "1/4", "¾": "3/4",
    " ": " ", " ": " ", " ": " ", "\t": " ",
}


def ascii_text(s: str) -> str:
    s = "".join(ASCII_MAP.get(c, c) for c in str(s or ""))
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return "".join(c for c in s if c == "\n" or 32 <= ord(c) < 127)


def wrap(s: str, width: int) -> list[str]:
    out: list[str] = []
    for para in ascii_text(s).split("\n"):
        out += textwrap.wrap(para, width=max(width, 1), break_long_words=True, break_on_hyphens=False) or [""]
    return out


def lr(left: str, right: str, width: int) -> list[str]:
    """Left text wrapped to the width, with the right value on the last line (or its own line if it doesn't fit)."""
    right = ascii_text(right).strip()
    if not right:
        return wrap(left, width)
    if len(right) >= width:
        return wrap(left, width) + [right[-width:]]
    lines = wrap(left, width)
    last = lines[-1]
    if len(last) + 1 + len(right) <= width:
        lines[-1] = last + " " * (width - len(last) - len(right)) + right
    else:
        lines.append(right.rjust(width))
    return lines


def render_one(doc: dict, width: int, drawer: bool) -> bytes:
    out = bytearray(INIT)
    if drawer:
        out += DRAWER
    for ln in doc.get("lines") or []:
        t = ln.get("t", "text")
        z = 2 if ln.get("z") == 2 else 1
        w = max(width // z, 8)
        if t == "hr":
            out += ALIGN["l"] + BOLD[0] + SIZE[1] + b"-" * width + b"\n"
            continue
        if t == "feed":
            out += b"\n" * max(0, min(int(ln.get("n", 1) or 1), 10))
            continue
        if t == "lr":
            rows, align = lr(ln.get("l", ""), ln.get("r", ""), w), "l"
        else:
            rows, align = wrap(ln.get("s", ""), w), ln.get("a", "l") if ln.get("a") in ALIGN else "l"
        out += ALIGN[align] + BOLD[1 if ln.get("b") else 0] + SIZE[z]
        for r in rows:
            out += r.encode("ascii", "ignore") + b"\n"
        out += SIZE[1] + BOLD[0]
    out += ALIGN["l"]
    if doc.get("cut", True):
        out += b"\n" * 3 + CUT
    return bytes(out)


def render(doc: dict, width: int = 48, copies: int = 1) -> bytes:
    """ESC/POS bytes for `copies` copies of the document; the cash drawer (if asked) is kicked once."""
    width = width if width in (32, 42, 48) else 48
    copies = max(1, min(int(copies or 1), 3))
    has_lines = bool(doc.get("lines"))
    if not has_lines:  # drawer kick only
        return render_one({**doc, "cut": False}, width, bool(doc.get("drawer")))
    return b"".join(render_one(doc, width, bool(doc.get("drawer")) and i == 0) for i in range(copies))
