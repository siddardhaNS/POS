import { bridge, money } from "./api";
import { store, type Sale, type Tenant } from "./store";
import { totals } from "./totals";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const METHOD: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", tap: "Tap", other: "Other", points: "Points" };

const css = (mm: number) => `
  @page { size: ${mm}mm auto; margin: 2mm; }
  * { box-sizing: border-box; } body { margin: 0; width: ${mm - 4}mm; font: 12px/1.35 ui-monospace, Consolas, monospace; color: #000; }
  .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 16px; } .huge { font-size: 26px; }
  .r { display: flex; justify-content: space-between; gap: 6px; } .m { padding-left: 12px; font-size: 11px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }`;

function wrap(body: string, mm: number) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(mm)}</style></head><body>${body}</body></html>`;
}

export function receiptHtml(s: Sale, t: Tenant, mm: number) {
  const fmt = (v: number) => money(v, t.currency);
  const tot = totals(s);
  const row = (l: string, v: string, cls = "") => `<div class="r ${cls}"><span>${l}</span><span>${v}</span></div>`;
  const gst = t.market === "IN";
  return wrap(`
    <div class="c b big">${esc(t.name)}</div>
    ${t.location_name ? `<div class="c">${esc(t.location_name)}</div>` : ""}
    ${t.address ? `<div class="c">${esc(t.address)}</div>` : t.city ? `<div class="c">${esc(t.city)}</div>` : ""}
    ${t.phone ? `<div class="c">${esc(t.phone)}</div>` : ""}
    ${t.tax_id ? `<div class="c">${gst ? "GSTIN" : "Tax ID"}: ${esc(t.tax_id)}</div>` : ""}
    <hr><div class="c b">${gst && t.tax_id ? "TAX INVOICE" : "RECEIPT"}</div>
    <div class="c b huge">TOKEN ${esc(s.client_ref)}</div>
    ${row(new Date(s.closed_at ?? s.created_at).toLocaleString(), s.invoice_no ? esc(s.invoice_no) : "")}
    ${s.customer_name ? `<div>${esc(s.customer_name)}${s.customer_phone ? ` · ${esc(s.customer_phone)}` : ""}</div>` : ""}
    <hr>
    ${s.lines.map((l) => `${row(`${l.qty} x ${esc(l.name)}`, fmt(l.unit_price * l.qty))}
      ${l.modifiers.map((m) => `<div class="m">+ ${esc(m.name)}</div>`).join("")}${l.note ? `<div class="m">"${esc(l.note)}"</div>` : ""}`).join("")}
    <hr>
    ${row(s.tax_inclusive ? "Value before tax" : "Subtotal", fmt(tot.subtotal))}
    ${tot.discount ? row(`Discount${s.discount_reason ? ` (${esc(s.discount_reason)})` : ""}`, "-" + fmt(tot.discount)) : ""}
    ${tot.parts.map((p) => row(`${esc(p.name)} ${p.rate}%`, fmt(p.tax))).join("")}
    ${row("Total", fmt(tot.due), "b big")}
    <hr>${s.payments.map((p) => row(METHOD[p.method] ?? p.method, fmt(p.amount)) + (p.method === "cash" && p.tendered > p.amount ? row("  Change", fmt(p.tendered - p.amount)) : "")).join("")}
    <hr><div class="c">${esc(t.receipt_footer || "Thank you!")}</div>`, mm);
}

export function kitchenHtml(s: Sale, mm: number) {
  return wrap(`
    <div class="c b huge">TOKEN ${esc(s.client_ref)}</div>
    <div class="c">${new Date(s.created_at).toLocaleTimeString()}${s.customer_name ? ` · ${esc(s.customer_name)}` : ""}</div><hr>
    ${s.lines.map((l) => `<div class="b big">${l.qty} x ${esc(l.name)}</div>${l.modifiers.map((m) => `<div class="m big">+ ${esc(m.name)}</div>`).join("")}${l.note ? `<div class="m big">!! ${esc(l.note)}</div>` : ""}`).join("")}
    <hr>`, mm);
}

/** Print silently in the desktop app; in a browser fall back to the print dialog. */
export async function printHtml(html: string, printer = ""): Promise<string | null> {
  const cfg = store.config();
  if (bridge) {
    const r = await bridge.print({ html, printer: printer || cfg.printer, widthMm: cfg.paperMm });
    return r.ok ? null : r.error || "Couldn't print";
  }
  const w = window.open("", "_blank", "width=420,height=640");
  if (!w) return "Pop-ups are blocked";
  w.document.write(html); w.document.close(); w.focus(); w.print();
  return null;
}
