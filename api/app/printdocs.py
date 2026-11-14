"""Build printable documents (the line format rendered by escpos.py) for tickets, bills and receipts."""
from datetime import datetime

from .models import Kot, Order, OrderItem, Printer, Tenant
from .routers.pos import kds_title, order_out, tenant_tz

METHOD_LABEL = {"cash": "Cash", "card": "Card", "upi": "UPI", "tap": "Tap to pay", "online": "Paid online", "other": "Other", "points": "Points",
                "split": "Split", "comp": "Comp"}


def T(s: str, a: str = "l", b: bool = False, z: int = 1) -> dict:
    return {"t": "text", "s": s, "a": a, "b": b, "z": z}


def LR(l: str, r: str, b: bool = False, z: int = 1) -> dict:  # noqa: E741
    return {"t": "lr", "l": l, "r": r, "b": b, "z": z}


HR = {"t": "hr"}


def feed(n: int = 1) -> dict:
    return {"t": "feed", "n": n}


def money_fmt(t: Tenant):
    """Same format as the web app: $12.50, or ₹1,23,456 (rupees rounded, Indian grouping)."""
    def fmt(v: float) -> str:
        v = float(v or 0)
        if t.currency == "USD":
            return ("-" if v < 0 else "") + f"${abs(v):,.2f}"
        n = str(abs(round(v)))
        if len(n) > 3:
            head, tail = n[:-3], n[-3:]
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            n = ",".join(([head] if head else []) + groups) + "," + tail
        return ("-" if v < 0 else "") + "₹" + n
    return fmt


def when(t: Tenant, d: datetime | str | None) -> str:
    if d is None:
        return ""
    if isinstance(d, str):
        d = datetime.fromisoformat(d)
    d = d.astimezone(tenant_tz(t))
    return f"{d.day} {d:%b %Y}, {d.hour % 12 or 12}:{d:%M} {d:%p}"


def order_title(o: dict) -> str:
    if o["table"]:
        name = o["table"][1:] if o["table"].startswith("T") else o["table"]
        return f"Table {name}"
    if o["channel"] == "takeaway":
        return f"Takeaway #{o['number']}" + (f" · {o['customer_name']}" if o["customer_name"] else "")
    if o["channel"] == "delivery":
        return f"Delivery #{o['number']}" + (f" · {o['customer_name']}" if o["customer_name"] else "")
    return f"Order #{o['number']}"


def header(t: Tenant) -> list[dict]:
    out = [T(t.name, "c", True, 2)]
    if t.address:
        out.append(T(t.address, "c"))
    elif t.city:
        out.append(T(t.city, "c"))
    if t.phone:
        out.append(T(t.phone, "c"))
    if t.tax_id:
        out.append(T(f"Tax ID: {t.tax_id}", "c"))
    return out


def kot_doc(t: Tenant, o: Order, k: Kot, items: list[OrderItem], printer: Printer | None = None) -> dict:
    stations = sorted({i.station for i in items if i.station})
    lines = [T(f"KOT {k.number}", "c", True, 2), T(kds_title(o), "c", True, 2), T(when(t, k.created_at), "c")]
    if k.course:
        lines.append(T(f"COURSE {k.course}", "c", True, 2))
    if stations:
        lines.append(T(" / ".join(stations), "c", True))
    lines.append(HR)
    for i in items:
        lines.append(T(f"{i.qty} x {i.name}" + (f" · S{i.seat}" if i.seat else ""), "l", True, 2))
        for m in i.modifiers or []:
            lines.append(T(f"  + {m.get('name', '')}", "l", True))
        if i.note:
            lines.append(T(f"  !! {i.note}", "l", True))
    lines += [HR, feed(1)]
    return {"lines": lines, "cut": True}


