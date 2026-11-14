"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { DAYS, MENU_CHANNELS } from "@/lib/menu";
import { cn } from "@/lib/utils";
import type { Category, MenuChannel, Schedule } from "./types";
import { run, usePoll, usePos } from "./shared";

export interface PriceList {
  id: string; name: string; active: boolean; channels: MenuChannel[]; schedule: Schedule; schedule_label: string;
  starts_on: string | null; ends_on: string | null; adjust_pct: number; sort: number; in_force: boolean;
  prices: Record<string, number>;
}

type Draft = Omit<PriceList, "id" | "sort" | "in_force" | "schedule_label"> & { id?: string };

const blank = (): Draft => ({ name: "", active: true, channels: [], schedule: {}, starts_on: null, ends_on: null, adjust_pct: 0, prices: {} });

function summary(p: PriceList) {
  const where = p.channels.length ? p.channels.map((c) => MENU_CHANNELS.find((x) => x.k === c)?.l ?? c).join(", ") : "All channels";
  const when = [p.schedule_label, p.starts_on || p.ends_on ? `${p.starts_on ?? "…"} to ${p.ends_on ?? "…"}` : ""].filter(Boolean).join(" · ");
  const how = [p.adjust_pct ? `${p.adjust_pct > 0 ? "+" : ""}${p.adjust_pct}% on everything` : "", Object.keys(p.prices).length ? `${Object.keys(p.prices).length} set prices` : ""].filter(Boolean).join(", ");
  return [where, when || "Always", how || "No changes yet"].join(" · ");
}

