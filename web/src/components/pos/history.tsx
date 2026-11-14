"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileMinus, Minus, Plus, Printer, RotateCcw, Search, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, can, hasModule } from "@/lib/api";
import { cn } from "@/lib/utils";
import { printCreditNote } from "./print";
import { printOrder } from "./print-host";
import { Empty, METHOD_LABEL, STATUS_TONE, Seg, orderTitle, payMethods, run, usePoll, usePos } from "./shared";
import type { Order } from "./types";
import { ActivityList, type AuditRow } from "./activity";

interface Row {
  id: string; number: number; table: string | null; channel: string; status: string; customer_name: string;
  total: number; refunded: number; payment_method: string; items: number; opened_at: string; closed_at: string | null;
}

const REFUND_REASONS = ["Wrong order", "Cold food", "Guest complaint", "Overcharged", "Duplicate payment"];
/** Today's date (YYYY-MM-DD) in the restaurant's time zone, not the device's. */
const todayIn = (tz?: string) => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined }).format(new Date()); }
  catch { return new Intl.DateTimeFormat("en-CA").format(new Date()); }
};
let zone: string | undefined;
const time = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }); }
  catch { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
};
const channelLabel = (c: string) => ({ dine_in: "Dine-in", takeaway: "Takeaway" } as Record<string, string>)[c] ?? c.replace(/^\w/, (x) => x.toUpperCase());

