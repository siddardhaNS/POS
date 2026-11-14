import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { store, type Bootstrap, type Sale } from "./store";

/**
 * Keeps the counter in step with the server:
 * - every 10 s: is the server reachable? send any queued sales;
 * - every 5 min (and when coming back online): download the menu, prices, taxes and staff again.
 * Sales are always saved on this computer first, so a sale is never lost to a dropped connection.
 */
export function useSync(signedIn: boolean) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [queued, setQueued] = useState(() => store.sales().filter((s) => s.sync !== "synced").length);
  const [boot, setBoot] = useState<Bootstrap | null>(() => store.boot());
  const [lastSync, setLastSync] = useState<string | null>(null);
  const busy = useRef(false);
  const lastBoot = useRef(0);

  const refreshMenu = useCallback(async () => {
    const b = await api<Omit<Bootstrap, "fetched_at">>("/counter/bootstrap", { timeoutMs: 20000 });
    const full = { ...b, fetched_at: new Date().toISOString() };
    store.setBoot(full);
    setBoot(full);
    lastBoot.current = Date.now();
  }, []);

  const push = useCallback(async () => {
    // Ids over the server's 40-character limit (from the first build) never reached the server: shorten them here.
    const fixed = store.sales().map((s) => (s.sync !== "synced" && s.client_id.length > 40
      ? { ...s, client_id: s.client_id.replace(/-/g, "").slice(0, 40), sync: "queued" as const, sync_error: undefined } : s));
    store.saveSales(fixed);
    const pending = fixed.filter((s) => s.sync !== "synced").reverse(); // oldest first
    if (!pending.length) return;
    const body = pending.slice(0, 50).map(({ sync: _s, sync_error: _e, server_number: _n, invoice_no: _i, server_state: _st, staff: _staff, ...rest }) =>
      ({ ...rest, lines: rest.lines.map(({ key: _k, tax_rate: _r, tax_parts: _p, ...l }) => l) }));
    let res: { results: { client_id: string; status: string; number?: number; invoice_no?: string; state?: string; message?: string }[] };
    try {
      res = await api("/counter/sync", { body: { orders: body }, timeoutMs: 30000 });
    } catch (e) {
      // The server refused the whole batch (not a dropped connection): show why on each sale instead of retrying blindly.
      if (e instanceof ApiError && e.status >= 400 && e.status !== 401) {
        const all = store.sales();
        for (const s of all) if (body.some((b) => b.client_id === s.client_id)) { s.sync = "error"; s.sync_error = e.message; }
        store.saveSales(all);
        return;
      }
      throw e;
    }
    const all = store.sales();
    for (const r of res.results) {
      const s = all.find((x) => x.client_id === r.client_id);
      if (!s) continue;
      if (r.status === "error") { s.sync = "error"; s.sync_error = r.message; }
      else { s.sync = "synced"; s.sync_error = undefined; s.server_number = r.number; s.invoice_no = r.invoice_no || s.invoice_no; s.server_state = r.state; }
    }
    store.saveSales(all);
  }, []);

  const tick = useCallback(async () => {
    if (!signedIn || busy.current) return;
    busy.current = true;
    try {
      await api("/health", { token: null, timeoutMs: 5000 });
      setOnline(true);
      if (!store.boot() || Date.now() - lastBoot.current > 5 * 60_000) await refreshMenu().catch(() => {});
      await push();
      setLastSync(new Date().toISOString());
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOnline(false);
    } finally {
      setQueued(store.sales().filter((s) => s.sync !== "synced").length);
      busy.current = false;
    }
  }, [signedIn, refreshMenu, push]);

  useEffect(() => {
    if (!signedIn) return;
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 10_000);
    const wake = () => { void tick(); };
    window.addEventListener("online", wake);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener("online", wake); };
  }, [signedIn, tick]);

  /** Call after saving a sale: try to send it right away. */
  const kick = useCallback(() => { setQueued(store.sales().filter((s: Sale) => s.sync !== "synced").length); void tick(); }, [tick]);

  return { online, queued, boot, lastSync, kick, refreshMenu };
}
