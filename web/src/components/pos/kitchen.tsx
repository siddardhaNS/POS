"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bike, Check, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Category, Order } from "./types";
import { Seg, clock, run, useNow, usePoll, usePos } from "./shared";

interface Ticket { id: string; number: number; created_at: string; title: string; channel: string; items: { id: string; name: string; qty: number; note: string; done: boolean; modifiers: string[] }[] }

export function Kitchen() {
  const now = useNow();
  const [view, setView] = useState<"ticket" | "dish">("ticket");
  const { data: tickets, reload, setData } = usePoll<Ticket[]>("/kds", 4000);

  async function toggle(t: Ticket, i: Ticket["items"][number]) {
    setData((d) => d && d.map((x) => x.id === t.id ? { ...x, items: x.items.map((y) => y.id === i.id ? { ...y, done: !y.done } : y) } : x));
    await run(api(`/kds/items/${i.id}/toggle`, { method: "POST" }));
  }
  async function bump(t: Ticket) {
    setData((d) => d && d.filter((x) => x.id !== t.id));
    if (await run(api(`/kds/${t.id}/bump`, { method: "POST" }))) toast.success(`${t.title} sent to the pass`);
    reload();
  }

  const age = (t: Ticket) => (now - new Date(t.created_at).getTime()) / 60000;
  const dishes = Object.values((tickets ?? []).reduce<Record<string, { n: string; q: number; from: string[]; t: number; ids: [Ticket, Ticket["items"][number]][] }>>((acc, t) => {
    t.items.filter((i) => !i.done).forEach((i) => {
      const a = (acc[i.name] ??= { n: i.name, q: 0, from: [], t: Infinity, ids: [] });
      a.q += i.qty; a.from.push(t.title.split(" · ")[0]); a.t = Math.min(a.t, new Date(t.created_at).getTime()); a.ids.push([t, i]);
    });
    return acc;
  }, {})).sort((a, b) => a.t - b.t);

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto bg-[#151513] p-5 text-[#f2f0ea] md:p-7">
      <div className="flex flex-wrap items-center gap-4">
        <Seg dark value={view} onChange={setView} options={[["ticket", "By ticket"], ["dish", "By dish"]]} />
        <span className="text-sm text-[#b8b4aa]">{view === "ticket" ? "Tap an item to mark it done · Bump when the ticket is complete" : "Everything still to cook, oldest first"}</span>
        <span className="ml-auto font-mono text-sm text-[#b8b4aa]">{tickets?.length ?? 0} open</span>
      </div>

      {tickets && tickets.length === 0 && <div className="grid flex-1 place-items-center text-[#8a867d]">All caught up. No open tickets.</div>}

      {view === "ticket" ? (
        <div className="grid auto-rows-min grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {tickets?.map((t) => {
            const m = age(t);
            const head = m > 15 ? "bg-[oklch(0.62_0.19_28)] text-white" : m > 8 ? "bg-[oklch(0.78_0.14_75)] text-[#151513]" : "bg-[#2e2d29]";
            return (
              <div key={t.id} className="flex flex-col overflow-hidden rounded-2xl bg-[#232220]">
                <div className={cn("flex items-center justify-between px-4 py-3", head)}>
                  <div>
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-xs opacity-70">KOT {t.number}</div>
                  </div>
                  <span className="font-mono text-lg font-semibold">{clock(now - new Date(t.created_at).getTime())}</span>
                </div>
                <div className="flex-1 divide-y divide-white/[0.06] px-4">
                  {t.items.map((i) => (
                    <button key={i.id} onClick={() => toggle(t, i)} className={cn("flex w-full items-center gap-3 py-3 text-left transition", i.done && "opacity-40")}>
                      <span className="font-mono text-lg font-semibold">{i.qty}</span>
                      <span className={cn("flex-1 text-[15px]", i.done && "line-through")}>{i.name}
                        {i.modifiers.length > 0 && <span className="block text-xs text-[#d8d3c8]">+ {i.modifiers.join(" · ")}</span>}
                        {i.note && <span className="block text-xs text-saffron">{i.note}</span>}</span>
                      {i.done && <Check className="size-4 text-leaf" />}
                    </button>
                  ))}
                </div>
                <button onClick={() => bump(t)} className="m-3 h-12 rounded-xl bg-[#f2f0ea] font-semibold text-[#151513] transition active:scale-[0.98]">Bump</button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2.5">
          {dishes.map((d) => {
            const m = (now - d.t) / 60000;
            return (
              <div key={d.n} className="flex items-center gap-5 rounded-2xl bg-[#232220] px-5 py-4">
                <span className="w-12 font-mono text-3xl font-semibold">{d.q}</span>
                <div className="flex-1">
                  <div className="text-lg font-medium">{d.n}</div>
                  <div className="text-sm text-[#8a867d]">{d.from.join(" · ")}</div>
                </div>
                <span className={cn("font-mono", m > 15 ? "text-[oklch(0.7_0.19_28)]" : m > 8 ? "text-saffron" : "text-[#8a867d]")}>{clock(now - d.t)}</span>
                <button onClick={async () => {
                  for (const [t, i] of d.ids) await toggle(t, i);
                  toast.success(`${d.q} × ${d.n} ready`);
                }} className="rounded-xl bg-[#f2f0ea] px-4 py-2.5 text-sm font-semibold text-[#151513]">Done</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CHANNELS = { IN: [["swiggy", "Swiggy"], ["zomato", "Zomato"], ["website", "Website"]], US: [["doordash", "DoorDash"], ["ubereats", "Uber Eats"], ["website", "Website"]] } as const;

export function Online() {
  const { s, fmt } = usePos();
  const now = useNow();
  const market = s.tenant?.market ?? "IN";
  const { data: orders, reload } = usePoll<(Order & { opened_at: string; customer_name: string })[]>("/online", 4000);
  const { data: menu } = usePoll<Category[]>("/menu", 0);
  const [busy, setBusy] = useState(false);
  const label = (c: string) => CHANNELS[market].find(([k]) => k === c)?.[1] ?? c;

  async function act(o: Order, a: "accept" | "reject" | "complete") {
    const msg = { accept: "Accepted · KOT sent to kitchen", reject: "Order rejected", complete: `#${o.number} handed over` }[a];
    if (await run(api(`/online/${o.id}/${a}`, { method: "POST" }), msg)) reload();
  }

  async function simulate() {
    const all = menu?.flatMap((c) => c.items).filter((i) => i.available) ?? [];
    if (!all.length) return;
    const pick = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => all[Math.floor(Math.random() * all.length)]);
    const ch = CHANNELS[market][Math.floor(Math.random() * 2)][0];
    await run(api("/online/inbound", { body: { channel: ch, customer_name: "Guest", items: pick.map((p) => ({ menu_item_id: p.id, qty: 1 + Math.floor(Math.random() * 2) })) } }), `New ${label(ch)} order`);
    reload();
  }

  const fresh = orders?.filter((o) => o.status === "new") ?? [];
  const prep = orders?.filter((o) => o.status === "open") ?? [];

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        {CHANNELS[market].map(([k, l]) => (
          <span key={k} className="flex items-center gap-2 rounded-full bg-card px-3.5 py-1.5 text-sm ring-1 ring-border">
            <span className="size-2 rounded-full bg-leaf" />{l}
          </span>
        ))}
        <button onClick={async () => { setBusy(true); await simulate(); setBusy(false); }} disabled={busy}
          className="ml-auto flex items-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2 text-sm font-medium text-background">
          <Plus className="size-4" />Simulate order
        </button>
      </div>

      <Column title="New" count={fresh.length}>
        {fresh.map((o) => {
          const left = 90 - (now - new Date(o.opened_at).getTime()) / 1000;
          return (
            <Card key={o.id} o={o} ch={label(o.channel)} fmt={fmt}
              right={<span className={cn("font-mono text-sm", left < 30 ? "text-destructive" : "text-muted-foreground")}>{left > 0 ? `${clock(left * 1000)} left` : "Expiring"}</span>}>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button onClick={() => act(o, "reject")} className="h-11 rounded-xl bg-muted font-semibold">Reject</button>
                <button onClick={() => act(o, "accept")} className="h-11 rounded-xl bg-saffron font-semibold text-[#1d1c1a]">Accept</button>
              </div>
            </Card>
          );
        })}
        {fresh.length === 0 && <p className="text-sm text-muted-foreground">No new orders. Use “Simulate order” to try the flow.</p>}
      </Column>

      <Column title="Preparing" count={prep.length}>
        {prep.map((o) => (
          <Card key={o.id} o={o} ch={label(o.channel)} fmt={fmt}
            right={<span className="font-mono text-sm text-muted-foreground">{clock(now - new Date(o.opened_at).getTime())}</span>}>
            <button onClick={() => act(o, "complete")} className="mt-4 h-11 w-full rounded-xl bg-foreground font-semibold text-background">Handed to rider</button>
          </Card>
        ))}
      </Column>
    </div>
  );
}

function Column({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{title}<span className="rounded bg-muted px-1.5">{count}</span></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function Card({ o, ch, fmt, right, children }: { o: Order; ch: string; fmt: (v: number) => string; right: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold"><Bike className="size-4 text-saffron-deep" />{ch} · #{o.number}</span>
        {right}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{o.items.map((i) => `${i.qty}× ${i.name}`).join(" · ")}</p>
      <div className="mt-2 font-mono font-semibold">{fmt(o.total)}</div>
      {children}
    </div>
  );
}
