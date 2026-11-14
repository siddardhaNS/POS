"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BadgePercent, Plus, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, can } from "@/lib/api";
import { DAYS, MENU_CHANNELS } from "@/lib/menu";
import { cn } from "@/lib/utils";
import type { Category, MenuChannel, Order, Schedule } from "./types";
import { Empty, Seg, run, usePoll, usePos } from "./shared";

export interface Offer {
  id: string; name: string; active: boolean; kind: "percent" | "amount" | "items_percent" | "bxgy"; value: number; max_discount: number;
  buy_qty: number; free_qty: number; item_ids: string[]; category_ids: string[]; min_subtotal: number; channels: MenuChannel[];
  schedule: Schedule; schedule_label: string; starts_on: string | null; ends_on: string | null; code: string; auto: boolean;
  customers_only: boolean; first_visit_only: boolean; max_uses: number; uses: number; given?: number;
}
type Draft = Omit<Offer, "id" | "uses" | "given" | "schedule_label"> & { id?: string };

const KIND_LABEL: Record<Offer["kind"], string> = { percent: "% off the check", amount: "Amount off the check", items_percent: "% off some dishes", bxgy: "Buy X get Y free" };

const blank = (): Draft => ({
  name: "", active: true, kind: "percent", value: 10, max_discount: 0, buy_qty: 2, free_qty: 1, item_ids: [], category_ids: [], min_subtotal: 0,
  channels: [], schedule: {}, starts_on: null, ends_on: null, code: "", auto: true, customers_only: false, first_visit_only: false, max_uses: 0,
});

export function describeOffer(o: Pick<Offer, "kind" | "value" | "buy_qty" | "free_qty" | "min_subtotal" | "max_discount">, fmt: (v: number) => string) {
  const what = o.kind === "percent" ? `${o.value}% off` : o.kind === "amount" ? `${fmt(o.value)} off` : o.kind === "items_percent" ? `${o.value}% off selected dishes` : `Buy ${o.buy_qty} get ${o.free_qty} free`;
  return [what, o.max_discount ? `up to ${fmt(o.max_discount)}` : "", o.min_subtotal ? `on ${fmt(o.min_subtotal)}+` : ""].filter(Boolean).join(" ");
}

/* ---------- Back office: list and edit offers ---------- */

export function OffersScreen() {
  const { s, fmt } = usePos();
  const edit = can(s.user, "menu_edit");
  const { data } = usePoll<Offer[]>("/promotions", 0, "menu");
  const { data: menu } = usePoll<Category[]>("/menu/manage", 0, "menu");
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_460px]">
      <div className="flex min-h-0 flex-col gap-4 overflow-auto p-5 md:p-7">
        <div className="flex items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">Automatic offers go on any check that qualifies. Offers with a code are applied by the cashier when the guest gives it. One offer per check; a manual discount can still be added on top.</p>
          {edit && <button onClick={() => setDraft(blank())} className="flex shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2 text-sm font-medium text-background"><Plus className="size-4" />New offer</button>}
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {!data ? <Empty>Loading…</Empty> : data.length === 0 ? <Empty>No offers yet. Try “10% off above {fmt(s.tenant?.currency === "INR" ? 1000 : 50)}” or a buy-2-get-1 on drinks.</Empty> : data.map((o) => (
            <button key={o.id} onClick={() => edit && setDraft({ ...o })}
              className={cn("flex w-full items-center gap-4 border-b border-border/60 px-5 py-3.5 text-left last:border-0 hover:bg-muted/40", !o.active && "opacity-50", draft?.id === o.id && "bg-accent/60")}>
              <BadgePercent className="size-5 shrink-0 text-saffron-deep" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">{o.name}
                  {o.code ? <span className="rounded bg-muted px-1.5 font-mono text-[11px]">{o.code}</span> : o.auto ? <span className="rounded bg-leaf/15 px-1.5 text-[11px] font-semibold text-[oklch(0.45_0.12_150)]">Automatic</span> : <span className="rounded bg-muted px-1.5 text-[11px]">Staff pick</span>}
                  {!o.active && <span className="rounded bg-muted px-1.5 text-[11px]">Paused</span>}</span>
                <span className="block truncate text-xs text-muted-foreground">{describeOffer(o, fmt)}{o.schedule_label ? ` · ${o.schedule_label}` : ""}{o.ends_on ? ` · until ${o.ends_on}` : ""}</span>
              </span>
              <span className="text-right text-xs text-muted-foreground"><span className="block font-mono text-sm text-foreground">{o.uses}×</span>{fmt(o.given ?? 0)} given</span>
            </button>
          ))}
        </div>
      </div>
      <aside className={cn("min-h-0 overflow-y-auto border-t border-border bg-card p-6 lg:border-l lg:border-t-0", !draft && "hidden lg:block")}>
        {draft ? <OfferEditor key={draft.id ?? "new"} draft={draft} menu={menu ?? []} onClose={() => setDraft(null)} />
          : <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">Pick an offer to change it.</div>}
      </aside>
    </div>
  );
}

