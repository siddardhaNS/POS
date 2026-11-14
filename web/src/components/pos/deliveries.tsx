"use client";

import { useState } from "react";
import { Bike, CircleCheck, MapPin, Phone, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Order } from "./types";
import { Empty, run, useNow, usePoll, usePos } from "./shared";

const COLS: { k: "preparing" | "out" | "delivered"; l: string }[] = [
  { k: "preparing", l: "Preparing" }, { k: "out", l: "Out for delivery" }, { k: "delivered", l: "Delivered today" },
];

const mins = (from: string | null, now: number) => (from ? Math.max(0, Math.round((now - new Date(from).getTime()) / 60000)) : 0);

export function DeliveriesScreen() {
  const { s, fmt, go } = usePos();
  const now = useNow(30_000);
  const { data, reload } = usePoll<Order[]>("/deliveries", 15_000, "orders");
  const { data: riders } = usePoll<{ id: string; name: string; role: string }[]>("/deliveries/riders", 0);
  const [creating, setCreating] = useState(false);
  const canPay = can(s.user, "pay");

  async function patch(o: Order, body: Record<string, unknown>, ok?: string) {
    if (await run(api(`/orders/${o.id}/delivery`, { method: "PATCH", body }), ok)) reload();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5 md:p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Your own riders. Orders from delivery apps stay under Online orders.</p>
        <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background"><Plus className="size-4" />New delivery</button>
      </div>
      <div className="grid min-h-0 flex-1 gap-4 overflow-auto lg:grid-cols-3">
        {COLS.map((col) => {
          const list = (data ?? []).filter((o) => (o.delivery?.status || "preparing") === col.k);
          return (
            <div key={col.k} className="flex min-h-0 flex-col gap-2.5">
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{col.l} · {list.length}</div>
              {!data ? <Empty>Loading…</Empty> : list.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">None</div> : list.map((o) => {
                const d = o.delivery!;
                const unsent = o.items.filter((l) => !l.sent).length;
                const ready = o.items.length > 0 && o.items.every((l) => l.done);
                return (
                  <div key={o.id} className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
                    <button onClick={() => go("order", { orderId: o.id })} className="block w-full text-left">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">#{o.number} · {o.customer_name || "Guest"}</span>
                        <span className="font-mono text-sm">{fmt(o.due)}</span>
                      </div>
                      <div className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground"><MapPin className="mt-0.5 size-3.5 shrink-0" /><span className="line-clamp-2">{d.address}</span></div>
                      {o.customer_phone && <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><Phone className="size-3.5" />{o.customer_phone}</div>}
                      {d.note && <div className="text-xs italic text-muted-foreground">“{d.note}”</div>}
                    </button>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded bg-muted px-1.5">{o.items.reduce((a, l) => a + l.qty, 0)} items</span>
                      {unsent > 0 && <span className="rounded bg-sky/15 px-1.5 font-medium text-sky">{unsent} not sent to kitchen</span>}
                      {col.k === "preparing" && ready && <span className="rounded bg-leaf/15 px-1.5 font-medium text-[oklch(0.45_0.12_150)]">Food ready</span>}
                      <span className={cn("rounded px-1.5 font-medium", o.status === "paid" ? "bg-leaf/15 text-[oklch(0.45_0.12_150)]" : "bg-saffron/20 text-saffron-deep")}>{o.status === "paid" ? "Paid" : `To collect ${fmt(o.balance)}`}</span>
                      <span className="rounded bg-muted px-1.5">{col.k === "out" ? `out ${mins(d.dispatched_at, now)} min` : col.k === "delivered" ? `delivered ${new Date(d.delivered_at!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `${mins(o.opened_at, now)} min since order`}</span>
                    </div>
                    {col.k !== "delivered" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={d.rider_id ?? ""} onChange={(e) => patch(o, { rider_id: e.target.value }, e.target.value ? "Rider assigned" : undefined)}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-sm" aria-label="Rider">
                          <option value="">Who&apos;s taking it?</option>
                          {riders?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        {col.k === "preparing" ? (
                          <button onClick={() => patch(o, { status: "out" }, `#${o.number} is on its way`)} disabled={!d.rider_id || unsent > 0}
                            className="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-semibold text-background disabled:opacity-35"><Bike className="size-4" />Send out</button>
                        ) : (
                          <button onClick={() => patch(o, { status: "delivered" }, `#${o.number} delivered`)}
                            className="flex h-9 items-center gap-1.5 rounded-lg bg-leaf px-3 text-sm font-semibold text-white"><CircleCheck className="size-4" />Delivered</button>
                        )}
                      </div>
                    )}
                    {o.status === "open" && canPay && col.k !== "preparing" && (
                      <button onClick={() => go("order", { orderId: o.id, pay: true })} className="h-9 w-full rounded-lg bg-muted text-sm font-semibold">Settle {fmt(o.balance)}{d.rider_name ? ` from ${d.rider_name}` : ""}</button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {creating && <NewDeliveryDialog onClose={() => setCreating(false)} onCreated={(id) => go("order", { orderId: id })} />}
    </div>
  );
}

export function NewDeliveryDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { s, fmt } = usePos();
  const [f, setF] = useState({ name: "", phone: "", address: "", note: "", fee: String(s.tenant?.delivery_fee ?? 0) });
  const [known, setKnown] = useState<{ visits: number } | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function lookup() {
    if (f.phone.replace(/\D/g, "").length < 6) return;
    const c = await api<{ name: string; address: string; visits: number } | null>(`/customers/lookup?phone=${encodeURIComponent(f.phone)}`).catch(() => null);
    setKnown(c);
    if (c) setF((x) => ({ ...x, name: x.name || c.name, address: x.address || c.address }));
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const o = await run(api<Order>("/orders", { body: { channel: "delivery", customer_name: f.name, customer_phone: f.phone, delivery_address: f.address, delivery_note: f.note, delivery_fee: Number(f.fee) || 0 } }));
    if (o) { onClose(); onCreated(o.id); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader><DialogTitle className="text-xl">New delivery</DialogTitle><DialogDescription>Phone first: a returning guest&apos;s name and address fill in.</DialogDescription></DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <div className="space-y-2"><Label>Phone</Label><Input required type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} onBlur={lookup} className="h-10" maxLength={40} autoFocus />
            {known && <p className="text-xs text-[oklch(0.45_0.12_150)]">Returning guest · {known.visits} visit{known.visits === 1 ? "" : "s"}</p>}</div>
          <div className="space-y-2"><Label>Name</Label><Input value={f.name} onChange={(e) => set({ name: e.target.value })} className="h-10" maxLength={120} /></div>
          <div className="space-y-2"><Label>Address</Label><Textarea required rows={2} value={f.address} onChange={(e) => set({ address: e.target.value })} maxLength={500} /></div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-2"><Label>Note for the rider</Label><Input value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="Gate 2, call on arrival" className="h-10" maxLength={200} /></div>
            <div className="space-y-2"><Label>Fee ({s.tenant?.currency})</Label><Input type="number" min={0} step="0.01" value={f.fee} onChange={(e) => set({ fee: e.target.value })} className="h-10 font-mono" /></div>
          </div>
          <button className="h-11 w-full rounded-xl bg-foreground font-semibold text-background">Start order{Number(f.fee) ? ` · ${fmt(Number(f.fee))} fee` : ""}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
