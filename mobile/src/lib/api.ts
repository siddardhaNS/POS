import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * The Tiffin API. Set EXPO_PUBLIC_API_URL to your server, e.g. https://app.yourdomain.com/api in production, or
 * http://<your computer's LAN IP>:8010 while developing (a phone can't reach "localhost" on your computer).
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8010").replace(/\/+$/, "");

export type Role = "owner" | "manager" | "cashier" | "captain" | "chef" | "platform_admin";
export interface Tenant {
  id: string; name: string; location_name?: string; currency: "INR" | "USD"; tax_label: string; market: "IN" | "US";
  modules?: string[]; prices_include_tax?: boolean;
}
export interface User { id: string; name: string; email: string | null; role: Role; permissions: string[] }
export interface Session { token: string; user: User; tenant: Tenant | null }

/* ---------- Storage: Keychain / Keystore on phones, localStorage in a browser (development only) ---------- */

const store = {
  async get(key: string) {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === "web") return void globalThis.localStorage?.setItem(key, value);
    return SecureStore.setItemAsync(key, value);
  },
  async remove(key: string) {
    if (Platform.OS === "web") return void globalThis.localStorage?.removeItem(key);
    return SecureStore.deleteItemAsync(key);
  },
};

// The restaurant's device sign-in (owner / manager email login) and whoever is using it right now (PIN).
const DEVICE = "tiffin.device";
const STAFF = "tiffin.staff";

export const sessions = {
  async load(): Promise<{ device: Session | null; staff: Session | null }> {
    const parse = (v: string | null) => { try { return v ? (JSON.parse(v) as Session) : null; } catch { return null; } };
    const [d, s] = await Promise.all([store.get(DEVICE), store.get(STAFF)]);
    return { device: parse(d), staff: parse(s) };
  },
  saveDevice: (s: Session) => store.set(DEVICE, JSON.stringify(s)),
  saveStaff: (s: Session) => store.set(STAFF, JSON.stringify(s)),
  clearStaff: () => store.remove(STAFF),
  clearAll: async () => { await store.remove(STAFF); await store.remove(DEVICE); },
};

let current: string | null = null;
/** The token requests are sent with (set by the auth provider). */
export const setToken = (t: string | null) => { current = t; };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export const whenUnauthorized = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  const token = init.token === undefined ? current : init.token;
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach Tiffin. Check the Wi-Fi or mobile data.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    let msg = "Something went wrong";
    if (typeof data?.detail === "string") msg = data.detail;
    else if (Array.isArray(data?.detail)) msg = data.detail.map((d: { msg: string }) => d.msg).join(", ");
    if (res.status === 401 && token && init.token === undefined) onUnauthorized?.();
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/** ₹1,23,456 (rupees rounded, Indian grouping) or $12.50, same as the web app. */
export function money(v: number, currency: "INR" | "USD" | undefined) {
  if (currency === "USD") return "$" + v.toFixed(2);
  const n = Math.round(Math.abs(v)).toString();
  const last3 = n.slice(-3);
  const rest = n.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return (v < 0 ? "-" : "") + "₹" + (rest ? rest + "," + last3 : last3);
}

export const can = (u: User | undefined | null, perm: string) => !!u?.permissions.includes(perm);
export const hasModule = (t: Tenant | null | undefined, key: string) => !!t?.modules?.includes(key);

/** Report a crash to the admin console's error log (best effort). */
export function reportError(err: unknown, where = "") {
  const e = err instanceof Error ? err : new Error(String(err));
  fetch(API_URL + "/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json", ...(current ? { authorization: `Bearer ${current}` } : {}) },
    body: JSON.stringify({ source: "mobile", message: `${e.name}: ${e.message}`.slice(0, 500), stack: (e.stack ?? "").slice(0, 20000), path: where.slice(0, 300) }),
  }).catch(() => {});
}
