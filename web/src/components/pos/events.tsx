"use client";

import { useState } from "react";
import { CalendarDays, FileText, MapPin, Plus, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { printReceipt } from "./print";
import type { Order } from "./types";
import { Empty, METHOD_LABEL, Seg, payMethods, run, usePoll, usePos } from "./shared";

const STATUS: Record<string, { l: string; tone: string }> = {
  quote: { l: "Quote", tone: "bg-muted text-muted-foreground" },
  confirmed: { l: "Confirmed", tone: "bg-sky/15 text-sky" },
  done: { l: "Done", tone: "bg-leaf/15 text-[oklch(0.45_0.12_150)]" },
  cancelled: { l: "Cancelled", tone: "bg-destructive/10 text-destructive" },
};
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "No date");

export function EventsScreen() {
  const { s, fmt, go } = usePos();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const { data, reload } = usePoll<Order[]>(`/events?when=${tab}`, 60000, "orders");
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Order | null>(null);
  const canPay = can(s.user, "pay");

  async function setStatus(o: Order, status: string) {
    if (await run(api(`/orders/${o.id}/event`, { method: "PATCH", body: { status } }), `Event #${o.number} ${STATUS[status].l.toLowerCase()}`)) reload();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <Seg value={tab} onChange={setTab} options={[["upcoming", "Upcoming"], ["past", "Past"]]} />
        <p className="text-sm text-muted-foreground">Parties, office lunches and outdoor catering booked ahead: build the menu, send a quote, take an advance, settle after.</p>
        <button onClick={() => setCreating(true)} className="ml-auto flex items-center gap-1.5 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background"><Plus className="size-4" />New event</button>
      </div>
      {!data ? <Empty>Loading…</Empty> : !data.length ? <Empty>{tab === "upcoming" ? "No events booked." : "No events in the last 90 days."}</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((o) => {
            const ev = o.event!;
            const st = STATUS[ev.status] ?? STATUS.quote;
            return (
              <div key={o.id} className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-border">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-lg font-semibold">#{o.number} · {o.customer_name || "Guest"}<span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", st.tone)}>{st.l}</span></div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" />{when(ev.at)}</span>
                      {!!o.guests && <span className="flex items-center gap-1.5"><Users className="size-3.5" />{o.guests} guests</span>}
                      {ev.venue && <span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{ev.venue}</span>}
                    </div>
                    {ev.note && <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">{ev.note}</p>}
                  </div>
                  <div className="text-right"><div className="font-mono text-lg font-semibold">{fmt(o.due)}</div>
                    <div className="text-xs text-muted-foreground">{o.items.reduce((a, l) => a + l.qty, 0)} items</div></div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-xl bg-muted/60 px-3 py-2"><div className="text-xs text-muted-foreground">Advance received</div><div className="font-mono font-semibold">{fmt(o.paid)}</div></div>
                  <div className="rounded-xl bg-muted/60 px-3 py-2"><div className="text-xs text-muted-foreground">{o.status === "open" ? "Balance" : "Status"}</div><div className="font-mono font-semibold">{o.status === "open" ? fmt(o.balance) : o.status}</div></div>
                </div>
                {o.payments.length > 0 && <div className="text-xs text-muted-foreground">{o.payments.map((p) => `${p.kind === "refund" ? "Refund " : ""}${fmt(p.amount)} ${METHOD_LABEL[p.method] ?? p.method} ${new Date(p.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`).join(" · ")}</div>}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => go("order", { orderId: o.id })} className="h-9 rounded-lg bg-muted px-3 text-sm font-semibold">{o.status === "open" ? "Edit menu" : "View"}</button>
                  {o.items.length > 0 && <button onClick={() => printReceipt(o, s.tenant, fmt, "quote")} className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-sm font-semibold"><FileText className="size-4" />Quote</button>}
                  {o.status === "open" && canPay && o.items.length > 0 && <button onClick={() => go("order", { orderId: o.id, pay: true })} className="h-9 rounded-lg bg-foreground px-3 text-sm font-semibold text-background">{o.paid ? "Take payment" : "Take advance"}</button>}
                  {ev.status === "quote" && o.status === "open" && <button onClick={() => setStatus(o, "confirmed")} className="h-9 rounded-lg bg-sky/15 px-3 text-sm font-semibold text-sky">Confirm</button>}
                  {ev.status === "confirmed" && <button onClick={() => setStatus(o, "done")} className="h-9 rounded-lg bg-leaf/15 px-3 text-sm font-semibold text-[oklch(0.45_0.12_150)]">Mark done</button>}
                  {o.status === "open" && can(s.user, "refund") && <button onClick={() => setCancelling(o)} className="ml-auto h-9 px-2 text-sm text-destructive">Cancel event</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {creating && <NewEventDialog onClose={() => setCreating(false)} onCreated={(id) => go("order", { orderId: id })} />}
      {cancelling && <CancelEventDialog order={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); reload(); }} />}
    </div>
  );
}

function NewEventDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: "", phone: "", at: "", guests: "", venue: "", note: "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function lookup() {
    if (f.phone.replace(/\D/g, "").length < 6) return;
    const c = await api<{ name: string; address: string } | null>(`/customers/lookup?phone=${encodeURIComponent(f.phone)}`).catch(() => null);
    if (c) setF((x) => ({ ...x, name: x.name || c.name }));
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const o = await run(api<Order>("/orders", { body: {
      channel: "catering", customer_name: f.name, customer_phone: f.phone, event_at: new Date(f.at).toISOString(),
      guests: Number(f.guests) || 0, event_venue: f.venue, event_note: f.note,
    } }), "Event created. Add the menu next.");
    if (o) { onClose(); onCreated(o.id); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader><DialogTitle className="text-xl">New event</DialogTitle><DialogDescription>Then add the menu like any check, print a quote and take an advance.</DialogDescription></DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Phone</Label><Input type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} onBlur={lookup} className="h-10" maxLength={40} /></div>
            <div className="space-y-2"><Label>Name</Label><Input required value={f.name} onChange={(e) => set({ name: e.target.value })} className="h-10" maxLength={120} /></div>
            <div className="space-y-2"><Label>When</Label><Input required type="datetime-local" value={f.at} onChange={(e) => set({ at: e.target.value })} className="h-10" /></div>
            <div className="space-y-2"><Label>Guests</Label><Input type="number" min={0} value={f.guests} onChange={(e) => set({ guests: e.target.value })} className="h-10 font-mono" /></div>
          </div>
          <div className="space-y-2"><Label>Venue (blank = at the restaurant)</Label><Input value={f.venue} onChange={(e) => set({ venue: e.target.value })} maxLength={500} className="h-10" /></div>
          <div className="space-y-2"><Label>Notes</Label><Textarea rows={2} value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={2000} placeholder="Birthday, jain food for 10, cake at 9 pm" /></div>
          <button className="h-11 w-full rounded-xl bg-foreground font-semibold text-background">Create and add menu</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelEventDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const { s, fmt } = usePos();
  const advance = order.paid + order.tip;
  const first = order.payments.find((p) => p.kind === "payment")?.method ?? "cash";
  const [method, setMethod] = useState(first);
  const [reason, setReason] = useState("");
  async function cancel() {
    if (await run(api(`/orders/${order.id}/event/cancel`, { body: { reason, refund_method: method } }), `Event #${order.number} cancelled`)) onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader><DialogTitle className="text-xl">Cancel event #{order.number}?</DialogTitle>
          <DialogDescription>{advance ? `The advance of ${fmt(advance)} is refunded with a credit note.` : "No advance was taken."} The check is voided.</DialogDescription></DialogHeader>
        {advance > 0 && (
          <div className="space-y-2"><Label>Refund by</Label>
            <div className="flex flex-wrap gap-2">{[...new Set([first, ...payMethods(s.tenant)])].map((m) => (
              <button key={m} type="button" onClick={() => setMethod(m)} className={cn("rounded-full px-3 py-1.5 text-sm ring-1 ring-border", method === m ? "bg-foreground text-background" : "bg-card")}>{METHOD_LABEL[m] ?? m}</button>
            ))}</div></div>
        )}
        <div className="space-y-2"><Label>Reason</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Customer called off the party" className="h-10" /></div>
        <button disabled={reason.trim().length < 2} onClick={cancel} className="h-11 rounded-xl bg-destructive font-semibold text-white disabled:opacity-40">Cancel event{advance ? ` and refund ${fmt(advance)}` : ""}</button>
      </DialogContent>
    </Dialog>
  );
}
