import { useEffect, useMemo, useState } from "react";
import { can, money } from "../lib/api";
import { kitchenHtml, printHtml, receiptHtml } from "../lib/receipt";
import { store, type Bootstrap, type Item, type Opt, type Sale, type SaleLine, type Session } from "../lib/store";
import { totals } from "../lib/totals";
import type { Toast } from "../App";

const METHODS: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", tap: "Tap", other: "Other" };
const DISCOUNT_REASONS = ["Regular guest", "Staff meal", "Promotion", "Manager special"];

const blank = (inclusive: boolean): Pick<Sale, "lines" | "discount_kind" | "discount_value" | "discount_reason" | "customer_name" | "customer_phone" | "tax_inclusive" | "payments"> =>
  ({ lines: [], discount_kind: "", discount_value: 0, discount_reason: "", customer_name: "", customer_phone: "", tax_inclusive: inclusive, payments: [] });

/** Quick-service billing: tap dishes, take the money, print, next guest. Works the same with or without internet. */
export function Sell({ staff, boot, online, onSaved, say }: { staff: Session; boot: Bootstrap | null; online: boolean | null; onSaved: () => void; say: Toast }) {
  const t = boot?.tenant ?? staff.tenant!;
  const fmt = (v: number) => money(v, t.currency);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cart, setCart] = useState(() => blank(!!t.prices_include_tax));
  const [pick, setPick] = useState<Item | null>(null);
  const [paying, setPaying] = useState(false);
  const [discount, setDiscount] = useState(false);
  const tot = totals(cart);
  const menu = useMemo(() => (boot?.menu ?? []).map((c) => ({ ...c, items: c.items.filter((i) => !i.channels?.length || i.channels.includes("takeaway")) })).filter((c) => c.items.length), [boot]);
  const active = cat ?? menu[0]?.id ?? null;
  const items = useMemo(() => {
    if (q.trim()) return menu.flatMap((c) => c.items).filter((i) => i.name.toLowerCase().includes(q.trim().toLowerCase()));
    return menu.find((c) => c.id === active)?.items ?? [];
  }, [menu, active, q]);

  // Keyboard: Esc clears the search, F2 opens payment.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2" && cart.lines.length) setPaying(true);
      if (e.key === "Escape") { setQ(""); setPick(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.lines.length]);

  if (!boot) return <div className="center muted">{online === false ? "Offline, and the menu hasn't been downloaded yet. Connect once to start billing." : "Downloading the menu…"}</div>;

  function add(m: Item, options: Opt[] = [], note = "") {
    if (!m.available) return say(`${m.name} is sold out`, true);
    if (!options.length && m.modifiers.length && !pick) return setPick(m);
    const tax = boot!.tax[m.id] ?? { rate: t.tax_rate, name: t.tax_label, parts: [] };
    const key = `${m.id}|${options.map((o) => o.id).sort().join(",")}|${note}`;
    setCart((c) => {
      const hit = c.lines.find((l) => l.key === key);
      const lines: SaleLine[] = hit ? c.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) : [...c.lines, {
        key, menu_item_id: m.id, name: m.name, qty: 1, note, unit_price: m.price + options.reduce((a, o) => a + o.price, 0),
        modifiers: options.map((o) => ({ group: m.modifiers.find((g) => g.options.some((x) => x.id === o.id))?.name ?? "", name: o.name, price: o.price })),
        tax_rate: tax.rate, tax_parts: tax.parts,
      }];
      return { ...c, lines };
    });
    setPick(null);
  }
  const bump = (key: string, d: number) => setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0) }));

  async function complete(payments: Sale["payments"]) {
    const now = new Date().toISOString();
    const token = store.nextToken();
    const sale: Sale = {
      ...cart, payments, client_id: `${store.deviceId()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, client_ref: String(token), created_at: now, closed_at: now,
      void_reason: "", staff: staff.user.name, sync: "queued",
    };
    store.upsertSale(sale);
    setCart(blank(!!t.prices_include_tax));
    setPaying(false);
    onSaved();
    const cfg = store.config();
    if (cfg.printKitchen) { const err = await printHtml(kitchenHtml(sale, cfg.paperMm), cfg.kitchenPrinter); if (err) say(`Kitchen ticket: ${err}`, true); }
    if (cfg.printReceipt) { const err = await printHtml(receiptHtml(sale, t, cfg.paperMm)); if (err) say(`Receipt: ${err}`, true); }
    say(`Token ${token} · ${fmt(totals(sale).due)}${online === false ? " · saved offline, will send when back online" : ""}`);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", height: "100%" }}>
      <section style={{ display: "flex", flexDirection: "column", minHeight: 0, padding: 16, gap: 12 }}>
        <input className="input" placeholder="Search dishes (Esc clears)" value={q} onChange={(e) => setQ(e.target.value)} />
        {!q && <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          {menu.map((c) => <button key={c.id} className={`chip ${active === c.id ? "on" : ""}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
        </div>}
        <div className="scroll" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, alignContent: "start" }}>
          {items.map((m) => {
            const n = cart.lines.filter((l) => l.menu_item_id === m.id).reduce((a, l) => a + l.qty, 0);
            return (
              <button key={m.id} onClick={() => add(m)} disabled={!m.available} className="card"
                style={{ minHeight: 96, padding: 12, textAlign: "left", display: "flex", flexDirection: "column", borderWidth: n ? 2 : 1, borderColor: n ? "var(--ink)" : "var(--line)" }}>
                <span style={{ display: "flex", gap: 6, fontWeight: 600 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 5, marginTop: 6, flexShrink: 0, background: m.is_veg ? "var(--leaf)" : "var(--chili)" }} />{m.name}</span>
                <span style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "end" }}>
                  <span className="muted mono">{m.available ? fmt(m.price) : "Sold out"}{m.modifiers.length ? " +" : ""}</span>
                  {n > 0 && <span className="mono" style={{ minWidth: 24, height: 24, borderRadius: 12, background: "var(--ink)", color: "#fff", fontSize: 12, display: "grid", placeItems: "center", fontWeight: 700 }}>{n}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <aside style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--card)", borderLeft: "1px solid var(--line)" }}>
        <div style={{ padding: 14, display: "grid", gap: 8, borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" placeholder="Name (optional)" value={cart.customer_name} onChange={(e) => setCart({ ...cart, customer_name: e.target.value })} />
            <input className="input" placeholder="Phone" value={cart.customer_phone} onChange={(e) => setCart({ ...cart, customer_phone: e.target.value })} />
          </div>
        </div>
        <div className="scroll" style={{ flex: 1, padding: "6px 14px" }}>
          {cart.lines.length === 0 ? <div className="muted" style={{ padding: 30, textAlign: "center" }}>Tap dishes to start a bill.</div> : cart.lines.map((l) => (
            <div key={l.key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--soft)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{l.name}</div>
                {l.modifiers.length > 0 && <div style={{ fontSize: 12, color: "var(--saffron-deep)" }}>{l.modifiers.map((m) => m.name).join(" · ")}</div>}
                {l.note && <div className="muted" style={{ fontStyle: "italic" }}>“{l.note}”</div>}
              </div>
              <button className="btn sm soft" onClick={() => bump(l.key, -1)}>−</button>
              <span className="mono" style={{ width: 22, textAlign: "center", fontWeight: 700 }}>{l.qty}</span>
              <button className="btn sm soft" onClick={() => bump(l.key, 1)}>+</button>
              <span className="mono" style={{ width: 76, textAlign: "right" }}>{fmt(l.unit_price * l.qty)}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: 14, borderTop: "1px solid var(--line)", display: "grid", gap: 4 }}>
          <Row l={cart.tax_inclusive ? "Value before tax" : "Subtotal"} v={fmt(tot.subtotal)} />
          {tot.discount > 0 && <Row l={`Discount · ${cart.discount_reason}`} v={`−${fmt(tot.discount)}`} />}
          {tot.parts.map((p) => <Row key={p.name + p.rate} l={`${p.name} ${p.rate}%`} v={fmt(p.tax)} />)}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 }}>
            <b style={{ fontSize: 18 }}>Total</b><b className="mono" style={{ fontSize: 28 }}>{fmt(tot.due)}</b>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 8, marginTop: 8 }}>
            <button className="btn soft" disabled={!cart.lines.length} onClick={() => setCart(blank(!!t.prices_include_tax))}>Clear</button>
            <button className="btn soft" disabled={!cart.lines.length || !can(staff.user.permissions, "discount")} onClick={() => setDiscount(true)}>Discount</button>
            <button className="btn ok" disabled={!cart.lines.length} onClick={() => setPaying(true)}>Pay {fmt(tot.due)} (F2)</button>
          </div>
        </div>
      </aside>

      {pick && <Options item={pick} fmt={fmt} onClose={() => setPick(null)} onAdd={(o, note) => add(pick, o, note)} />}
      {discount && <DiscountDialog cart={cart} fmt={fmt} onClose={() => setDiscount(false)}
        onApply={(kind, value, reason) => { setCart({ ...cart, discount_kind: kind, discount_value: value, discount_reason: reason }); setDiscount(false); }} />}
      {paying && <PayDialog due={tot.due} currency={t.currency} market={t.market} onClose={() => setPaying(false)} onPaid={complete} />}
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }} className="muted"><span>{l}</span><span className="mono">{v}</span></div>;
}

