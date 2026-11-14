import { store, type Bootstrap, type Session } from "./store";

/* The desktop shell (preload) gives us window.tiffin; running in a plain browser (npm run dev in a browser) falls back
   to fetch. */
interface Bridge {
  http: (req: { url: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) =>
    Promise<{ ok: boolean; status: number; text: string; error?: string }>;
  printers: () => Promise<{ name: string; isDefault: boolean }[]>;
  print: (job: { html: string; printer?: string; widthMm?: number }) => Promise<{ ok: boolean; error: string }>;
  info: () => Promise<{ version: string; platform: string; mode?: string }>;
  /** Sign-in, staff and menu saved by the app while the full POS was online, and where the server is. */
  cached: () => Promise<{ device?: Session | null; staff?: Session | null; boot?: Bootstrap; apiUrl: string; webUrl: string }>;
  goFull: () => Promise<boolean>;
  savePrinter: (p: { name: string; widthMm: number }) => Promise<boolean>;
  onOnline: (fn: (ok: boolean) => void) => () => void;
}
declare global { interface Window { tiffin?: Bridge } }

export const bridge = typeof window !== "undefined" ? window.tiffin : undefined;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** status 0 = couldn't reach the server (offline): callers treat that differently from a real refusal. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number } = {}): Promise<T> {
  const base = store.config().apiUrl.replace(/\/+$/, "");
  const token = init.token === undefined ? (store.staff() ?? store.device())?.token : init.token;
  const headers: Record<string, string> = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const method = init.method ?? (init.body ? "POST" : "GET");
  const body = init.body ? JSON.stringify(init.body) : undefined;
  let status = 0, text = "";
  if (bridge) {
    const r = await bridge.http({ url: base + path, method, headers, body, timeoutMs: init.timeoutMs ?? 15000 });
    status = r.status; text = r.text;
    if (!status) throw new ApiError(0, "Offline: can't reach the server");
  } else {
    try {
      const r = await fetch(base + path, { method, headers, body, signal: AbortSignal.timeout(init.timeoutMs ?? 15000) });
      status = r.status; text = await r.text();
    } catch { throw new ApiError(0, "Offline: can't reach the server"); }
  }
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (status < 200 || status >= 300) {
    const d = (data as { detail?: unknown } | null)?.detail;
    const msg = typeof d === "string" ? d : Array.isArray(d) ? d.map((x: { msg: string }) => x.msg).join(", ") : `Server error ${status}`;
    throw new ApiError(status, msg);
  }
  return data as T;
}

export function money(v: number, currency: "INR" | "USD" | undefined) {
  if (currency === "USD") return (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2);
  const n = Math.round(Math.abs(v)).toString();
  const last3 = n.slice(-3), rest = n.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (v < 0 ? "-" : "") + "₹" + (rest ? rest + "," + last3 : last3);
}

export const can = (perms: string[] | undefined, p: string) => !!perms?.includes(p);

/** Crash report to the admin console (best effort, only when online). */
export function reportError(err: unknown, where = "") {
  const e = err instanceof Error ? err : new Error(String(err));
  api("/client-errors", { body: { source: "desktop", message: `${e.name}: ${e.message}`.slice(0, 500), stack: (e.stack ?? "").slice(0, 20000), path: where }, timeoutMs: 5000 })
    .catch(() => {});
}