export function OrdersScreen() {
  const { s, fmt, go } = usePos();
  zone = s.tenant?.timezone || undefined;
  const today = () => todayIn(s.tenant?.timezone);
  const [day, setDay] = useState(today);
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Order | null>(null);
  const [refunding, setRefunding] = useState(false);
  const { data: activity } = usePoll<AuditRow[]>(sel && can(s.user, "reports") ? `/audit?order_id=${sel.id}` : null, 0, "audit");
  const { data: rows, reload } = usePoll<Row[]>(`/orders?day=${day}&status=${status}&q=${encodeURIComponent(query)}`, 15000, "orders");

  useEffect(() => { const t = setTimeout(() => setQuery(q), 300); return () => clearTimeout(t); }, [q]);

  async function openOrder(id: string) {
    const o = await run(api<Order>(`/orders/${id}`));
    if (o) setSel(o);
  }
  async function reopen() {
    if (!sel) return;
    const o = await run(api<Order>(`/orders/${sel.id}/reopen`, { method: "POST" }), `Check #${sel.number} reopened`);
    if (o) go("order", { orderId: o.id });
  }

  const totals = (rows ?? []).filter((r) => r.status === "paid" || r.status === "refunded")
    .reduce((a, r) => ({ n: a.n + 1, v: a.v + r.total - r.refunded }), { n: 0, v: 0 });

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_420px]">
      <div className="flex min-h-0 flex-col gap-4 overflow-auto p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value || today())} className="h-10 w-44 bg-card" />
          <Seg value={status} onChange={setStatus} options={[["all", "All"], ["open", "Open"], ["paid", "Paid"], ["refunded", "Refunded"], ["void", "Void"]]} />
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Check #, table, name or phone" className="h-10 bg-card pl-9" />
          </div>
        </div>
        <div className="text-sm text-muted-foreground">{totals.n} paid checks · <span className="font-mono font-medium text-foreground">{fmt(totals.v)}</span> collected</div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="hidden grid-cols-[70px_1fr_110px_90px_110px] gap-3 border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground md:grid">
            <span>Check</span><span>Where</span><span>Status</span><span>Time</span><span className="text-right">Total</span>
          </div>
          {rows?.length === 0 && <Empty>No checks for this day.</Empty>}
          {rows?.map((r) => (
            <button key={r.id} onClick={() => openOrder(r.id)}
              className={cn("grid w-full grid-cols-[60px_1fr_auto] items-center gap-3 border-b border-border/60 px-5 py-3.5 text-left last:border-0 hover:bg-muted/40 md:grid-cols-[70px_1fr_110px_90px_110px]",
                sel?.id === r.id && "bg-accent/60")}>
              <span className="font-mono font-semibold">#{r.number}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.table ?? channelLabel(r.channel)}{r.customer_name ? ` · ${r.customer_name}` : ""}</span>
                <span className="text-xs text-muted-foreground">{r.items} items{r.payment_method ? ` · ${METHOD_LABEL[r.payment_method] ?? r.payment_method}` : ""}</span>
              </span>
              <span className="hidden md:block"><span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold capitalize", STATUS_TONE[r.status] ?? "bg-muted")}>{r.status}</span></span>
              <span className="hidden font-mono text-sm text-muted-foreground md:block">{time(r.opened_at)}</span>
              <span className="text-right font-mono text-sm font-semibold">{fmt(r.total)}{r.refunded > 0 && <span className="block text-xs font-normal text-saffron-deep">−{fmt(r.refunded)}</span>}</span>
            </button>
          ))}
        </div>
      </div>

      <aside className={cn("flex min-h-0 flex-col border-t border-border bg-card lg:border-l lg:border-t-0", !sel && "hidden lg:flex")}>
        {!sel ? (
          <Empty>Pick a check to see its items and payments, reprint it or refund it.</Empty>
        ) : (
          <>
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <div className="text-lg font-semibold">{orderTitle(sel)} · #{sel.number}</div>
                <div className="text-xs text-muted-foreground">
                  Opened {time(sel.opened_at)}{sel.closed_at ? ` · closed ${time(sel.closed_at)}` : ""}{sel.void_reason ? ` · ${sel.void_reason}` : ""}
                </div>
              </div>
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold capitalize", STATUS_TONE[sel.status] ?? "bg-muted")}>{sel.status}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4 text-sm">
              {sel.items.map((l) => (
                <div key={l.id} className="flex justify-between gap-3">
                  <span>{l.qty} × {l.name}
                    {!!l.returned_qty && <span className="ml-1.5 rounded bg-saffron/20 px-1.5 text-[11px] font-medium text-saffron-deep">{l.returned_qty} returned</span>}
                    {l.modifiers.length > 0 && <span className="block text-xs text-muted-foreground">{l.modifiers.map((m) => m.name).join(" · ")}</span>}
                    {l.comp_reason && <span className="block text-xs text-saffron-deep">Comp · {l.comp_reason}</span>}
                  </span>
                  <span className="font-mono">{l.comp_reason ? "—" : fmt(l.line_total)}</span>
                </div>
              ))}
              <div className="space-y-1 border-t border-dashed border-border pt-3 text-muted-foreground">
                <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{fmt(sel.subtotal)}</span></div>
                {sel.discount.amount > 0 && <div className="flex justify-between text-saffron-deep"><span>Discount · {sel.discount.reason}</span><span className="font-mono">−{fmt(sel.discount.amount)}</span></div>}
                <div className="flex justify-between"><span>{s.tenant?.tax_label || "Tax"}</span><span className="font-mono">{fmt(sel.tax)}</span></div>
                {sel.tip > 0 && <div className="flex justify-between"><span>Tips</span><span className="font-mono">{fmt(sel.tip)}</span></div>}
                <div className="flex justify-between pt-1 text-base font-semibold text-foreground"><span>Total</span><span className="font-mono">{fmt(sel.total)}</span></div>
              </div>
              {sel.payments.length > 0 && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <div className="font-medium">Payments</div>
                  {sel.payments.map((p) => (
                    <div key={p.id} className={cn("flex justify-between gap-3", p.kind === "refund" && "text-saffron-deep")}>
                      <span>{p.kind === "refund" ? `Refund · ${p.reason}` : METHOD_LABEL[p.method] ?? p.method}{p.kind === "refund" ? ` · ${METHOD_LABEL[p.method] ?? p.method}` : ""} · {time(p.created_at)}</span>
                      <span className="font-mono">{p.kind === "refund" ? "−" : ""}{fmt(p.amount + p.tip)}</span>
                    </div>
                  ))}
                </div>
              )}
              {!!sel.credit_notes?.length && (
                <div className="space-y-1.5 border-t border-border pt-3">
                  <div className="font-medium">Credit notes</div>
                  {sel.credit_notes.map((cn) => (
                    <div key={cn.id} className="flex items-center gap-3">
                      <FileMinus className="size-4 shrink-0 text-saffron-deep" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{cn.label} · {fmt(cn.amount)}</div>
                        <div className="truncate text-xs text-muted-foreground">{time(cn.created_at)} · {cn.reason}{cn.lines.length ? ` · ${cn.lines.map((l) => `${l.qty} × ${l.name}`).join(", ")}` : ""}{cn.restocked ? " · restocked" : ""}</div>
                      </div>
                      <button onClick={() => printCreditNote(cn, sel, s.tenant, fmt)} className="rounded-lg bg-muted px-2.5 py-1 text-xs font-semibold">Print</button>
                    </div>
                  ))}
                </div>
              )}
              {!!activity?.length && (
                <div className="border-t border-border pt-3">
                  <div className="font-medium">Activity</div>
                  <ActivityList rows={activity} fmt={fmt} tz={s.tenant?.timezone} compact />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5 border-t border-border p-5">
              <button onClick={() => void run(printOrder(sel, s.tenant, fmt, sel.status === "open" ? "bill" : "receipt")).then((p) => p && toast.success(`Sent to ${p}`))}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-muted font-semibold"><Printer className="size-4" />Reprint</button>
              {sel.status === "open" ? (
                <button onClick={() => go("order", { orderId: sel.id })} className="h-12 rounded-xl bg-foreground font-semibold text-background">Open check</button>
              ) : sel.status === "paid" && !sel.refunded && can(s.user, "refund") ? (
                <button onClick={reopen} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-muted font-semibold"><RotateCcw className="size-4" />Reopen</button>
              ) : <span />}
              {(sel.status === "paid" || sel.status === "refunded") && can(s.user, "refund") && sel.paid + sel.tip - sel.refunded > 0.005 && (
                <button onClick={() => setRefunding(true)} className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-destructive/10 font-semibold text-destructive">
                  <Undo2 className="size-4" />Refund
                </button>
              )}
            </div>
          </>
        )}
      </aside>

      {refunding && sel && (
        <RefundDialog order={sel} onClose={() => setRefunding(false)}
          onDone={(o) => { setSel(o); setRefunding(false); reload(); toast.success(`Refunded on check #${o.number}`); }} />
      )}
    </div>
  );
}

function RefundDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (o: Order) => void }) {
  const { s, fmt } = usePos();
  const left = Math.round((order.paid + order.tip - order.refunded) * 100) / 100;
  const firstMethod = order.payments.find((p) => p.kind === "payment")?.method ?? "cash";
  const methods = [...new Set([firstMethod, ...payMethods(s.tenant)])];
  const [amount, setAmount] = useState(String(left));
  const [method, setMethod] = useState(firstMethod);
  const [reason, setReason] = useState("");
  const [back, setBack] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(false);
  const v = Number(amount) || 0;
  const returnable = order.items.filter((l) => !l.comp_reason && l.qty - (l.returned_qty ?? 0) > 0);
  // Returned items are valued at what the guest paid for them: their share of the check after discount, with tax.
  const ratio = order.subtotal ? order.due / order.subtotal : 1;
  const picked = Object.entries(back).filter(([, n]) => n > 0);
  const itemsValue = Math.round(picked.reduce((a, [id, n]) => {
    const l = order.items.find((x) => x.id === id)!;
    return a + (l.line_total / l.qty) * n * ratio;
  }, 0) * 100) / 100;

  function setQty(id: string, n: number) {
    const next = { ...back, [id]: n };
    setBack(next);
    const value = Object.entries(next).reduce((a, [lid, k]) => {
      const l = order.items.find((x) => x.id === lid)!;
      return a + (l.line_total / l.qty) * k * ratio;
    }, 0);
    setAmount(String(Math.min(left, Math.round(value * 100) / 100) || left));
  }

  async function refund() {
    const lines = picked.map(([line_id, qty]) => ({ line_id, qty }));
    const o = await run(api<Order>(`/orders/${order.id}/refund`, { body: { amount: v, method, reason, lines, restock: restock && lines.length > 0 } }));
    if (o) onDone(o);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Refund check #{order.number}</DialogTitle>
          <DialogDescription>Up to {fmt(left)} can be refunded. A numbered credit note is issued for it. Cash refunds come out of the drawer.</DialogDescription>
        </DialogHeader>
        {returnable.length > 0 && (
          <div className="space-y-2">
            <Label>Items handed back (optional)</Label>
            <div className="space-y-1.5">
              {returnable.map((l) => {
                const max = l.qty - (l.returned_qty ?? 0);
                const n = back[l.id] ?? 0;
                return (
                  <div key={l.id} className={cn("flex items-center gap-3 rounded-xl px-3 py-2 ring-1", n ? "ring-foreground" : "ring-border")}>
                    <span className="min-w-0 flex-1 truncate text-sm">{l.name}<span className="text-xs text-muted-foreground"> · {max} left</span></span>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => setQty(l.id, Math.max(0, n - 1))} className="grid size-8 place-items-center rounded-lg bg-muted"><Minus className="size-3.5" /></button>
                      <span className="w-6 text-center font-mono text-sm font-semibold">{n}</span>
                      <button type="button" onClick={() => setQty(l.id, Math.min(max, n + 1))} className="grid size-8 place-items-center rounded-lg bg-muted"><Plus className="size-3.5" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
            {picked.length > 0 && <p className="text-xs text-muted-foreground">Items worth {fmt(itemsValue)} with tax. You can still change the amount.</p>}
            {picked.length > 0 && hasModule(s.tenant, "inventory") && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="size-4" />Put their stock back (unopened or packaged items)</label>
            )}
          </div>
        )}
        <div className="space-y-2">
          <Label>Amount</Label>
          <div className="flex gap-2">
            <Input type="number" min={0} max={left} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 font-mono text-lg" />
            <button type="button" onClick={() => setAmount(String(left))} className="h-11 shrink-0 rounded-xl bg-muted px-4 text-sm font-semibold">Full</button>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Refund to</Label>
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)}
                className={cn("rounded-full px-3 py-1.5 text-sm ring-1 ring-border", method === m ? "bg-foreground text-background" : "bg-card")}>{METHOD_LABEL[m] ?? m}</button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label>Reason</Label>
          <div className="flex flex-wrap gap-2">
            {REFUND_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={cn("rounded-full px-3 py-1.5 text-sm ring-1 ring-border", reason === r ? "bg-foreground text-background" : "bg-card")}>{r}</button>
            ))}
          </div>
        </div>
        <button disabled={!reason || v <= 0 || v > left + 0.005} onClick={refund}
          className="h-12 rounded-xl bg-destructive font-semibold text-white disabled:opacity-40">Refund {fmt(v)}</button>
      </DialogContent>
    </Dialog>
  );
}