function OfferEditor({ draft: initial, menu, onClose }: { draft: Draft; menu: Category[]; onClose: () => void }) {
  const { s } = usePos();
  const [d, setD] = useState<Draft>(initial);
  const [timed, setTimed] = useState(!!(initial.schedule.from || initial.schedule.days));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const scoped = d.kind === "items_percent" || d.kind === "bxgy";
  const days = d.schedule.days ?? [0, 1, 2, 3, 4, 5, 6];

  async function save() {
    const body = { ...d, schedule: timed ? d.schedule : {} };
    delete (body as { id?: string }).id;
    const r = d.id ? await run(api(`/promotions/${d.id}`, { method: "PUT", body }), "Offer saved") : await run(api("/promotions", { body }), "Offer added");
    if (r) onClose();
  }
  async function remove() {
    if (d.id && window.confirm(`Delete ${d.name}? Checks that used it keep their discount.`) && await run(api(`/promotions/${d.id}`, { method: "DELETE" }), "Offer deleted")) onClose();
  }
  const toggleIn = (k: "item_ids" | "category_ids", id: string) => set({ [k]: d[k].includes(id) ? d[k].filter((x) => x !== id) : [...d[k], id] } as Partial<Draft>);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><div className="text-lg font-semibold">{d.id ? "Edit offer" : "New offer"}</div><button onClick={onClose}><X className="size-5 text-muted-foreground" /></button></div>
      <div className="space-y-2"><Label>Name</Label><Input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder="Weekday lunch 15% off" className="h-10" /></div>
      <div className="space-y-2"><Label>Type</Label>
        <div className="grid grid-cols-2 gap-2">{(Object.keys(KIND_LABEL) as Offer["kind"][]).map((k) => (
          <button key={k} type="button" onClick={() => set({ kind: k })} className={cn("rounded-xl px-3 py-2 text-left text-sm ring-1 ring-border", d.kind === k ? "bg-foreground text-background" : "bg-card")}>{KIND_LABEL[k]}</button>
        ))}</div></div>
      {d.kind === "bxgy" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Buy</Label><Input type="number" min={1} value={d.buy_qty} onChange={(e) => set({ buy_qty: Number(e.target.value) || 0 })} className="h-10 font-mono" /></div>
          <div className="space-y-2"><Label>Get free (cheapest)</Label><Input type="number" min={1} value={d.free_qty} onChange={(e) => set({ free_qty: Number(e.target.value) || 0 })} className="h-10 font-mono" /></div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>{d.kind === "amount" ? `Amount off (${s.tenant?.currency})` : "Percent off"}</Label><Input type="number" min={0} step="0.01" value={d.value} onChange={(e) => set({ value: Number(e.target.value) || 0 })} className="h-10 font-mono" /></div>
          {d.kind !== "amount" && <div className="space-y-2"><Label>Cap (optional)</Label><Input type="number" min={0} value={d.max_discount || ""} placeholder="No cap" onChange={(e) => set({ max_discount: Number(e.target.value) || 0 })} className="h-10 font-mono" /></div>}
        </div>
      )}
      {scoped && (
        <div className="space-y-2">
          <Label>Covers</Label>
          <div className="flex flex-wrap gap-1.5">{menu.map((c) => (
            <button key={c.id} type="button" onClick={() => toggleIn("category_ids", c.id)} className={cn("rounded-full px-2.5 py-1 text-xs ring-1", d.category_ids.includes(c.id) ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>All {c.name}</button>
          ))}</div>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl p-2 ring-1 ring-border">{menu.flatMap((c) => c.items).filter((i) => !menu.find((c) => c.id === i.category_id && d.category_ids.includes(c.id))).map((i) => (
            <label key={i.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.item_ids.includes(i.id)} onChange={() => toggleIn("item_ids", i.id)} className="size-4" />{i.name}</label>
          ))}</div>
        </div>
      )}
      <div className="space-y-2"><Label>Minimum subtotal (optional)</Label><Input type="number" min={0} value={d.min_subtotal || ""} onChange={(e) => set({ min_subtotal: Number(e.target.value) || 0 })} className="h-10 font-mono" /></div>
      <div className="space-y-2"><Label>How it&apos;s applied</Label>
        <Seg value={d.code ? "code" : d.auto ? "auto" : "staff"} onChange={(v) => set(v === "auto" ? { auto: true, code: "" } : v === "staff" ? { auto: false, code: "" } : { auto: false, code: d.code || "SAVE10" })}
          options={[["auto", "Automatically"], ["staff", "Staff pick it"], ["code", "With a code"]]} />
        {!!d.code && <Input value={d.code} onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} maxLength={30} className="h-10 font-mono" />}
      </div>
      <div className="space-y-2"><Label>Channels</Label>
        <div className="flex flex-wrap gap-1.5">{MENU_CHANNELS.map(({ k, l }) => {
          const on = !d.channels.length || d.channels.includes(k);
          return <button type="button" key={k} onClick={() => {
            const cur = d.channels.length ? d.channels : MENU_CHANNELS.map((c) => c.k);
            const next = on ? cur.filter((x) => x !== k) : [...cur, k];
            if (!next.length) return toast.error("Pick at least one channel");
            set({ channels: next.length === MENU_CHANNELS.length ? [] : next });
          }} className={cn("rounded-lg px-2.5 py-1 text-xs ring-1 ring-border", on ? "bg-foreground text-background" : "bg-card text-muted-foreground")}>{l}</button>;
        })}</div></div>
      <div className="space-y-2 rounded-2xl bg-muted/60 p-4">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="size-4" />Only on some days or hours</label>
        {timed && <div className="flex flex-wrap items-center gap-1.5">
          {DAYS.map((x, i) => <button key={x} type="button" onClick={() => set({ schedule: { ...d.schedule, days: days.includes(i) ? days.filter((y) => y !== i) : [...days, i].sort() } })}
            className={cn("h-8 w-10 rounded-lg text-xs font-semibold ring-1 ring-border", days.includes(i) ? "bg-foreground text-background" : "bg-card")}>{x}</button>)}
          <Input type="time" value={d.schedule.from ?? ""} onChange={(e) => set({ schedule: { ...d.schedule, from: e.target.value } })} className="h-9 w-28 bg-card" aria-label="From" />
          <Input type="time" value={d.schedule.to ?? ""} onChange={(e) => set({ schedule: { ...d.schedule, to: e.target.value } })} className="h-9 w-28 bg-card" aria-label="To" />
        </div>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Input type="date" value={d.starts_on ?? ""} onChange={(e) => set({ starts_on: e.target.value || null })} className="h-9 bg-card" aria-label="From date" />
          <Input type="date" value={d.ends_on ?? ""} onChange={(e) => set({ ends_on: e.target.value || null })} className="h-9 bg-card" aria-label="Until date" />
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={d.customers_only} onChange={(e) => set({ customers_only: e.target.checked })} className="size-4" />Only for known customers (phone on the check)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={d.first_visit_only} onChange={(e) => set({ first_visit_only: e.target.checked })} className="size-4" />First visit only</label>
        <label className="flex items-center gap-2">Stop after <Input type="number" min={0} value={d.max_uses || ""} placeholder="∞" onChange={(e) => set({ max_uses: Number(e.target.value) || 0 })} className="h-8 w-20 font-mono" /> uses</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} className="size-4" />Active</label>
      </div>
      <div className="flex gap-2">
        {d.id && <button onClick={remove} className="grid size-12 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive" aria-label="Delete offer"><Trash2 className="size-4" /></button>}
        <button onClick={save} disabled={!d.name.trim()} className="h-12 flex-1 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">Save offer</button>
      </div>
    </div>
  );
}

