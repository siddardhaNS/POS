import type { Nutrition } from "@/lib/menu";

export interface ModOption { id: string; name: string; price: number; /** Combo choice: the dish it serves. */ menu_item_id?: string | null; available?: boolean }
export interface ModGroup { id: string; name: string; min: number; max: number; options: ModOption[] }
export interface MenuItem {
  id: string; category_id: string; name: string; price: number; is_veg: boolean; station: string; available: boolean;
  modifiers: ModGroup[];
  description?: string; tags?: string[]; allergens?: string[]; nutrition?: Nutrition;
  /** Sales channels it sells on; empty = all. */
  channels?: MenuChannel[];
  /** Set when the menu is fetched for a channel: the base price before a price list changed it. */
  base_price?: number; price_list?: string;
  /** Some options serve another dish (a combo or meal deal). */
  is_combo?: boolean;
  /** Tax class (null = the category's, then the restaurant default) and HSN / SAC code. */
  tax_rate_id?: string | null; hsn?: string;
}
export type MenuChannel = "dine_in" | "takeaway" | "delivery" | "online" | "qr" | "kiosk";
export interface Schedule { days?: number[]; from?: string; to?: string }
export interface Category {
  id: string; name: string; phase: string; phase_set: boolean; items: MenuItem[];
  schedule?: Schedule; schedule_label?: string; open_now?: boolean; tax_rate_id?: string | null;
}

export interface Modifier { group: string; name: string; price: number }
export interface Line {
  id: string; menu_item_id: string | null; name: string; unit_price: number; qty: number; note: string;
  modifiers: Modifier[]; comp_reason: string; line_total: number; sent: boolean; done: boolean; paid: boolean;
  course: number; seat: number; station: string; source?: string; price_list?: string; returned_qty?: number;
  hsn?: string; tax_rate?: number | null;
}
export interface PaymentRow {
  id: string; kind: "payment" | "refund"; method: string; amount: number; tip: number; tendered: number; change: number;
  reason: string; line_ids: string[]; created_at: string;
}
export interface Order {
  id: string; number: number; table_id: string | null; table: string | null; channel: string; status: string;
  customer_name: string; customer_phone: string; guests: number;
  subtotal: number; tax: number; tip: number; total: number;
  discount: { kind: "" | "percent" | "amount"; value: number; amount: number; reason: string };
  due: number; paid: number; refunded: number; balance: number; payment_method: string; void_reason: string;
  opened_at: string; closed_at: string | null; items: Line[]; payments: PaymentRow[]; change?: number;
  credit_notes?: CreditNote[];
  customer_gstin?: string; invoice_no?: string; customer_id?: string | null; tax_inclusive?: boolean;
  promotion?: { id: string; name: string; amount: number } | null;
  loyalty?: { points: number; value: number; min_redeem: number } | null;
  delivery?: Delivery | null;
  event?: { at: string | null; venue: string; note: string; status: "quote" | "confirmed" | "done" | "cancelled" | "" } | null;
  tax_breakdown?: TaxPart[];
}
export interface Delivery {
  address: string; note: string; fee: number; status: "preparing" | "out" | "delivered" | ""; rider_id: string | null; rider_name: string;
  dispatched_at: string | null; delivered_at: string | null;
}
export interface TaxPart { name: string; rate: number; taxable: number; tax: number }
export interface CreditNote {
  id: string; number: number; label: string; order_id: string; amount: number; tax: number; method: string; reason: string;
  lines: { line_id: string; name: string; qty: number; amount: number }[]; restocked: boolean; user: string; created_at: string;
  order_number?: number;
}

export interface TableRow {
  id: string; name: string; seats: number; section: string; state: "free" | "unsent" | "kitchen" | "served";
  order_id: string | null; total: number; paid: number; guests: number; items: number; unsent: number;
  kitchen_since: string | null; opened_at: string | null;
  shape: "round" | "square" | "rect" | "booth" | "bar"; x: number; y: number; rotation: number;
}

export interface KotPrint {
  print_jobs?: number;
  kitchen_printers?: boolean;
  kot_number: number; created_at: string; course: number;
  items: { name: string; qty: number; note: string; modifiers: Modifier[]; seat: number; course: number }[];
}

export interface TaxRate { id: string; name: string; rate: number; components: { name: string; rate: number }[]; sort: number; items?: number }
export interface TaxRates { default_id: string | null; fallback: { name: string; rate: number }; rates: TaxRate[] }

/** "CGST 2.5%" for split parts, the class name otherwise. */
export const taxPartLabel = (p: TaxPart) => (["CGST", "SGST", "IGST", "UTGST"].includes(p.name) ? `${p.name} ${p.rate}%` : p.name);

/** Tax lines for a check's totals: one per component (CGST, SGST...), or the single tax line. */
export function taxLines(o: Pick<Order, "tax" | "tax_breakdown">, fallback: string): [string, number][] {
  const parts = (o.tax_breakdown ?? []).filter((b) => b.tax || b.rate);
  return parts.length ? parts.map((b) => [taxPartLabel(b), b.tax]) : [[fallback, o.tax]];
}