function Options({ item, fmt, onClose, onAdd }: { item: Item; fmt: (v: number) => string; onClose: () => void; onAdd: (o: Opt[], note: string) => void }) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const missing = item.modifiers.filter((g) => (chosen[g.id]?.length ?? 0) < g.min);
  const opts = item.modifiers.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id)));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <b style={{ fontSize: 20 }}>{item.name}</b>
        {item.modifiers.map((g) => (
          <div key={g.id} style={{ display: "grid", gap: 8 }}>
            <b>{g.name} <span className="muted">{g.min ? "required" : "optional"}{g.max > 1 ? ` · up to ${g.max}` : ""}</span></b>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {g.options.map((o) => {
                const on = chosen[g.id]?.includes(o.id);
                return <button key={o.id} disabled={o.available === false} className={`chip ${on ? "on" : ""}`} onClick={() => setChosen((c) => {
                  const cur = c[g.id] ?? [];
                  if (cur.includes(o.id)) return { ...c, [g.id]: cur.filter((x) => x !== o.id) };
                  if (g.max === 1) return { ...c, [g.id]: [o.id] };
                  if (g.max && cur.length >= g.max) return c;
                  return { ...c, [g.id]: [...cur, o.id] };
                })}>{o.name}{o.price ? ` +${fmt(o.price)}` : ""}</button>;
              })}
            </div>
          </div>
        ))}
        <input className="input" placeholder="Note for the kitchen" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        <button className="btn" disabled={missing.length > 0} onClick={() => onAdd(opts, note.trim())}>
          {missing.length ? `Choose ${missing[0].name.toLowerCase()}` : `Add · ${fmt(item.price + opts.reduce((a, o) => a + o.price, 0))}`}</button>
      </div>
    </div>
  );
}

