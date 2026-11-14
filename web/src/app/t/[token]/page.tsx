"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { BellRing, Check, Minus, Plus, ReceiptText, ShoppingBag, X } from "lucide-react";
import { api, money } from "@/lib/api";
import { cn } from "@/lib/utils";
import { allergenList, nutritionLine, type Nutrition } from "@/lib/menu";

/* Guest page for a table's QR code: menu, the table's check, order more, call a waiter, ask for the bill. */

interface Opt { id: string; name: string; price: number }
interface Group { id: string; name: string; min: number; max: number; options: Opt[] }
interface Item {
  id: string; name: string; price: number; is_veg: boolean; modifiers: Group[];
  description?: string; tags?: string[]; allergens?: string[]; nutrition?: Nutrition;
}
interface Cat { id: string; name: string; items: Item[] }
interface CheckLine { name: string; qty: number; modifiers: string[]; note: string; line_total: number; sent: boolean; done: boolean }
interface Check { number: number; subtotal: number; discount: number; tax: number; due: number; paid: number; balance: number; items: CheckLine[] }
interface View {
  restaurant: { name: string; location_name: string; currency: "INR" | "USD"; tax_label: string; tax_rate: number; auto_send: boolean };
  table: { name: string; seats: number };
  menu: Cat[];
  check: Check | null;
  open_requests: string[];
}
interface CartLine { key: string; item: Item; qty: number; options: Opt[]; note: string }

