"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Check, Minus, Plus, ShoppingBag, X } from "lucide-react";
import { api, money } from "@/lib/api";
import { allergenList } from "@/lib/menu";
import { cn } from "@/lib/utils";

/* Self-order kiosk: a touch screen at the counter. Browse, build an order, give a name, pay at the till. */

interface Opt { id: string; name: string; price: number; available?: boolean }
interface Group { id: string; name: string; min: number; max: number; options: Opt[] }
interface Item { id: string; name: string; price: number; is_veg: boolean; modifiers: Group[]; description?: string; tags?: string[]; allergens?: string[] }
interface Cat { id: string; name: string; items: Item[] }
interface View { restaurant: { name: string; location_name: string; currency: "INR" | "USD"; tax_label: string; auto_send: boolean; prices_include_tax?: boolean }; menu: Cat[] }
interface CartLine { key: string; item: Item; qty: number; options: Opt[] }
interface Placed { number: number; due: number; sent_to_kitchen: boolean }

const IDLE_MS = 90_000; // an abandoned order clears itself
const DONE_MS = 20_000;

export default function Kiosk() {
  const { token } = useParams<{ token: string }>();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pick, setPick] = useState<Item | null>(null);
  const [step, setStep] = useState<"menu" | "review" | "done">("menu");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [touched, setTouched] = useState(() => Date.now());

  const load = useCallback(async () => {
    try { setV(await api<View>(`/kiosk/${token}`, { token: null })); setError(""); } catch (e) { setError((e as Error).message); }
  }, [token]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const reset = useCallback(() => { setCart([]); setName(""); setStep("menu"); setPlaced(null); setPick(null); setCat(null); }, []);
  useEffect(() => {
    const t = setInterval(() => {
      const idle = Date.now() - touched;
      if ((step === "done" && idle > DONE_MS) || (step !== "done" && cart.length && idle > IDLE_MS)) reset();
    }, 3000);
    return () => clearInterval(t);
  }, [touched, step, cart.length, reset]);

  const fmt = useCallback((n: number) => money(n, { currency: v?.restaurant.currency ?? "USD" }), [v]);
  const active = cat ?? v?.menu[0]?.id ?? null;
  const shown = useMemo(() => v?.menu.find((c) => c.id === active)?.items ?? [], [v, active]);
  const unit = (l: CartLine) => l.item.price + l.options.reduce((a, o) => a + o.price, 0);
  const total = cart.reduce((a, l) => a + l.qty * unit(l), 0);
  const count = cart.reduce((a, l) => a + l.qty, 0);

  function add(item: Item, options: Opt[] = []) {
    const key = `${item.id}|${options.map((o) => o.id).sort().join(",")}`;
    setCart((c) => c.some((l) => l.key === key) ? c.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + 1) } : l)) : [...c, { key, item, qty: 1, options }]);
    setPick(null);
  }
  const bump = (key: string, d: number) => setCart((c) => c.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0));

  async function place() {
    setBusy(true);
    try {
      const r = await api<Placed>(`/kiosk/${token}/order`, { token: null, body: { name, items: cart.map((l) => ({ menu_item_id: l.item.id, qty: l.qty, modifier_ids: l.options.map((o) => o.id) })) } });
      setPlaced(r); setStep("done"); setCart([]);
    } catch (e) { setError((e as Error).message); setTimeout(() => setError(""), 5000); load(); }
    setBusy(false);
  }

  if (!v) return <div className="grid min-h-dvh place-items-center bg-background p-8 text-center text-lg text-muted-foreground">{error || "Loading…"}</div>;

  return (
    <div className="flex h-dvh select-none flex-col bg-background" onPointerDown={() => setTouched(Date.now())}>
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-4">
        <div><div className="text-2xl font-semibold">{v.restaurant.name}</div>{v.restaurant.location_name && <div className="text-sm text-muted-foreground">{v.restaurant.location_name}</div>}</div>
        {step === "menu" && count > 0 && <button onClick={() => reset()} className="text-base text-muted-foreground">Start over</button>}
      </header>
      {error && <div className="bg-destructive px-6 py-3 text-center font-medium text-white">{error}</div>}

      {step === "done" && placed ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div>
            <Check className="mx-auto size-20 text-leaf" strokeWidth={1.5} />
            <div className="mt-4 text-2xl text-muted-foreground">Thank you{name ? `, ${name}` : ""}! Your order number is</div>
            <div className="mt-2 font-mono text-[120px] font-semibold leading-none">{placed.number}</div>
            <div className="mt-6 text-2xl">Please pay <b className="font-mono">{fmt(placed.due)}</b> at the counter.</div>
            <div className="mt-2 text-lg text-muted-foreground">{placed.sent_to_kitchen ? "Your food is being prepared. We'll call your number." : "We'll start your food as soon as you've paid."}</div>
            <button onClick={reset} className="mt-10 h-16 rounded-2xl bg-foreground px-10 text-xl font-semibold text-background">New order</button>
          </div>
        </div>
      ) : step === "review" ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto p-6">
          <div className="text-2xl font-semibold">Your order</div>
          {cart.map((l) => (
            <div key={l.key} className="flex items-center gap-4 rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="min-w-0 flex-1"><div className="text-lg font-medium">{l.item.name}</div>{l.options.length > 0 && <div className="text-sm text-muted-foreground">{l.options.map((o) => o.name).join(" · ")}</div>}</div>
              <div className="flex items-center gap-3">
                <button onClick={() => bump(l.key, -1)} className="grid size-12 place-items-center rounded-xl bg-muted"><Minus className="size-5" /></button>
                <span className="w-8 text-center font-mono text-xl font-semibold">{l.qty}</span>
                <button onClick={() => bump(l.key, 1)} className="grid size-12 place-items-center rounded-xl bg-muted"><Plus className="size-5" /></button>
              </div>
              <span className="w-28 text-right font-mono text-lg">{fmt(unit(l) * l.qty)}</span>
            </div>
          ))}
          <div className="flex justify-between text-xl font-semibold"><span>{v.restaurant.prices_include_tax ? "Total" : `Total before ${v.restaurant.tax_label || "tax"}`}</span><span className="font-mono">{fmt(total)}</span></div>
          <label className="mt-2 block space-y-2"><span className="text-lg font-medium">Your name, so we can call you</span>
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} autoFocus className="h-16 w-full rounded-2xl border border-input bg-card px-5 text-2xl" /></label>
          <div className="mt-auto grid grid-cols-[auto_1fr] gap-3 pt-4">
            <button onClick={() => setStep("menu")} className="h-16 rounded-2xl bg-muted px-8 text-lg font-semibold">Add more</button>
            <button disabled={!cart.length || !name.trim() || busy} onClick={place} className="h-16 rounded-2xl bg-leaf text-xl font-semibold text-white disabled:opacity-40">{busy ? "Placing…" : `Place order · ${fmt(total)}`}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-3 overflow-x-auto border-b border-border px-6 py-4">
            {v.menu.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} className={cn("shrink-0 rounded-2xl px-6 py-3 text-lg font-medium", active === c.id ? "bg-foreground text-background" : "bg-card ring-1 ring-border")}>{c.name}</button>
            ))}
          </div>
          <main className="grid flex-1 auto-rows-min grid-cols-2 gap-4 overflow-y-auto p-6 md:grid-cols-3 xl:grid-cols-4">
            {shown.map((i) => (
              <button key={i.id} onClick={() => (i.modifiers.length ? setPick(i) : add(i))} className="flex min-h-40 flex-col rounded-3xl bg-card p-5 text-left ring-1 ring-border active:scale-[0.98]">
                <span className="flex items-start gap-2 text-lg font-semibold leading-snug">
                  <span className={cn("mt-1.5 size-3 shrink-0 rounded-full", i.is_veg ? "bg-leaf" : "bg-chili")} />{i.name}</span>
                {i.description && <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">{i.description}</span>}
                {!!i.allergens?.length && <span className="mt-1 text-xs text-chili">Contains {allergenList(i.allergens)}</span>}
                <span className="mt-auto flex items-center justify-between pt-3"><span className="font-mono text-lg">{fmt(i.price)}</span><span className="grid size-10 place-items-center rounded-xl bg-foreground text-background"><Plus className="size-5" /></span></span>
              </button>
            ))}
          </main>
          {count > 0 && (
            <div className="border-t border-border bg-card p-4">
              <button onClick={() => setStep("review")} className="flex h-16 w-full items-center justify-between rounded-2xl bg-foreground px-6 text-xl font-semibold text-background">
                <span className="flex items-center gap-3"><ShoppingBag className="size-6" />{count} item{count === 1 ? "" : "s"}</span><span>Review order · {fmt(total)}</span>
              </button>
            </div>
          )}
        </>
      )}

      {pick && <Options item={pick} fmt={fmt} onClose={() => setPick(null)} onAdd={(opts) => add(pick, opts)} />}
    </div>
  );
}

