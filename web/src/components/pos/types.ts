import type { Nutrition } from "@/lib/menu";

export interface ModOption { id: string; name: string; price: number }
export interface ModGroup { id: string; name: string; min: number; max: number; options: ModOption[] }
export interface MenuItem {
  id: string; category_id: string; name: string; price: number; is_veg: boolean; station: string; available: boolean;
  modifiers: ModGroup[];
  description?: string; tags?: string[]; allergens?: string[]; nutrition?: Nutrition;
  /** Sales channels it sells on; empty = all. */
  channels?: MenuChannel[];
}
export type MenuChannel = "dine_in" | "takeaway" | "delivery" | "online" | "qr";
export interface Schedule { days?: number[]; from?: string; to?: string }
export interface Category {
  id: string; name: string; phase: string; phase_set: boolean; items: MenuItem[];
  schedule?: Schedule; schedule_label?: string; open_now?: boolean;
}

export interface Modifier { group: string; name: string; price: number }
export interface Line {
  id: string; menu_item_id: string | null; name: string; unit_price: number; qty: number; note: string;
  modifiers: Modifier[]; comp_reason: string; line_total: number; sent: boolean; done: boolean; paid: boolean;
  course: number; seat: number; station: string; source?: string;
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