/* ---------- On a check ---------- */

interface CheckOffer { id: string; name: string; auto: boolean; amount: number; why_not: string }

export function CheckOffersDialog({ order, onClose, onUpdate }: { order: Order; onClose: () => void; onUpdate: (o: Order) => void }) {
  const { fmt } = usePos();
  const { data } = usePoll<CheckOffer[]>(`/orders/${order.id}/offers`, 0);
  const [code, setCode] = useState("");
  async function apply(body: { promotion_id?: string; code?: string }) {
    const o = await run(api<Order>(`/orders/${order.id}/offer`, { body }), "Offer applied");
    if (o) onUpdate(o);
  }
  async function remove() {
    const o = await run(api<Order>(`/orders/${order.id}/offer`, { method: "DELETE" }), "Offer removed");
    if (o) onUpdate(o);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle className="text-xl">Offers</DialogTitle><DialogDescription>One offer per check. It updates as items change.</DialogDescription></DialogHeader>
        {order.promotion && (
          <div className="flex items-center justify-between rounded-xl bg-leaf/10 px-4 py-3">
            <span><span className="font-medium">{order.promotion.name}</span><span className="block text-xs text-muted-foreground">−{fmt(order.promotion.amount)} on this check</span></span>
            <button onClick={remove} className="rounded-lg bg-card px-3 py-1.5 text-sm font-medium ring-1 ring-border">Remove</button>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) void apply({ code }); }} className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Offer code" className="h-11 font-mono" maxLength={30} />
          <button disabled={!code.trim()} className="h-11 rounded-xl bg-foreground px-4 font-semibold text-background disabled:opacity-40">Apply</button>
        </form>
        <div className="space-y-2">
          {!data ? <p className="text-sm text-muted-foreground">Loading…</p> : data.length === 0 ? <p className="text-sm text-muted-foreground">No offers set up. Add them under Offers.</p> : data.map((x) => (
            <button key={x.id} disabled={!!x.why_not || order.promotion?.id === x.id} onClick={() => apply({ promotion_id: x.id })}
              className="flex w-full items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-border hover:ring-foreground disabled:opacity-50 disabled:hover:ring-border">
              <span><span className="font-medium">{x.name}</span><span className="block text-xs text-muted-foreground">{x.why_not || (x.auto ? "Automatic" : "Staff pick")}</span></span>
              {!x.why_not && <span className="font-mono text-sm font-semibold text-saffron-deep">−{fmt(x.amount)}</span>}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