export default function GuestTable() {
  const { token } = useParams<{ token: string }>();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pick, setPick] = useState<Item | null>(null);
  const [sheet, setSheet] = useState<"cart" | "check" | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try {
      setV(await api<View>(`/guest/${token}`, { token: null }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    try { setName(localStorage.getItem("tiffin.guest.name") ?? ""); } catch { /* private mode */ }
  }, []);

  const fmt = useCallback((n: number) => money(n, { currency: v?.restaurant.currency ?? "USD" }), [v]);
  const cartTotal = cart.reduce((a, l) => a + l.qty * (l.item.price + l.options.reduce((s, o) => s + o.price, 0)), 0);
  const cartCount = cart.reduce((a, l) => a + l.qty, 0);
  const active = cat ?? v?.menu[0]?.id ?? null;
  const shown = useMemo(() => v?.menu.find((c) => c.id === active)?.items ?? [], [v, active]);

  function say(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(""), 3500);
  }

  function add(item: Item, options: Opt[] = [], note = "") {
    const key = `${item.id}|${options.map((o) => o.id).sort().join(",")}|${note}`;
    setCart((c) => {
      const hit = c.find((l) => l.key === key);
      return hit ? c.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + 1) } : l)) : [...c, { key, item, qty: 1, options, note }];
    });
    say(`${item.name} added`);
  }

  async function order() {
    if (!cart.length) return;
    setBusy(true);
    try {
      try { if (name.trim()) localStorage.setItem("tiffin.guest.name", name.trim()); } catch { /* private mode */ }
      const r = await api<{ sent_to_kitchen: boolean; check: Check }>(`/guest/${token}/order`, {
        token: null,
        body: { name: name.trim(), items: cart.map((l) => ({ menu_item_id: l.item.id, qty: l.qty, modifier_ids: l.options.map((o) => o.id), note: l.note })) },
      });
      setCart([]);
      setSheet(null);
      setV((cur) => cur && { ...cur, check: r.check });
      say(r.sent_to_kitchen ? "Order sent to the kitchen" : "Order received. Your server will confirm it shortly.");
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ask(kind: "waiter" | "bill") {
    try {
      const r = await api<{ already: boolean }>(`/guest/${token}/request`, { token: null, body: { kind } });
      say(r.already ? "We've already let your server know" : kind === "bill" ? "Your server will bring the bill" : "Your server is on the way");
      load();
    } catch (e) {
      say((e as Error).message);
    }
  }

  if (error && !v) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-8 text-center">
        <div><div className="text-lg font-semibold">This code isn&apos;t working</div><p className="mt-2 text-sm text-muted-foreground">{error}</p></div>
      </div>
    );
  }
  if (!v) return <div className="grid min-h-dvh place-items-center bg-background text-sm text-muted-foreground">Loading the menu…</div>;

  const asked = new Set(v.open_requests);
  return (
    <div className="min-h-dvh bg-background pb-28">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-saffron text-lg font-bold text-[#1d1c1a]">t</span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{v.restaurant.name}{v.restaurant.location_name && <span className="font-normal text-muted-foreground"> · {v.restaurant.location_name}</span>}</div>
            <div className="text-xs text-muted-foreground">Table {v.table.name.replace(/^T/, "")}</div>
          </div>
          {v.check && v.check.items.length > 0 && (
            <button onClick={() => setSheet("check")} className="flex h-9 items-center gap-1.5 rounded-xl bg-card px-3 text-sm font-medium ring-1 ring-border">
              <ReceiptText className="size-4" />{fmt(v.check.due)}
            </button>
          )}
        </div>
        <div className="mx-auto flex max-w-xl gap-2 overflow-x-auto px-4 pb-3">
          {v.menu.map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium", active === c.id ? "bg-foreground text-background" : "bg-card ring-1 ring-border")}>
              {c.name}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto grid max-w-xl gap-2.5 px-4 pt-4">
        {shown.map((i) => (
          <div key={i.id} className="flex items-center gap-3 rounded-2xl bg-card p-3.5 ring-1 ring-border">
            <span className={cn("grid size-4 shrink-0 place-items-center rounded-[3px] border-[1.5px]", i.is_veg ? "border-leaf" : "border-chili")}>
              <span className={cn("size-1.5 rounded-full", i.is_veg ? "bg-leaf" : "bg-chili")} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{i.name}</div>
              {!!i.tags?.length && (
                <div className="mt-0.5 flex flex-wrap gap-1">{i.tags.slice(0, 3).map((t) => <span key={t} className="rounded-full bg-muted px-2 text-[11px] font-medium text-muted-foreground">{t}</span>)}</div>
              )}
              {i.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.description}</p>}
              <div className="text-sm text-muted-foreground">{fmt(i.price)}{i.modifiers.length ? " · options" : ""}{nutritionLine(i.nutrition) ? ` · ${nutritionLine(i.nutrition)}` : ""}</div>
              {!!i.allergens?.length && <div className="text-[11px] text-chili">Contains {allergenList(i.allergens)}</div>}
            </div>
            <button onClick={() => (i.modifiers.length ? setPick(i) : add(i))} aria-label={`Add ${i.name}`}
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-background"><Plus className="size-5" /></button>
          </div>
        ))}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button onClick={() => ask("waiter")} disabled={asked.has("waiter")}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-card text-sm font-semibold ring-1 ring-border disabled:opacity-60">
            <BellRing className="size-4" />{asked.has("waiter") ? "Server on the way" : "Call server"}
          </button>
          <button onClick={() => ask("bill")} disabled={asked.has("bill") || !v.check?.items.length}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-card text-sm font-semibold ring-1 ring-border disabled:opacity-60">
            <ReceiptText className="size-4" />{asked.has("bill") ? "Bill on its way" : "Ask for the bill"}
          </button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">Prices before {v.restaurant.tax_label || "tax"}. {v.restaurant.auto_send ? "Orders go straight to the kitchen." : "Your server confirms each order."}</p>
      </main>

      {cartCount > 0 && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur">
          <button onClick={() => setSheet("cart")} className="mx-auto flex h-13 w-full max-w-xl items-center justify-between rounded-2xl bg-foreground px-5 py-3.5 font-semibold text-background">
            <span className="flex items-center gap-2"><ShoppingBag className="size-5" />{cartCount} item{cartCount === 1 ? "" : "s"}</span>
            <span>Review order · {fmt(cartTotal)}</span>
          </button>
        </div>
      )}

      {flash && <div className="fixed inset-x-4 top-4 z-50 mx-auto max-w-md rounded-xl bg-foreground px-4 py-3 text-center text-sm font-medium text-background shadow-lg">{flash}</div>}

      {pick && <OptionsSheet item={pick} fmt={fmt} onClose={() => setPick(null)} onAdd={(opts, note) => { add(pick, opts, note); setPick(null); }} />}

      {sheet && (
        <Sheet onClose={() => setSheet(null)} title={sheet === "cart" ? "Your order" : `Table ${v.table.name.replace(/^T/, "")} · check`}>
          {sheet === "cart" ? (
            <div className="grid gap-3">
              {cart.map((l) => (
                <div key={l.key} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{l.item.name}</div>
                    {(l.options.length > 0 || l.note) && <div className="text-xs text-muted-foreground">{[...l.options.map((o) => o.name), l.note && `“${l.note}”`].filter(Boolean).join(" · ")}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCart((c) => c.flatMap((x) => (x.key !== l.key ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : [])))} className="grid size-8 place-items-center rounded-lg bg-muted"><Minus className="size-4" /></button>
                    <span className="w-5 text-center font-mono">{l.qty}</span>
                    <button onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.min(20, x.qty + 1) } : x)))} className="grid size-8 place-items-center rounded-lg bg-muted"><Plus className="size-4" /></button>
                  </div>
                </div>
              ))}
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Your name (optional)"
                className="h-11 rounded-xl border border-input bg-card px-3 text-sm" />
              <button onClick={order} disabled={busy} className="h-12 rounded-2xl bg-foreground font-semibold text-background disabled:opacity-50">
                {busy ? "Sending…" : `Place order · ${fmt(cartTotal)}`}
              </button>
            </div>
          ) : v.check && (
            <div className="grid gap-2 text-sm">
              {v.check.items.map((l, k) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    {l.qty} × {l.name}
                    {l.modifiers.length > 0 && <span className="block text-xs text-muted-foreground">{l.modifiers.join(", ")}</span>}
                    <span className={cn("block text-xs", l.done ? "text-[oklch(0.45_0.12_150)]" : l.sent ? "text-saffron-deep" : "text-muted-foreground")}>
                      {l.done ? "Served" : l.sent ? "Being prepared" : "Waiting for your server"}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono">{fmt(l.line_total)}</span>
                </div>
              ))}
              <div className="mt-2 border-t border-border pt-2">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">{fmt(v.check.subtotal)}</span></div>
                {v.check.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="font-mono">−{fmt(v.check.discount)}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">{v.restaurant.tax_label || "Tax"}</span><span className="font-mono">{fmt(v.check.tax)}</span></div>
                <div className="mt-1 flex justify-between text-base font-semibold"><span>Total</span><span className="font-mono">{fmt(v.check.due)}</span></div>
                {v.check.paid > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Still to pay</span><span className="font-mono">{fmt(v.check.balance)}</span></div>}
              </div>
              <button onClick={() => { ask("bill"); setSheet(null); }} disabled={asked.has("bill")} className="mt-2 h-12 rounded-2xl bg-foreground font-semibold text-background disabled:opacity-50">
                {asked.has("bill") ? "Bill on its way" : "Ask for the bill"}
              </button>
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div onClick={(e) => e.stopPropagation()} className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-background p-5">
        <div className="mx-auto max-w-xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-lg font-semibold">{title}</div>
            <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-muted" aria-label="Close"><X className="size-4" /></button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function OptionsSheet({ item, fmt, onClose, onAdd }: { item: Item; fmt: (n: number) => string; onClose: () => void; onAdd: (opts: Opt[], note: string) => void }) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [note, setNote] = useState("");
  const toggle = (g: Group, o: Opt) => setChosen((c) => {
    const cur = c[g.id] ?? [];
    if (g.max === 1) return { ...c, [g.id]: [o.id] };
    if (cur.includes(o.id)) return { ...c, [g.id]: cur.filter((x) => x !== o.id) };
    if (g.max && cur.length >= g.max) return c;
    return { ...c, [g.id]: [...cur, o.id] };
  });
  const missing = item.modifiers.filter((g) => (chosen[g.id]?.length ?? 0) < g.min);
  const opts = item.modifiers.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id)));
  const price = item.price + opts.reduce((a, o) => a + o.price, 0);
  return (
    <Sheet title={item.name} onClose={onClose}>
      <div className="grid gap-4">
        {item.modifiers.map((g) => (
          <div key={g.id}>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">{g.name}</span>
              <span className="text-xs text-muted-foreground">{g.min ? "Required" : "Optional"}{g.max > 1 ? ` · up to ${g.max}` : ""}</span>
            </div>
            <div className="grid gap-1.5">
              {g.options.map((o) => {
                const on = chosen[g.id]?.includes(o.id);
                return (
                  <button key={o.id} onClick={() => toggle(g, o)}
                    className={cn("flex items-center justify-between rounded-xl px-3.5 py-3 text-left text-sm ring-1", on ? "bg-accent ring-2 ring-saffron" : "bg-card ring-border")}>
                    <span className="flex items-center gap-2">{on && <Check className="size-4" />}{o.name}</span>
                    {o.price > 0 && <span className="font-mono text-muted-foreground">+{fmt(o.price)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="Note for the kitchen (optional)"
          className="h-11 rounded-xl border border-input bg-card px-3 text-sm" />
        <button disabled={missing.length > 0} onClick={() => onAdd(opts, note.trim())}
          className="h-12 rounded-2xl bg-foreground font-semibold text-background disabled:opacity-40">
          {missing.length ? `Choose ${missing[0].name.toLowerCase()}` : `Add · ${fmt(price)}`}
        </button>
      </div>
    </Sheet>
  );
}