def check_doc(t: Tenant, order: Order, kind: str = "receipt") -> dict:
    """Guest check: "bill" before payment, "receipt" after. Mirrors printReceipt in web/src/components/pos/print.ts."""
    o, fmt = order_out(order), money_fmt(t)
    gst = t.market == "IN"
    label = ("BILL" if kind == "bill" else "REFUND RECEIPT" if o["status"] == "refunded"
             else "TAX INVOICE" if gst and t.tax_id else "RECEIPT")
    lines = header(t) + [HR, T(label, "c", True), LR(order_title(o), f"#{o['number']}"),
                         T(when(t, o["closed_at"] or o["opened_at"]) + (f" · {o['guests']} guests" if o["guests"] else ""))]
    if o["invoice_no"] and kind != "bill":
        lines.append(LR("Invoice", o["invoice_no"]))
    if o["delivery"]:
        dl = o["delivery"]
        lines += [T(f"Deliver to: {o['customer_name'] or ''} {o['customer_phone'] or ''}".strip()), T(dl["address"])]
        if dl["note"]:
            lines.append(T(f"Note: {dl['note']}"))
    if o["customer_name"] and o["customer_gstin"]:
        lines += [T(f"Bill to: {o['customer_name']}"), T(f"GSTIN: {o['customer_gstin']}")]
    elif o["customer_gstin"]:
        lines.append(T(f"Customer GSTIN: {o['customer_gstin']}"))
    lines.append(HR)
    for li in o["items"]:
        lines.append(LR(f"{li['qty']} x {li['name']}", "COMP" if li["comp_reason"] else fmt(li["line_total"])))
        if gst and li.get("hsn"):
            lines.append(T(f"  HSN {li['hsn']}" + (f" · GST {li['tax_rate']:g}%" if li.get("tax_rate") is not None else "")))
        for m in li["modifiers"]:
            lines.append(T(f"  + {m.get('name', '')}" + (f" ({fmt(m['price'])})" if m.get("price") else "")))
        if li["note"]:
            lines.append(T(f"  “{li['note']}”"))
    lines += [HR, LR("Value before tax" if o["tax_inclusive"] else "Subtotal", fmt(o["subtotal"]))]
    d = o["discount"]
    if d["amount"]:
        lines.append(LR("Discount" + (f" ({d['reason']})" if d["reason"] else ""), "−" + fmt(d["amount"])))
    if o["promotion"]:
        lines.append(LR(f"Offer ({o['promotion']['name']})", "−" + fmt(o["promotion"]["amount"])))
    if o["tax_breakdown"]:
        for b in o["tax_breakdown"]:
            if b["tax"] or b["rate"]:
                lines.append(LR(f"{b['name']} {b['rate']:g}%" if b["name"] in ("CGST", "SGST", "IGST", "UTGST") else b["name"], fmt(b["tax"])))
    else:
        lines.append(LR(t.tax_label or "Tax", fmt(o["tax"])))
    if o["delivery"] and o["delivery"]["fee"]:
        lines.append(LR("Delivery fee", fmt(o["delivery"]["fee"])))
    if o["tip"]:
        lines.append(LR("Tip", fmt(o["tip"])))
    lines.append(LR("Total", fmt(o["due"] + o["tip"]), True, 2))
    if o["payments"]:
        lines.append(HR)
        for p in o["payments"]:
            refund = p["kind"] == "refund"
            lines.append(LR(("Refund · " if refund else "") + METHOD_LABEL.get(p["method"], p["method"]),
                            ("−" if refund else "") + fmt(p["amount"] + p["tip"])))
            if p["change"]:
                lines.append(LR("  Change", fmt(p["change"])))
    if kind == "bill" and t.tips_enabled:
        lines += [feed(1), T("Tip: ____________"), feed(1), T("Total: ____________")]
    if kind == "bill" and o["balance"] > 0 and o["paid"]:
        lines.append(LR("Balance due", fmt(o["balance"]), True))
    lines += [HR, T(t.receipt_footer or "Thank you!", "c"), feed(1)]
    return {"lines": lines, "cut": True}


def test_doc(t: Tenant, p: Printer) -> dict:
    fmt = money_fmt(t)
    what = "Receipts" if p.role == "receipt" else ("Kitchen: " + ", ".join(p.stations) if p.stations else "Kitchen: all other stations")
    return {"lines": [
        T(t.name, "c", True, 2), T("Test print", "c", True), HR,
        LR("Printer", p.name), LR("Prints", what), LR("Paper", f"{p.width} characters per line"),
        LR("Copies", str(p.copies)), HR,
        T(("1234567890" * 5)[:p.width], "l"), LR("Sample dish", fmt(250)), LR("Total", fmt(250), True, 2), HR,
        T("If you can read this, the printer is set up.", "c"), feed(1),
    ], "cut": True}


def drawer_doc() -> dict:
    return {"lines": [], "cut": False, "drawer": True}