function Options({ item, fmt, onClose, onAdd }: { item: Item; fmt: (n: number) => string; onClose: () => void; onAdd: (o: Opt[]) => void }) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const toggle = (g: Group, o: Opt) => setChosen((c) => {
    const cur = c[g.id] ?? [];
    if (cur.includes(o.id)) return { ...c, [g.id]: cur.filter((x) => x !== o.id) };
    if (g.max === 1) return { ...c, [g.id]: [o.id] };
    if (g.max && cur.length >= g.max) return c;
    return { ...c, [g.id]: [...cur, o.id] };
  });
  const missing = item.modifiers.filter((g) => (chosen[g.id]?.length ?? 0) < g.min);
  const opts = item.modifiers.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id)));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-background p-6 sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between"><div className="text-2xl font-semibold">{item.name}</div><button onClick={onClose}><X className="size-7" /></button></div>
        {item.modifiers.map((g) => (
          <div key={g.id} className="mb-5">
            <div className="mb-2 text-lg font-semibold">{g.name} <span className="text-sm font-normal text-muted-foreground">{g.min ? "required" : "optional"}{g.max > 1 ? ` · up to ${g.max}` : ""}</span></div>
            <div className="grid grid-cols-2 gap-2">
              {g.options.map((o) => {
                const on = chosen[g.id]?.includes(o.id);
                return (
                  <button key={o.id} disabled={o.available === false} onClick={() => toggle(g, o)}
                    className={cn("flex min-h-16 items-center justify-between rounded-2xl px-4 text-left text-lg ring-1 disabled:opacity-40", on ? "bg-accent ring-2 ring-saffron" : "bg-card ring-border")}>
                    <span>{o.name}</span><span className="font-mono text-base text-muted-foreground">{o.available === false ? "Sold out" : o.price ? `+${fmt(o.price)}` : ""}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button disabled={missing.length > 0} onClick={() => onAdd(opts)} className="h-16 w-full rounded-2xl bg-foreground text-xl font-semibold text-background disabled:opacity-40">
          {missing.length ? `Choose ${missing[0].name.toLowerCase()}` : `Add · ${fmt(item.price + opts.reduce((a, o) => a + o.price, 0))}`}
        </button>
      </div>
    </div>
  );
}
