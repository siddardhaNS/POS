/* Everything the counter keeps on this computer: settings, the sign-in, the menu download, today's sales and the
   queue of sales waiting to reach the server. Stored in the app's own storage, which survives restarts. */

export interface Session { token: string; user: { id: string; name: string; role: string; permissions: string[] }; tenant: Tenant | null }
export interface Tenant {
  id: string; name: string; location_name?: string; currency: "INR" | "USD"; market: "IN" | "US"; tax_label: string; tax_rate: number;
  address?: string; city?: string; phone?: string; tax_id?: string; receipt_footer?: string; prices_include_tax?: boolean; tips_enabled?: boolean;
}
export interface Opt { id: string; name: string; price: number; available?: boolean }
export interface Group { id: string; name: string; min: number; max: number; options: Opt[] }
export interface Item {
  id: string; category_id: string; name: string; price: number; is_veg: boolean; available: boolean; modifiers: Group[]; channels?: string[];
  hsn?: string;
}
export interface Category { id: string; name: string; open_now?: boolean; schedule_label?: string; items: Item[] }
export interface TaxInfo { rate: number; name: string; parts: { name: string; rate: number }[] }
export interface Bootstrap {
  tenant: Tenant; menu: Category[]; tax: Record<string, TaxInfo>; staff: { id: string; name: string; role: string }[];
  server_time: string; fetched_at: string;
}

export interface SaleLine {
  key: string; menu_item_id: string | null; name: string; qty: number; unit_price: number; note: string;
  modifiers: { group: string; name: string; price: number }[]; tax_rate: number; tax_parts: { name: string; rate: number }[];
}
export interface SalePayment { method: string; amount: number; tendered: number; at: string }
export interface Sale {
  client_id: string; client_ref: string; created_at: string; closed_at: string | null; customer_name: string; customer_phone: string;
  tax_inclusive: boolean; discount_kind: "" | "percent" | "amount"; discount_value: number; discount_reason: string;
  lines: SaleLine[]; payments: SalePayment[]; void_reason: string; staff: string;
  // Sync state: queued until the server takes it; then its check number and invoice.
  sync: "queued" | "synced" | "error"; sync_error?: string; server_number?: number; invoice_no?: string; server_state?: string;
}

const K = {
  config: "tc.config", device: "tc.device", staff: "tc.staff", boot: "tc.boot", sales: "tc.sales", seq: "tc.seq", deviceId: "tc.deviceId",
};

function read<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export interface Config { apiUrl: string; printer: string; paperMm: 58 | 80; printReceipt: boolean; printKitchen: boolean; kitchenPrinter: string }
const DEFAULT_CONFIG: Config = { apiUrl: "http://localhost:8010", printer: "", paperMm: 80, printReceipt: true, printKitchen: false, kitchenPrinter: "" };

export const store = {
  config: (): Config => ({ ...DEFAULT_CONFIG, ...read<Partial<Config>>(K.config, {}) }),
  setConfig: (c: Partial<Config>) => write(K.config, { ...store.config(), ...c }),
  device: () => read<Session | null>(K.device, null),
  setDevice: (s: Session | null) => (s ? write(K.device, s) : localStorage.removeItem(K.device)),
  staff: () => read<Session | null>(K.staff, null),
  setStaff: (s: Session | null) => (s ? write(K.staff, s) : localStorage.removeItem(K.staff)),
  boot: () => read<Bootstrap | null>(K.boot, null),
  setBoot: (b: Bootstrap) => write(K.boot, b),
  /** This computer's own id, part of every offline sale id. */
  deviceId(): string {
    let id = localStorage.getItem(K.deviceId);
    if (!id) { id = crypto.randomUUID().slice(0, 8); localStorage.setItem(K.deviceId, id); }
    return id;
  },
  /** Sales from the last 3 days (older synced ones are dropped; anything unsynced is always kept). */
  sales: () => read<Sale[]>(K.sales, []),
  saveSales(list: Sale[]) {
    const cutoff = Date.now() - 3 * 86400000;
    write(K.sales, list.filter((s) => s.sync !== "synced" || new Date(s.created_at).getTime() >= cutoff));
  },
  upsertSale(s: Sale) {
    const all = store.sales();
    const i = all.findIndex((x) => x.client_id === s.client_id);
    if (i >= 0) all[i] = s; else all.unshift(s);
    store.saveSales(all);
  },
  /** Token numbers for guests: 1, 2, 3... starting again each day. */
  nextToken(): number {
    const today = new Date().toDateString();
    const seq = read<{ day: string; n: number }>(K.seq, { day: today, n: 0 });
    const n = seq.day === today ? seq.n + 1 : 1;
    write(K.seq, { day: today, n });
    return n;
  },
  clearSignIn() { localStorage.removeItem(K.device); localStorage.removeItem(K.staff); },
};
