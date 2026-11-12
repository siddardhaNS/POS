"use client";

import type { Tenant } from "@/lib/api";
import { METHOD_LABEL, orderTitle } from "./shared";
import type { KotPrint, Order } from "./types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const CSS = `
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.35 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; color: #000; margin: 0; width: 72mm; }
  .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 16px; } .huge { font-size: 22px; }
  .r { display: flex; justify-content: space-between; gap: 8px; } .r span:last-child { white-space: nowrap; }
  .m { padding-left: 14px; font-size: 11px; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .sp { height: 6px; }
`;

/** Print an HTML snippet on the default (receipt) printer via a hidden iframe. */
export function printHtml(body: string, title = "Print") {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const doc = f.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`);
  doc.close();
  setTimeout(() => {
    f.contentWindow?.focus();
    f.contentWindow?.print();
    setTimeout(() => f.remove(), 1000);
  }, 60);
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function header(t: Tenant | null | undefined) {
  if (!t) return "";
  return `<div class="c b big">${esc(t.name)}</div>
    ${t.address ? `<div class="c">${esc(t.address)}</div>` : t.city ? `<div class="c">${esc(t.city)}</div>` : ""}
    ${t.phone ? `<div class="c">${esc(t.phone)}</div>` : ""}
    ${t.tax_id ? `<div class="c">Tax ID: ${esc(t.tax_id)}</div>` : ""}`;
}

/** Guest check: "bill" before payment, "receipt" after. */
export function printReceipt(o: Order, t: Tenant | null | undefined, fmt: (v: number) => string, kind: "bill" | "receipt" = "receipt") {
  const lines = o.items.map((l) => `
    <div class="r"><span>${l.qty} × ${esc(l.name)}</span><span>${l.comp_reason ? "COMP" : fmt(l.line_total)}</span></div>
    ${l.modifiers.map((m) => `<div class="m">+ ${esc(m.name)}${m.price ? ` (${fmt(m.price)})` : ""}</div>`).join("")}
    ${l.note ? `<div class="m">“${esc(l.note)}”</div>` : ""}`).join("");
  const pays = o.payments.map((p) => `
    <div class="r"><span>${p.kind === "refund" ? "Refund · " : ""}${METHOD_LABEL[p.method] ?? p.method}</span><span>${p.kind === "refund" ? "−" : ""}${fmt(p.amount + p.tip)}</span></div>
    ${p.change ? `<div class="r m"><span>Change</span><span>${fmt(p.change)}</span></div>` : ""}`).join("");
  const body = `${header(t)}
    <hr><div class="c b">${kind === "bill" ? "BILL" : o.status === "refunded" ? "REFUND RECEIPT" : "RECEIPT"}</div>
    <div class="r"><span>${esc(orderTitle(o))}</span><span>#${o.number}</span></div>
    <div>${when(o.closed_at ?? o.opened_at)}${o.guests ? ` · ${o.guests} guests` : ""}</div>
    <hr>${lines}<hr>
    <div class="r"><span>Subtotal</span><span>${fmt(o.subtotal)}</span></div>
    ${o.discount.amount ? `<div class="r"><span>Discount${o.discount.reason ? ` (${esc(o.discount.reason)})` : ""}</span><span>−${fmt(o.discount.amount)}</span></div>` : ""}
    <div class="r"><span>${esc(t?.tax_label || "Tax")}</span><span>${fmt(o.tax)}</span></div>
    ${o.tip ? `<div class="r"><span>Tip</span><span>${fmt(o.tip)}</span></div>` : ""}
    <div class="r b huge"><span>Total</span><span>${fmt(o.due + o.tip)}</span></div>
    ${pays ? `<hr>${pays}` : ""}
    ${kind === "bill" && t?.tips_enabled ? `<div class="sp"></div><div>Tip: ____________</div><div class="sp"></div><div>Total: ____________</div>` : ""}
    ${kind === "bill" && o.balance > 0 && o.paid ? `<div class="r b"><span>Balance due</span><span>${fmt(o.balance)}</span></div>` : ""}
    <hr><div class="c">${esc(t?.receipt_footer || "Thank you!")}</div>`;
  printHtml(body, `Check ${o.number}`);
}

/** Kitchen ticket for the items just fired. */
export function printKot(k: KotPrint, title: string) {
  const body = `<div class="c b huge">KOT ${k.kot_number}</div>
    <div class="c b big">${esc(title)}</div>
    <div class="c">${when(k.created_at)}</div>${k.course ? `<div class="c b big">COURSE ${k.course}</div>` : ""}<hr>
    ${k.items.map((i) => `<div class="big b">${i.qty} × ${esc(i.name)}${i.seat ? ` · S${i.seat}` : ""}</div>
      ${i.modifiers.map((m) => `<div class="m big">+ ${esc(m.name)}</div>`).join("")}
      ${i.note ? `<div class="m big">!! ${esc(i.note)}</div>` : ""}`).join("")}
    <hr>`;
  printHtml(body, `KOT ${k.kot_number}`);
}

export interface DrawerReport {
  opened_at: string; closed_at: string | null; opened_by: string; closed_by: string; opening_float: number;
  cash_sales: number; cash_tips: number; cash_refunds: number; paid_in: number; paid_out: number;
  expected_cash: number; counted_cash: number | null; difference: number | null; note: string;
  by_method: Record<string, { sales: number; tips: number; refunds: number; count: number }>;
}

/** End-of-shift drawer report. */
export function printDrawer(d: DrawerReport, t: Tenant | null | undefined, fmt: (v: number) => string) {
  const r = (l: string, v: string) => `<div class="r"><span>${l}</span><span>${v}</span></div>`;
  const body = `${header(t)}<hr><div class="c b">DRAWER REPORT</div>
    <div>Opened ${when(d.opened_at)}${d.opened_by ? ` · ${esc(d.opened_by)}` : ""}</div>
    ${d.closed_at ? `<div>Closed ${when(d.closed_at)}${d.closed_by ? ` · ${esc(d.closed_by)}` : ""}</div>` : ""}<hr>
    ${Object.entries(d.by_method).map(([k, v]) => r(`${METHOD_LABEL[k] ?? k} (${v.count})`, fmt(v.sales + v.tips - v.refunds))).join("")}<hr>
    ${r("Opening float", fmt(d.opening_float))}${r("Cash sales", fmt(d.cash_sales))}${r("Cash tips", fmt(d.cash_tips))}
    ${r("Cash refunds", "−" + fmt(d.cash_refunds))}${r("Paid in", fmt(d.paid_in))}${r("Paid out", "−" + fmt(d.paid_out))}
    <hr>${r("<b>Expected</b>", `<b>${fmt(d.expected_cash)}</b>`)}
    ${d.counted_cash != null ? r("Counted", fmt(d.counted_cash)) + r("<b>Over / short</b>", `<b>${fmt(d.difference ?? 0)}</b>`) : ""}
    ${d.note ? `<hr><div>${esc(d.note)}</div>` : ""}`;
  printHtml(body, "Drawer report");
}
