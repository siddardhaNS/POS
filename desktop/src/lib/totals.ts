import type { Sale } from "./store";

/* Check totals worked out on the counter, so billing works with no internet. Mirrors the server (api/app/routers/pos.py
   recompute and api/app/taxes.py): tax per line at the dish's rate on its share after the discount; with prices that
   include tax, the tax is taken out of the price instead of added on top. */

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface Totals {
  gross: number;       // menu prices × qty
  discount: number;    // off the menu prices
  subtotal: number;    // before tax (what the server calls subtotal)
  tax: number;
  due: number;         // what the guest pays
  paid: number;
  balance: number;
  parts: { name: string; rate: number; tax: number }[]; // CGST 2.5% ...
}

export function totals(s: Pick<Sale, "lines" | "discount_kind" | "discount_value" | "tax_inclusive" | "payments">): Totals {
  const gross = s.lines.reduce((a, l) => a + l.unit_price * l.qty, 0);
  let disc = s.discount_kind === "percent" ? gross * s.discount_value / 100 : s.discount_kind === "amount" ? Math.min(s.discount_value, gross) : 0;
  disc = Math.min(disc, gross);
  const f = gross ? 1 - disc / gross : 1;
  const parts = new Map<string, { name: string; rate: number; tax: number }>();
  let tax = 0, subtotal = 0;
  for (const l of s.lines) {
    const v = l.unit_price * l.qty;
    const r = l.tax_rate;
    const lineTax = s.tax_inclusive ? (v * f * r) / (1 + r) : v * f * r;
    tax += lineTax;
    subtotal += s.tax_inclusive ? v / (1 + r) : v;
    const ps = l.tax_parts.length ? l.tax_parts : [{ name: "Tax", rate: r }];
    for (const p of ps) {
      const key = `${p.name}|${p.rate}`;
      const net = s.tax_inclusive ? (v * f) / (1 + r) : v * f;
      const cur = parts.get(key) ?? { name: p.name, rate: Math.round(p.rate * 100000) / 1000, tax: 0 };
      cur.tax += net * p.rate;
      parts.set(key, cur);
    }
  }
  tax = r2(tax);
  const due = s.tax_inclusive ? r2(gross - disc) : r2(gross - disc + tax);
  const paid = r2(s.payments.reduce((a, p) => a + p.amount, 0));
  return {
    gross: r2(gross), discount: r2(disc), subtotal: r2(subtotal), tax, due, paid, balance: r2(due - paid),
    parts: [...parts.values()].map((p) => ({ ...p, tax: r2(p.tax) })).filter((p) => p.tax || p.rate),
  };
}
