"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bike, Check, Plus, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Category, Order } from "./types";
import { Seg, clock, run, useNow, usePoll, usePos } from "./shared";

interface TicketItem { id: string; name: string; qty: number; note: string; done: boolean; modifiers: string[]; seat: number; station: string }
interface Ticket { id: string; number: number; created_at: string; bumped_at: string | null; title: string; channel: string; course: number; items: TicketItem[] }

const STATION_KEY = "tiffin.kds.station";

export function Kitchen() {
  const now = useNow();
  const [view, setView] = useState<"ticket" | "dish">("ticket");
  const [station, setStationState] = useState<string>(() => {
    try { return localStorage.getItem(STATION_KEY) ?? ""; } catch { return ""; }
  });
  const [recallOpen, setRecallOpen] = useState(false);
  const q = station ? `?station=${encodeURIComponent(station)}` : "";
  const { data: tickets, reload, setData } = usePoll<Ticket[]>(`/kds${q}`, 4000, "kds");
  const { data: stations } = usePoll<string[]>("/kds/stations", 0, "menu");
  const { data: recent, reload: reloadRecent } = usePoll<Ticket[]>(recallOpen ? `/kds/recent${q}` : null, 0, "kds");

  function setStation(v: string) {
    setStationState(v);
    try { localStorage.setItem(STATION_KEY, v); } catch { /* private mode */ }
  }
  async function toggle(t: Ticket, i: TicketItem) {
    setData((d) => d && d.map((x) => x.id === t.id ? { ...x, items: x.items.map((y) => y.id === i.id ? { ...y, done: !y.done } : y) } : x));
    await run(api(`/kds/items/${i.id}/toggle`, { method: "POST" }));
  }
  async function bump(t: Ticket) {
    setData((d) => d && d.filter((x) => x.id !== t.id));
    const r = await run(api<{ bumped: boolean }>(`/kds/${t.id}/bump${q}`, { method: "POST" }));
    if (r) toast.success(r.bumped ? `${t.title} sent to the pass` : `${station} done · ${t.title} still on other stations`);
    reload();
  }
  async function recall(t: Ticket) {
    if (await run(api(`/kds/${t.id}/recall${q}`, { method: "POST" }), `${t.title} recalled`)) { reload(); reloadRecent(); setRecallOpen(false); }
  }

  const age = (t: Ticket) => (now - new Date(t.created_at).getTime()) / 60000;
  const dishes = Object.values((tickets ?? []).reduce<Record<string, { n: string; q: number; from: string[]; t: number; ids: [Ticket, TicketItem][] }>>((acc, t) => {
    t.items.filter((i) => !i.done).forEach((i) => {
      const a = (acc[i.name] ??= { n: i.name, q: 0, from: [], t: Infinity, ids: [] });
      a.q += i.qty; a.from.push(t.title.split(" · ")[0]); a.t = Math.min(a.t, new Date(t.created_at).getTime()); a.ids.push([t, i]);
    });
    return acc;
  }, {})).sort((a, b) => a.t - b.t);
  const allDay = [...dishes].sort((a, b) => b.q - a.q).slice(0, 8);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-[#151513] p-5 text-[#f2f0ea] md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <Seg dark value={view} onChange={setView} options={[["ticket", "By ticket"], ["dish", "By dish"]]} />
        <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-white/[0.08] p-1">
          {["", ...(stations ?? [])].map((st) => (
            <button key={st || "all"} onClick={() => setStation(st)}
              className={cn("shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-medium transition", station === st ? "bg-[#f2f0ea] text-[#151513]" : "text-[#b8b4aa]")}>
              {st || "All stations"}
            </button>
          ))}
        </div>
        <button onClick={() => setRecallOpen(true)} className="ml-auto flex items-center gap-1.5 rounded-xl bg-white/[0.08] px-3.5 py-2 text-sm font-medium">
          <RotateCcw className="size-4" />Recall
        </button>
        <span className="font-mono text-sm text-[#b8b4aa]">{tickets?.length ?? 0} open</span>
      </div>

      {allDay.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <span className="shrink-0 self-center font-mono text-[11px] uppercase tracking-[0.08em] text-[#8a867d]">All day</span>
          {allDay.map((d) => (
            <span key={d.n} className="shrink-0 rounded-lg bg-white/[0.06] px-3 py-1.5 text-sm"><b className="font-mono">{d.q}</b> {d.n}</span>
          ))}
        </div>
      )}

      {tickets && tickets.length === 0 && <div className="grid flex-1 place-items-center text-[#8a867d]">All caught up{station ? ` on ${station}` : ""}. No open tickets.</div>}

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
                    <div className="text-xs opacity-70">KOT {t.number}{t.course ? ` · course ${t.course}` : ""}</div>
                  </div>
                  <span className="font-mono text-lg font-semibold">{clock(now - new Date(t.created_at).getTime())}</span>
                </div>
                <div className="flex-1 divide-y divide-white/[0.06] px-4">
                  {t.items.map((i) => (
                    <button key={i.id} onClick={() => toggle(t, i)} className={cn("flex w-full items-center gap-3 py-3 text-left transition", i.done && "opacity-40")}>
                      <span className="font-mono text-lg font-semibold">{i.qty}</span>
                      <span className={cn("flex-1 text-[15px]", i.done && "line-through")}>{i.name}
                        {i.seat > 0 && <span className="ml-1.5 rounded bg-white/10 px-1 font-mono text-[11px]">S{i.seat}</span>}
                        {!station && i.station && <span className="ml-1.5 text-[11px] text-[#8a867d]">{i.station}</span>}
                        {i.modifiers.length > 0 && <span className="block text-xs text-[#d8d3c8]">+ {i.modifiers.join(" · ")}</span>}
                        {i.note && <span className="block text-xs text-saffron">{i.note}</span>}</span>
                      {i.done && <Check className="size-4 text-leaf" />}
                    </button>
                  ))}
                </div>
                <button onClick={() => bump(t)} className="m-3 h-12 rounded-xl bg-[#f2f0ea] font-semibold text-[#151513] transition active:scale-[0.98]">
                  {station ? `Bump ${station}` : "Bump"}
                </button>
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

      {recallOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setRecallOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-sm flex-col gap-3 overflow-y-auto bg-[#1d1c1a] p-5">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Recently bumped{station ? ` · ${station}` : ""}</div>
              <button onClick={() => setRecallOpen(false)} className="text-[#b8b4aa]">Close</button>
            </div>
            {recent?.length === 0 && <p className="text-sm text-[#8a867d]">Nothing bumped yet.</p>}
            {recent?.map((t) => (
              <div key={t.id} className="rounded-2xl bg-[#232220] p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{t.title}</span>
                  <span className="font-mono text-xs text-[#8a867d]">KOT {t.number}</span>
                </div>
                <div className="mt-1 text-sm text-[#b8b4aa]">{t.items.map((i) => `${i.qty}× ${i.name}`).join(" · ")}</div>
                <button onClick={() => recall(t)} className="mt-3 h-10 w-full rounded-xl bg-[#f2f0ea] text-sm font-semibold text-[#151513]">Recall to screen</button>
              </div>
            ))}
          </div>
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
  const { data: orders, reload } = usePoll<(Order & { opened_at: string; customer_name: string })[]>("/online", 4000, "online");
  const { data: menu } = usePoll<Category[]>("/menu", 0, "menu");
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
