"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Banknote, ChefHat, CreditCard, Minus, Plus, QrCode, Search, Smartphone, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, VegDot, run, usePoll, usePos } from "./shared";

export interface MenuItem { id: string; category_id: string; name: string; price: number; is_veg: boolean; station: string; available: boolean }
export interface Category { id: string; name: string; items: MenuItem[] }
interface Line { id: string; menu_item_id: string | null; name: string; unit_price: number; qty: number; note: string; sent: boolean; done: boolean }
export interface Order {
  id: string; number: number; table: string | null; channel: string; status: string;
  subtotal: number; tax: number; tip: number; total: number; items: Line[];
}

export function OrderScreen() {
  const { s, fmt, go, orderId, payNow } = usePos();
  const { data: menu } = usePoll<Category[]>("/menu", 0);
  const [order, setOrder] = useState<Order | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [paying, setPaying] = useState(payNow);

  useEffect(() => {
    if (!orderId) return;
    api<Order>(`/orders/${orderId}`).then(setOrder).catch((e) => toast.error(e.message));
  }, [orderId]);

  useEffect(() => { if (menu && !cat) setCat(menu.find((c) => c.name === "Mains")?.id ?? menu[0]?.id ?? null); }, [menu, cat]);

  const items = useMemo(() => {
    if (!menu) return [];
    if (q) return menu.flatMap((c) => c.items).filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
    return menu.find((c) => c.id === cat)?.items ?? [];
  }, [menu, cat, q]);

  if (!orderId) return <Empty>Pick a table on the floor to start an order.</Empty>;
  if (!order) return <Empty>Loading check…</Empty>;

  const qtyOf = (id: string) => order.items.filter((l) => l.menu_item_id === id).reduce((a, l) => a + l.qty, 0);
  const unsent = order.items.filter((l) => !l.sent).reduce((a, l) => a + l.qty, 0);
  const canPay = can(s.user, "pay");
  const title = order.table ? `Table ${order.table.replace(/^T/, "")}` : `Order #${order.number}`;

  async function add(m: MenuItem) {
    if (!m.available) return toast.error(`${m.name} is out of stock`);
    const o = await run(api<Order>(`/orders/${order!.id}/items`, { body: { menu_item_id: m.id } }));
    if (o) setOrder(o);
  }
  async function setQty(l: Line, qty: number) {
    const o = await run(api<Order>(`/orders/${order!.id}/items/${l.id}`, { method: "PATCH", body: { qty } }));
    if (o) setOrder(o);
  }
  async function sendKot() {
    if (!unsent) return;
    const r = await run(api<{ kot_number: number; order: Order }>(`/orders/${order!.id}/kot`, { method: "POST" }));
    if (r) { setOrder(r.order); toast.success(`KOT ${r.kot_number} sent to kitchen · ${title}`); }
  }

  if (paying && canPay) return <PayPanel order={order} title={title} onBack={() => setPaying(false)} onDone={() => go("floor")} />;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[1fr_400px]">
      {/* Menu */}
      <section className="flex min-h-0 flex-col gap-4 overflow-hidden p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => go("floor")} className="flex items-center gap-1.5 rounded-xl bg-card px-3 py-2 text-sm font-medium ring-1 ring-border">
            <ArrowLeft className="size-4" />Floor
          </button>
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes" className="h-10 rounded-xl bg-card pl-9" />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {menu?.map((c) => (
            <button key={c.id} onClick={() => { setCat(c.id); setQ(""); }}
              className={cn("shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition",
                cat === c.id && !q ? "bg-foreground text-background" : "bg-card text-[#5d5a53] ring-1 ring-border")}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((m) => {
            const n = qtyOf(m.id);
            return (
              <button key={m.id} onClick={() => add(m)} disabled={!m.available}
                className={cn("relative flex min-h-28 flex-col rounded-2xl border bg-card p-4 text-left transition active:scale-[0.98]",
                  n ? "border-foreground" : "border-border hover:border-foreground/30", !m.available && "opacity-45")}>
                <div className="flex items-start gap-2"><VegDot veg={m.is_veg} /><span className="text-[14.5px] font-medium leading-snug">{m.name}</span></div>
                <div className="mt-auto flex items-end justify-between pt-3">
                  <span className="font-mono text-sm text-muted-foreground">{m.available ? fmt(m.price) : "86'd"}</span>
                  {n > 0 && <span className="grid size-7 place-items-center rounded-full bg-foreground font-mono text-xs font-semibold text-background">{n}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Ticket */}
      <aside className="flex min-h-0 flex-col border-t border-border bg-card lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-lg font-semibold">{title}</div>
            <div className="text-xs text-muted-foreground">Check #{order.number} · {order.items.reduce((a, l) => a + l.qty, 0)} items</div>
          </div>
          <Users className="size-5 text-muted-foreground" />
        </div>
        <div className="min-h-32 flex-1 overflow-y-auto px-5">
          {order.items.length === 0 ? (
            <Empty>Tap dishes on the left to add them to this check.</Empty>
          ) : (
            order.items.map((l) => (
              <div key={l.id} className={cn("flex items-center gap-3 border-b border-border/60 py-3", l.sent && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-medium">{l.name}</div>
                  <div className={cn("text-xs", l.sent ? "text-muted-foreground" : "text-saffron-deep")}>{l.sent ? "Sent to kitchen" : "New"}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(l, l.qty - 1)} className="grid size-8 place-items-center rounded-lg bg-muted"><Minus className="size-3.5" /></button>
                  <span className="w-6 text-center font-mono text-sm font-semibold">{l.qty}</span>
                  <button onClick={() => setQty(l, l.qty + 1)} className="grid size-8 place-items-center rounded-lg bg-muted"><Plus className="size-3.5" /></button>
                </div>
                <span className="w-20 text-right font-mono text-sm tabular">{fmt(l.unit_price * l.qty)}</span>
              </div>
            ))
          )}
        </div>
        <div className="space-y-1.5 border-t border-border px-5 py-4 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="font-mono">{fmt(order.subtotal)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>{s.tenant?.tax_label}</span><span className="font-mono">{fmt(order.tax)}</span></div>
          <div className="flex items-baseline justify-between pt-1.5"><span className="font-semibold">Total</span><span className="font-mono text-2xl font-semibold tabular">{fmt(order.subtotal + order.tax)}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 px-5 pb-5">
          <button onClick={sendKot} disabled={!unsent}
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-muted font-semibold transition disabled:opacity-35">
            <ChefHat className="size-5" />{unsent ? `Send KOT · ${unsent}` : "Nothing to send"}
          </button>
          <button disabled={!order.items.length}
            onClick={() => (canPay ? setPaying(true) : toast.success(`Bill requested for ${title} · cashier notified`))}
            className="h-14 rounded-2xl bg-foreground font-semibold text-background transition disabled:opacity-35">
            {canPay ? `Pay ${fmt(order.subtotal + order.tax)}` : "Request bill"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function PayPanel({ order, title, onBack, onDone }: { order: Order; title: string; onBack: () => void; onDone: () => void }) {
  const { s, fmt } = usePos();
  const US = s.tenant?.market === "US";
  const methods = US
    ? [{ k: "tap", l: "Tap to pay", icon: Smartphone, hint: "Guest taps phone or card on the reader" }, { k: "card", l: "Card", icon: CreditCard, hint: "Insert or swipe on the reader" }, { k: "cash", l: "Cash", icon: Banknote, hint: "Enter cash received" }]
    : [{ k: "upi", l: "UPI", icon: QrCode, hint: "Dynamic UPI QR shown on customer display" }, { k: "card", l: "Card", icon: CreditCard, hint: "Tap, insert or swipe on the card machine" }, { k: "cash", l: "Cash", icon: Banknote, hint: "Enter cash received" }];
  const [method, setMethod] = useState(methods[0].k);
  const [tipPct, setTipPct] = useState(US ? 0.2 : 0);
  const [split, setSplit] = useState(1);
  const [busy, setBusy] = useState(false);
  const pre = order.subtotal + order.tax;
  const tip = US ? Math.round(order.subtotal * tipPct * 100) / 100 : 0;
  const total = pre + tip;

  async function complete() {
    setBusy(true);
    const r = await run(api<Order>(`/orders/${order.id}/pay`, { body: { method, tip } }));
    setBusy(false);
    if (r) { toast.success(`${title} paid · ${fmt(r.total)} via ${methods.find((m) => m.k === method)?.l}`); onDone(); }
  }

  return (
    <div className="grid h-full min-h-0 overflow-y-auto lg:grid-cols-[1fr_440px]">
      <section className="flex flex-col gap-6 p-6 md:p-8">
        <button onClick={onBack} className="flex w-fit items-center gap-1.5 rounded-xl bg-card px-3 py-2 text-sm font-medium ring-1 ring-border">
          <ArrowLeft className="size-4" />Back to check
        </button>
        <div>
          <div className="text-sm text-muted-foreground">{split > 1 ? `Each of ${split} guests pays` : "Amount due"} · {title}</div>
          <div className="mt-1 font-mono text-6xl font-semibold tracking-tight tabular">{fmt(total / split)}</div>
          {split > 1 && <div className="mt-1 text-sm text-muted-foreground">Total {fmt(total)}</div>}
        </div>

        {US && (
          <div>
            <div className="mb-2.5 text-sm font-medium">Tip</div>
            <div className="grid grid-cols-4 gap-2.5">
              {[0, 0.18, 0.2, 0.22].map((p) => (
                <button key={p} onClick={() => setTipPct(p)}
                  className={cn("h-14 rounded-2xl text-[15px] font-semibold ring-1 ring-border", tipPct === p ? "bg-foreground text-background" : "bg-card")}>
                  {p ? `${Math.round(p * 100)}%` : "None"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2.5 text-sm font-medium">Split</div>
          <div className="flex w-fit items-center gap-4 rounded-2xl bg-card p-2 ring-1 ring-border">
            <button onClick={() => setSplit((n) => Math.max(1, n - 1))} className="grid size-11 place-items-center rounded-xl bg-muted"><Minus className="size-4" /></button>
            <span className="w-24 text-center font-medium">{split === 1 ? "No split" : `${split} ways`}</span>
            <button onClick={() => setSplit((n) => Math.min(12, n + 1))} className="grid size-11 place-items-center rounded-xl bg-muted"><Plus className="size-4" /></button>
          </div>
        </div>

        <div>
          <div className="mb-2.5 text-sm font-medium">Payment method</div>
          <div className="grid grid-cols-3 gap-2.5">
            {methods.map(({ k, l, icon: Icon }) => (
              <button key={k} onClick={() => setMethod(k)}
                className={cn("flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl font-semibold ring-1 ring-border", method === k ? "bg-foreground text-background" : "bg-card")}>
                <Icon className="size-5" />{l}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{methods.find((m) => m.k === method)?.hint}</p>
        </div>
      </section>

      <aside className="flex flex-col border-t border-border bg-card p-6 lg:border-l lg:border-t-0">
        <div className="text-lg font-semibold">Receipt</div>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto text-sm">
          {order.items.map((l) => (
            <div key={l.id} className="flex justify-between"><span>{l.qty} × {l.name}</span><span className="font-mono">{fmt(l.qty * l.unit_price)}</span></div>
          ))}
        </div>
        <div className="mt-4 space-y-1.5 border-t border-dashed border-border pt-4 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="font-mono">{fmt(order.subtotal)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>{s.tenant?.tax_label}</span><span className="font-mono">{fmt(order.tax)}</span></div>
          {US && <div className="flex justify-between text-muted-foreground"><span>Tip</span><span className="font-mono">{fmt(tip)}</span></div>}
          <div className="flex justify-between pt-1 text-base font-semibold"><span>Total</span><span className="font-mono">{fmt(total)}</span></div>
        </div>
        <button onClick={complete} disabled={busy} className="mt-5 h-16 rounded-2xl bg-leaf text-lg font-semibold text-white transition hover:bg-leaf/90 disabled:opacity-50">
          Complete payment
        </button>
      </aside>
    </div>
  );
}