function DiscountDialog({ cart, fmt, onClose, onApply }: { cart: ReturnType<typeof blank>; fmt: (v: number) => string; onClose: () => void; onApply: (k: "" | "percent" | "amount", v: number, r: string) => void }) {
  const [kind, setKind] = useState<"percent" | "amount">(cart.discount_kind === "amount" ? "amount" : "percent");
  const [value, setValue] = useState(cart.discount_kind ? String(cart.discount_value) : "10");
  const [reason, setReason] = useState(cart.discount_reason);
  const gross = cart.lines.reduce((a, l) => a + l.unit_price * l.qty, 0);
  const v = Number(value) || 0;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <b style={{ fontSize: 20 }}>Discount</b>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`chip ${kind === "percent" ? "on" : ""}`} onClick={() => setKind("percent")}>Percent</button>
          <button className={`chip ${kind === "amount" ? "on" : ""}`} onClick={() => setKind("amount")}>Amount</button>
          <input className="input mono" type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 120 }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{DISCOUNT_REASONS.map((r) => <button key={r} className={`chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {cart.discount_kind && <button className="btn soft" onClick={() => onApply("", 0, "")}>Remove</button>}
          <button className="btn" style={{ flex: 1 }} disabled={!reason || v <= 0 || (kind === "percent" && v > 100)} onClick={() => onApply(kind, v, reason)}>
            Apply −{fmt(kind === "percent" ? gross * v / 100 : Math.min(v, gross))}</button>
        </div>
      </div>
    </div>
  );
}

function PayDialog({ due, currency, market, onClose, onPaid }: { due: number; currency: "INR" | "USD"; market: "IN" | "US"; onClose: () => void; onPaid: (p: Sale["payments"]) => void }) {
  const fmt = (v: number) => money(v, currency);
  const methods = market === "US" ? ["cash", "card", "tap", "other"] : ["cash", "upi", "card", "other"];
  const [payments, setPayments] = useState<Sale["payments"]>([]);
  const [method, setMethod] = useState(methods[0]);
  const [tendered, setTendered] = useState("");
  const left = Math.round((due - payments.reduce((a, p) => a + p.amount, 0)) * 100) / 100;
  const [amount, setAmount] = useState(String(due));
  const amt = Math.min(Number(amount) || 0, left);
  const cash = Number(tendered) || 0;
  const change = method === "cash" && cash ? cash - amt : 0;
  const steps = currency === "INR" ? [50, 100, 200, 500, 2000] : [5, 10, 20, 50, 100];
  const quick = [...new Set(steps.map((s) => Math.ceil(amt / s) * s))].filter((v) => v >= amt).slice(0, 4);

  function take() {
    const next = [...payments, { method, amount: amt, tendered: method === "cash" ? cash || amt : 0, at: new Date().toISOString() }];
    const rest = Math.round((due - next.reduce((a, p) => a + p.amount, 0)) * 100) / 100;
    if (rest <= 0.005) return onPaid(next);
    setPayments(next);
    setAmount(String(rest));
    setTendered("");
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="muted">{payments.length ? "Still to pay" : "Amount due"}</div>
        <div className="mono" style={{ fontSize: 44, fontWeight: 700 }}>{fmt(left)}</div>
        {payments.length > 0 && <div className="muted">Paid: {payments.map((p) => `${fmt(p.amount)} ${METHODS[p.method]}`).join(" · ")}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {methods.map((m) => <button key={m} className={`chip ${method === m ? "on" : ""}`} style={{ height: 56 }} onClick={() => setMethod(m)}>{METHODS[m]}</button>)}
        </div>
        <label className="muted">This payment (split the bill by entering less)
          <input className="input mono" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        {method === "cash" && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="chip" onClick={() => setTendered(String(amt))}>Exact</button>
              {quick.map((v) => <button key={v} className="chip mono" onClick={() => setTendered(String(v))}>{fmt(v)}</button>)}
              <input className="input mono" style={{ width: 130 }} type="number" placeholder="Received" value={tendered} onChange={(e) => setTendered(e.target.value)} autoFocus />
            </div>
            {cash > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20 }}><b>{change < 0 ? "Not enough" : "Change"}</b><b className="mono">{fmt(Math.abs(change))}</b></div>}
          </div>
        )}
        <button className="btn ok" style={{ height: 60, fontSize: 18 }} disabled={amt <= 0 || (method === "cash" && cash > 0 && cash < amt)} onClick={take}>
          {amt >= left - 0.005 ? `Done · ${fmt(amt)} by ${METHODS[method]}` : `Take ${fmt(amt)} by ${METHODS[method]}`}</button>
      </div>
    </div>
  );
}
