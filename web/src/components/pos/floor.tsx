"use client";

import { useState } from "react";
import { ShoppingBag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, Seg, clock, run, useNow, usePoll, usePos } from "./shared";
import type { Order, TableRow } from "./types";

export type { TableRow } from "./types";

const STATE = {
  free: { bg: "bg-card", bd: "border-[1.5px] border-dashed border-[#c9c5bc]", label: "", dot: "" },
  unsent: { bg: "bg-[oklch(0.9_0.05_250)]", bd: "border border-transparent", label: "Items not sent", dot: "bg-sky" },
  kitchen: { bg: "bg-[oklch(0.9_0.07_70)]", bd: "border border-transparent", label: "In kitchen", dot: "bg-saffron" },
  served: { bg: "bg-[oklch(0.92_0.06_150)]", bd: "border border-transparent", label: "Served · ready to pay", dot: "bg-leaf" },
};

export function Floor() {
  const { s, fmt, go } = usePos();
  const now = useNow(15_000);
  const [view, setView] = useState<"map" | "timeline">("map");
  const [newTakeaway, setNewTakeaway] = useState(false);
  const { data: tables } = usePoll<TableRow[]>("/tables", 5000, "floor");
  const { data: counter } = usePoll<Order[]>("/orders/open?channel=takeaway", 5000, "floor");
  const canOrder = can(s.user, "order");

  async function open(t: TableRow, pay = false) {
    if (!canOrder) return;
    const o = await run(api<{ id: string }>(`/tables/${t.id}/order`, { method: "POST" }));
    if (o) go("order", { orderId: o.id, pay });
  }

  const busy = (tables ?? []).filter((t) => t.state !== "free");
  const rank = { unsent: 1, kitchen: 3, served: 2, free: 9 } as const;
  const timeline = [...busy].map((t) => {
    const age = t.kitchen_since ? (now - new Date(t.kitchen_since).getTime()) / 60000 : 0;
    const late = t.state === "kitchen" && age > 15;
    return { t, age, late, pri: late ? 0 : rank[t.state] };
  }).sort((a, b) => a.pri - b.pri);
  const sections = [...new Set((tables ?? []).map((t) => t.section || "Main"))];

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-4">
        <Seg value={view} onChange={setView} options={[["map", "Map"], ["timeline", "Timeline"]]} />
        <span className="hidden text-sm text-muted-foreground sm:inline">{view === "map" ? "Tap a table to open its check" : "Sorted by who needs attention"}</span>
        {canOrder && (
          <button onClick={() => setNewTakeaway(true)} className="ml-auto flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background">
            <ShoppingBag className="size-4" />New takeaway
          </button>
        )}
      </div>

      {!!counter?.length && (
        <section>
          <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Counter & takeaway · {counter.length}</div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {counter.map((o) => (
              <button key={o.id} onClick={() => go("order", { orderId: o.id })}
                className="flex min-w-48 flex-col items-start rounded-2xl border border-border bg-card px-4 py-3 text-left transition hover:border-foreground/40">
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="font-semibold">#{o.number}</span>
                  <span className="font-mono text-xs text-muted-foreground">{clock(now - new Date(o.opened_at).getTime())}</span>
                </div>
                <span className="truncate text-sm text-muted-foreground">{o.customer_name || "Walk-in"} · {o.items.reduce((a, l) => a + l.qty, 0)} items</span>
                <span className="mt-1 font-mono text-sm font-semibold">{fmt(o.balance)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {view === "map" ? (
        <>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {(["unsent", "kitchen", "served"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", STATE[k].dot)} />{STATE[k].label}</span>
            ))}
          </div>
          {sections.map((sec) => (
            <section key={sec}>
              {sections.length > 1 && <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{sec}</div>}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {tables?.filter((t) => (t.section || "Main") === sec).map((t) => {
                  const st = STATE[t.state];
                  return (
                    <button key={t.id} onClick={() => open(t)}
                      className={cn("flex flex-col items-start rounded-[20px] p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg",
                        st.bg, st.bd, t.seats >= 6 ? "min-h-40" : "min-h-32")}>
                      <div className="flex w-full items-start justify-between">
                        <span className="text-2xl font-semibold">{t.name}</span>
                        {t.state !== "free" && <span className="font-mono text-sm font-semibold tabular">{fmt(t.total)}</span>}
                      </div>
                      <div className="mt-auto text-[13px] text-[#5d5a53]">
                        {t.state === "free" ? `${t.seats} seats` : `${st.label} · ${t.items} items${t.guests ? ` · ${t.guests} guests` : ""}`}
                        {t.paid > 0 && <span className="ml-1 font-medium text-[oklch(0.45_0.12_150)]">· part paid</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      ) : timeline.length === 0 ? (
        <Empty>No open tables. Everyone&apos;s been served.</Empty>
      ) : (
        <div className="space-y-2.5">
          {timeline.map(({ t, age, late }) => {
            const w = t.state === "unsent" ? 18 : t.state === "kitchen" ? 45 : 80;
            const c = late ? "bg-chili" : STATE[t.state].dot;
            const action = t.state === "unsent" ? "Send KOT" : late ? `Late · ${Math.floor(age)}m` : t.state === "kitchen" ? `In kitchen · ${Math.floor(age)}m` : can(s.user, "pay") ? "Take payment" : "Print bill";
            return (
              <div key={t.id} onClick={() => open(t)} role="button"
                className={cn("grid cursor-pointer grid-cols-[64px_1fr_auto] items-center gap-4 rounded-2xl border bg-card px-4 py-3.5 md:grid-cols-[72px_1fr_110px_160px]",
                  late ? "border-[oklch(0.85_0.08_28)]" : "border-border")}>
                <span className="text-xl font-semibold">{t.name}</span>
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", c)} style={{ width: `${w}%` }} /></div>
                  <div className="mt-1.5 text-xs text-muted-foreground">{t.items} items</div>
                </div>
                <span className="hidden text-right font-mono text-sm font-semibold tabular md:block">{fmt(t.total)}</span>
                <button onClick={(e) => { e.stopPropagation(); open(t, t.state === "served"); }}
                  className={cn("rounded-xl px-3 py-2 text-[13px] font-semibold",
                    late ? "bg-destructive/10 text-destructive" : t.state === "unsent" ? "bg-foreground text-background" : t.state === "served" ? "bg-saffron text-[#1d1c1a]" : "bg-muted")}>
                  {action}
                </button>
              </div>
            );
          })}
          <div className="pt-2 text-sm text-muted-foreground">{(tables?.length ?? 0) - busy.length} tables free</div>
        </div>
      )}

      {newTakeaway && <TakeawayDialog onClose={() => setNewTakeaway(false)} onCreated={(id) => go("order", { orderId: id })} />}
    </div>
  );
}

function TakeawayDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const o = await run(api<Order>("/orders", { body: { channel: "takeaway", customer_name: name, customer_phone: phone } }));
    if (o) onCreated(o.id);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="text-xl">New takeaway order</DialogTitle>
            <DialogDescription>Both fields are optional. The name shows on the kitchen ticket.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2"><Label htmlFor="tw-name">Customer name</Label><Input id="tw-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-11" /></div>
          <div className="space-y-2"><Label htmlFor="tw-phone">Phone</Label><Input id="tw-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className="h-11" /></div>
          <button type="submit" className="h-12 rounded-xl bg-foreground font-semibold text-background">Start order</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