export function PriceListsDialog({ menu, edit, onClose }: { menu: Category[]; edit: boolean; onClose: () => void }) {
  const { data: lists, reload } = usePoll<PriceList[]>("/price-lists", 0, "menu");
  const [draft, setDraft] = useState<Draft | null>(null);

  async function move(i: number, d: -1 | 1) {
    if (!lists) return;
    const ids = lists.map((l) => l.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    if (await run(api("/price-lists/reorder", { body: { ids } }))) reload();
  }
  async function toggle(p: PriceList) {
    const { id, ...rest } = p;
    if (await run(api(`/price-lists/${id}`, { method: "PUT", body: { ...rest, active: !p.active } }), p.active ? `${p.name} paused` : `${p.name} turned on`)) reload();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-4 overflow-y-auto sm:max-w-3xl">
        {draft ? (
          <PriceListEditor draft={draft} menu={menu} onCancel={() => setDraft(null)} onSaved={() => { setDraft(null); reload(); }} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Price lists</DialogTitle>
              <DialogDescription>Charge different prices on some channels or at some times: delivery prices, happy hour, a festival markdown. When several apply at once, the one higher up wins.</DialogDescription>
            </DialogHeader>
            {!lists ? <p className="text-sm text-muted-foreground">Loading…</p> : lists.length === 0 ? (
              <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">No price lists yet. Every channel uses the menu price.</p>
            ) : (
              <div className="space-y-2">
                {lists.map((p, i) => (
                  <div key={p.id} className={cn("flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border", !p.active && "opacity-55")}>
                    {edit && (
                      <div className="flex flex-col">
                        <button disabled={i === 0} onClick={() => move(i, -1)} className="disabled:opacity-20" aria-label="Move up"><ArrowUp className="size-4" /></button>
                        <button disabled={i === lists.length - 1} onClick={() => move(i, 1)} className="disabled:opacity-20" aria-label="Move down"><ArrowDown className="size-4" /></button>
                      </div>
                    )}
                    <button className="min-w-0 flex-1 text-left" onClick={() => edit && setDraft({ ...p })}>
                      <div className="flex items-center gap-2 font-medium">{p.name}
                        {p.active && p.in_force && <span className="rounded bg-leaf/15 px-1.5 text-[11px] font-semibold text-[oklch(0.45_0.12_150)]">In force now</span>}
                        {!p.active && <span className="rounded bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">Paused</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{summary(p)}</div>
                    </button>
                    {edit && <button onClick={() => toggle(p)} className="text-sm font-medium hover:underline">{p.active ? "Pause" : "Turn on"}</button>}
                  </div>
                ))}
              </div>
            )}
            {edit && (
              <button onClick={() => setDraft(blank())} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-border text-sm font-medium">
                <Plus className="size-4" />New price list
              </button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PriceListEditor({ draft: initial, menu, onCancel, onSaved }: { draft: Draft; menu: Category[]; onCancel: () => void; onSaved: () => void }) {
  const { fmt, s } = usePos();
  const [d, setD] = useState<Draft>(initial);
  const [q, setQ] = useState("");
  const [timed, setTimed] = useState(!!(initial.schedule.from || initial.schedule.days));
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const days = d.schedule.days ?? [0, 1, 2, 3, 4, 5, 6];
  const items = useMemo(() => menu.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.name })))
    .filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase())), [menu, q]);
  const pctPrice = (p: number) => Math.max(0, Math.round(p * (100 + d.adjust_pct)) / 100);

  async function save() {
    const body = { ...d, schedule: timed ? d.schedule : {} };
    delete (body as { id?: string }).id;
    const r = d.id ? await run(api(`/price-lists/${d.id}`, { method: "PUT", body }), `${d.name} saved`)
      : await run(api("/price-lists", { body }), `${d.name} added`);
    if (r) onSaved();
  }
  async function remove() {
    if (d.id && confirmDelete(d.name) && await run(api(`/price-lists/${d.id}`, { method: "DELETE" }), `${d.name} deleted`)) onSaved();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-xl">{d.id ? `Edit ${initial.name}` : "New price list"}</DialogTitle>
        <DialogDescription>Set prices for the items you want to change. Everything else uses the menu price, adjusted by the percentage if you give one.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Name</Label><Input value={d.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} placeholder="Delivery prices" className="h-10" /></div>
        <div className="space-y-2"><Label>Adjust every other item (%)</Label>
          <Input type="number" step="0.5" min={-100} max={500} value={d.adjust_pct || ""} placeholder="0 = keep menu price, -10 = 10% off"
            onChange={(e) => set({ adjust_pct: Number(e.target.value) || 0 })} className="h-10 font-mono" /></div>
      </div>
      <div className="space-y-2">
        <Label>Applies on</Label>
        <div className="flex flex-wrap gap-1.5">
          {MENU_CHANNELS.map(({ k, l }) => {
            const on = !d.channels.length || d.channels.includes(k);
            return (
              <button type="button" key={k} onClick={() => {
                const cur = d.channels.length ? d.channels : MENU_CHANNELS.map((c) => c.k);
                const next = on ? cur.filter((x) => x !== k) : [...cur, k];
                if (!next.length) return toast.error("Pick at least one channel");
                set({ channels: next.length === MENU_CHANNELS.length ? [] : next });
              }} className={cn("rounded-lg px-3 py-1.5 text-sm ring-1 ring-border", on ? "bg-foreground text-background" : "bg-card text-muted-foreground")}>{l}</button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>From date (optional)</Label><Input type="date" value={d.starts_on ?? ""} onChange={(e) => set({ starts_on: e.target.value || null })} className="h-10" /></div>
        <div className="space-y-2"><Label>Until date (optional)</Label><Input type="date" value={d.ends_on ?? ""} onChange={(e) => set({ ends_on: e.target.value || null })} className="h-10" /></div>
      </div>
      <div className="space-y-2 rounded-2xl bg-muted/60 p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} className="size-4" />Only on some days or hours (happy hour)
        </label>
        {timed && (
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map((x, i) => (
              <button key={x} type="button" onClick={() => {
                const next = days.includes(i) ? days.filter((y) => y !== i) : [...days, i].sort();
                set({ schedule: { ...d.schedule, days: next } });
              }} className={cn("h-8 w-10 rounded-lg text-xs font-semibold ring-1 ring-border", days.includes(i) ? "bg-foreground text-background" : "bg-card")}>{x}</button>
            ))}
            <Input type="time" value={d.schedule.from ?? ""} onChange={(e) => set({ schedule: { ...d.schedule, from: e.target.value } })} className="h-9 w-28 bg-card" aria-label="From" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="time" value={d.schedule.to ?? ""} onChange={(e) => set({ schedule: { ...d.schedule, to: e.target.value } })} className="h-9 w-28 bg-card" aria-label="To" />
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label>Item prices ({s.tenant?.currency})</Label>
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dish" className="h-9 pl-8" />
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-2xl ring-1 ring-border">
          {items.map((i) => {
            const set_ = d.prices[i.id];
            return (
              <div key={i.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{i.name}</div>
                  <div className="text-xs text-muted-foreground">{i.cat} · menu {fmt(i.price)}{set_ == null && d.adjust_pct ? ` · list ${fmt(pctPrice(i.price))}` : ""}</div>
                </div>
                <Input type="number" min={0} step="0.01" value={set_ ?? ""} placeholder={String(d.adjust_pct ? pctPrice(i.price) : i.price)}
                  onChange={(e) => {
                    const next = { ...d.prices };
                    if (e.target.value === "") delete next[i.id]; else next[i.id] = Number(e.target.value);
                    set({ prices: next });
                  }} className="h-9 w-28 font-mono" />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2">
        {d.id && <button onClick={remove} className="grid size-12 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive" aria-label="Delete price list"><Trash2 className="size-4" /></button>}
        <button onClick={onCancel} className="h-12 rounded-xl bg-muted px-5 font-semibold">Back</button>
        <button onClick={save} disabled={!d.name.trim()} className="h-12 flex-1 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">Save price list</button>
      </div>
    </>
  );
}

function confirmDelete(name: string) {
  return window.confirm(`Delete the price list "${name}"? Checks already rung up keep their prices.`);
}
