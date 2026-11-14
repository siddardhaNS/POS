"use client";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8010";

export type Role = "platform_admin" | "owner" | "manager" | "cashier" | "captain" | "chef";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  market: "IN" | "US";
  currency: "INR" | "USD";
  tax_rate: number;
  tax_label: string;
  status: string;
  trial_ends_at: string | null;
  phone?: string;
  city?: string;
  address?: string;
  tax_id?: string;
  timezone?: string;
  tips_enabled?: boolean;
  receipt_footer?: string;
  auto_print_kot?: boolean;
  auto_print_receipt?: boolean;
  default_tax_id?: string | null;
  invoice_prefix?: string;
  /** Optional modules turned on for this restaurant by Tiffin (online, reports_plus, printing, menu_scan). */
  modules?: string[];
  /** Multi-location: the business this outlet belongs to, and the outlet name (e.g. "Downtown"). */
  brand_id?: string | null;
  location_name?: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  permissions: string[];
}

export interface Session {
  token: string;
  user: SessionUser;
  tenant: Tenant | null;
}

const KEY = "tiffin.session";
// The restaurant's device session (owner login) is kept separately so staff can PIN-switch and lock.
const DEVICE_KEY = "tiffin.device";

function read(key: string): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export const session = {
  get: () => read(KEY),
  device: () => read(DEVICE_KEY),
  set(s: Session, opts: { device?: boolean } = {}) {
    localStorage.setItem(KEY, JSON.stringify(s));
    if (opts.device) localStorage.setItem(DEVICE_KEY, JSON.stringify(s));
  },
  lock() {
    localStorage.removeItem(KEY);
  },
  clear() {
    localStorage.removeItem(KEY);
    localStorage.removeItem(DEVICE_KEY);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const token = init.token === undefined ? session.get()?.token : init.token;
  const res = await fetch(API_URL + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    let msg = "Something went wrong";
    if (typeof data?.detail === "string") msg = data.detail;
    else if (Array.isArray(data?.detail)) msg = data.detail.map((d: { msg: string }) => d.msg).join(", ");
    if (res.status === 401 && typeof window !== "undefined") session.lock();
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export function money(v: number, t: Pick<Tenant, "currency"> | null | undefined) {
  if (t?.currency === "USD") return "$" + v.toFixed(2);
  return "₹" + Math.round(v).toLocaleString("en-IN");
}

export const can = (u: SessionUser | undefined, perm: string) => !!u?.permissions.includes(perm);

/** Is this optional module turned on for the restaurant? */
export const hasModule = (t: Tenant | null | undefined, key: string) => !!t?.modules?.includes(key);

/** multipart/form-data upload (CSV / menu photos). */
export async function upload<T = unknown>(path: string, files: File[], field = "file"): Promise<T> {
  const fd = new FormData();
  files.forEach((f) => fd.append(field, f));
  const token = session.get()?.token;
  const res = await fetch(API_URL + path, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, typeof data?.detail === "string" ? data.detail : "Upload failed");
  return data as T;
}
