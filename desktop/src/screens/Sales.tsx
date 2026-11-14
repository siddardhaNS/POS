import { useState } from "react";
import { money } from "../lib/api";
import { printHtml, receiptHtml } from "../lib/receipt";
import { store, type Sale, type Tenant } from "../lib/store";
import { totals } from "../lib/totals";
import type { Toast } from "../App";

const METHODS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", tap: "Tap", other: "Other" };

/** Today's sales on this counter: totals by payment method (for cashing up), each sale's sync state, reprint, cancel. */
export function Sales({ tenant, online, onChange, say }: { tenant: Tenant | null; online: boolean | null; onChange: () => void; say: Toast }) {
  const [rev, setRev] = useState(0);
  const today = new Date().toDateString();
  const sales = store.sales().filter((s) => new Date(s.created_at).toDateString() === today);
  void rev;
  if (!tenant) return null;
  const fmt = (v: number) => money(v, tenant.currency);
  const live = sales.filter((s) => !s.void_reason);
  const byMethod = new Map<string, number>();
  for (const s of live) for (const p of s.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);
  const total = live.reduce((a, s) => a + totals(s).due, 0);
  const waiting = sales.filter((s) => s.sync !== "synced");

  function cancel(s: Sale) {
    const reason = prompt(`Cancel token ${s.client_ref}? Say why (refund the guest yourself):`);
    if (!reason?.trim()) return;
    store.upsertSale({ ...s, void_reason: reason.trim(), sync: "queued" });
    setRev((r) => r + 1);
    onChange();
    say(`Token ${s.client_ref} cancelled`);
  }
  async function reprint(s: Sale) {
    const err = await printHtml(receiptHtml(s, tenant!, store.config().paperMm));
    say(err ? `Couldn't print: ${err}` : `Receipt for token ${s.client_ref} printed`, !!err);
  }
  function retry() {
    store.saveSales(store.sales().map((s) => (s.sync === "error" ? { ...s, sync: "queued" as const } : s)));
    setRev((r) => r + 1);
    onChange();
  }

  return (
    <div className="scroll" style={{ height: "100%", padding: 18, display: "grid", gap: 14, alignContent: "start" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
        <Tile label="Sales today (this counter)" value={fmt(total)} sub={`${live.length} bills`} />
        {[...byMethod.entries()].map(([m, v]) => <Tile key={m} label={METHODS[m] ?? m} value={fmt(v)} />)}
        <Tile label="Waiting to send" value={String(waiting.length)} sub={waiting.length ? (online === false ? "Will send when back online" : "Sending…") : "All on the server"} warn={waiting.some((s) => s.sync === "error")} />
      </div>
      {sales.some((s) => s.sync === "error") && (
        <div className="card" style={{ padding: 14, background: "var(--chili-soft)", borderColor: "transparent", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>Some sales were refused by the server. The reason is on each one.</span>
          <button className="btn sm" onClick={retry}>Try again</button>
        </div>
      )}
      <div className="card">
        {sales.length === 0 ? <div className="muted" style={{ padding: 30, textAlign: "center" }}>No sales on this counter today.</div> : sales.map((s) => {
          const tot = totals(s);
          return (
            <div key={s.client_id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderBottom: "1px solid var(--soft)", opacity: s.void_reason ? 0.5 : 1 }}>
              <b className="mono" style={{ width: 70, fontSize: 18 }}>#{s.client_ref}</b>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}</div>
                <div className="muted">
                  {new Date(s.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {s.staff}
                  {s.customer_name ? ` · ${s.customer_name}` : ""} · {s.payments.map((p) => METHODS[p.method] ?? p.method).join(" + ")}
                  {s.void_reason ? ` · cancelled: ${s.void_reason}` : ""}
                </div>
                {s.sync === "error" && <div style={{ color: "var(--chili)", fontSize: 12 }}>{s.sync_error}</div>}
              </div>
              <span className="pill" style={s.sync === "synced" ? { background: "var(--leaf-soft)", color: "var(--leaf)" } : s.sync === "error" ? { background: "var(--chili-soft)", color: "var(--chili)" } : { background: "var(--sky-soft)", color: "var(--sky)" }}>
                {s.sync === "synced" ? `Check #${s.server_number}${s.server_state === "open" ? " · needs settling in the POS" : ""}` : s.sync === "error" ? "Refused" : "Not sent yet"}
              </span>
              <b className="mono" style={{ width: 90, textAlign: "right" }}>{fmt(tot.due)}</b>
              <button className="btn sm soft" onClick={() => reprint(s)}>Reprint</button>
              {s.sync !== "synced" && !s.void_reason && <button className="btn sm soft" onClick={() => cancel(s)}>Cancel</button>}
            </div>
          );
        })}
      </div>
      <div className="muted">Bills cancelled after they reached the server are refunded from Order history in the Tiffin POS.</div>
    </div>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="muted">{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: warn ? "var(--chili)" : undefined }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 12 }}>{sub}</div>}
    </div>
  );
}
