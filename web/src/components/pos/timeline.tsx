"use client";

import { useMemo, useState } from "react";
import { can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, Seg, usePoll, usePos } from "./shared";
import type { TableRow } from "./types";

/* ---------- Data (mirror GET /floor/timeline) ---------- */

interface Fire { number: number; course: number; at: string; bumped_at: string | null }
interface Check {
  order_id: string; number: number; status: string; guests: number; opened_at: string; closed_at: string | null;
  total: number; items: number; unsent: number; fires: Fire[];
}
interface TimelineData { now: string; day_start: string; timezone: string; tables: { id: string; name: string; seats: number; section: string; checks: Check[] }[] }

type Stage = "seated" | "kitchen" | "late" | "served";
interface Span { from: number; to: number; stage: Stage }

const LATE_MIN = 15;
const MIN = 60_000;
const STAGE: Record<Stage, { bar: string; label: string }> = {
  seated: { bar: "bg-sky", label: "Seated, nothing sent" },
  kitchen: { bar: "bg-saffron", label: "In the kitchen" },
  late: { bar: "bg-chili", label: `Kitchen over ${LATE_MIN} min` },
  served: { bar: "bg-leaf", label: "Served" },
};

/** Split an open check into stages: seated until the first fire, then kitchen while a ticket is open, served in between. */
function stages(c: Check, now: number): Span[] {
  const open = new Date(c.opened_at).getTime();
  const end = c.closed_at ? new Date(c.closed_at).getTime() : now;
  const kitchen = c.fires
    .map((f) => [new Date(f.at).getTime(), f.bumped_at ? new Date(f.bumped_at).getTime() : end] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .reduce<[number, number][]>((acc, [a, b]) => {
      const last = acc[acc.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else acc.push([a, b]);
      return acc;
    }, []);
  const out: Span[] = [];
  let t = open;
  if (!kitchen.length) return [{ from: open, to: end, stage: "seated" }];
  if (kitchen[0][0] > open) { out.push({ from: open, to: kitchen[0][0], stage: "seated" }); t = kitchen[0][0]; }
  for (const [a, b] of kitchen) {
    if (a > t) out.push({ from: t, to: a, stage: "served" });
    const late = b - a > LATE_MIN * MIN;
    if (late) {
      out.push({ from: a, to: a + LATE_MIN * MIN, stage: "kitchen" });
      out.push({ from: a + LATE_MIN * MIN, to: b, stage: "late" });
    } else out.push({ from: a, to: b, stage: "kitchen" });
    t = Math.max(t, b);
  }
  if (t < end) out.push({ from: t, to: end, stage: "served" });
  return out;
}

const mins = (ms: number) => Math.max(0, Math.round(ms / MIN));
const dur = (ms: number) => { const m = mins(ms); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };

type Window = "2" | "4" | "8" | "day";
type Sort = "attention" | "table" | "longest";

export function ServiceTimeline({ live, onOpen }: { live: TableRow[]; onOpen: (t: TableRow, pay?: boolean) => void }) {
  const { s, fmt } = usePos();
  const { data } = usePoll<TimelineData>("/floor/timeline", 30_000, ["floor", "kds", "orders"]);
  const [win, setWin] = useState<Window>("4");
  const [sort, setSort] = useState<Sort>("attention");
  const [section, setSection] = useState("");
  const [showFree, setShowFree] = useState(false);

  const tz = s.tenant?.timezone;
  const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined });
  const now = data ? Math.max(Date.now(), new Date(data.now).getTime()) : Date.now();
  const dayStart = data ? new Date(data.day_start).getTime() : now - 12 * 3600_000;

  const rows = useMemo(() => {
    if (!data) return [];
    const liveById = new Map(live.map((t) => [t.id, t]));
    return data.tables
      .filter((t) => !section || t.section === section)
      .map((t) => {
        const open = t.checks.find((c) => c.status === "open") ?? null;
        const segs = open ? stages(open, now) : [];
        const lastFire = open?.fires.filter((f) => !f.bumped_at).map((f) => new Date(f.at).getTime()).sort()[0];
        const kitchenFor = lastFire ? now - lastFire : 0;
        const late = kitchenFor > LATE_MIN * MIN;
        const stage: Stage | "free" = !open ? "free" : late ? "late" : lastFire ? "kitchen" : open.fires.length ? "served" : "seated";
        const pri = { late: 0, seated: 1, served: 2, kitchen: 3, free: 9 }[stage];
        return { t, open, segs, stage, pri, kitchenFor, seatedFor: open ? now - new Date(open.opened_at).getTime() : 0, live: liveById.get(t.id) };
      })
      .filter((r) => showFree || r.open || r.t.checks.length)
      .sort((a, b) => (sort === "table" ? 0 : sort === "longest" ? b.seatedFor - a.seatedFor : a.pri - b.pri || b.seatedFor - a.seatedFor));
  }, [data, live, now, section, showFree, sort]);

  if (!data) return <Empty>Loading the timeline…</Empty>;

  const span = win === "day" ? Math.max(now - Math.min(dayStart, ...rows.flatMap((r) => r.t.checks.map((c) => new Date(c.opened_at).getTime()))), 3600_000) : Number(win) * 3600_000;
  const start = now - span;
  const end = now + span * 0.04;
  const pct = (t: number) => ((Math.max(start, Math.min(end, t)) - start) / (end - start)) * 100;
  const step = span <= 2.5 * 3600_000 ? 30 * MIN : span <= 8.5 * 3600_000 ? 3600_000 : 2 * 3600_000;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= now; t += step) ticks.push(t);

  // Live numbers
  const openRows = rows.filter((r) => r.open);
  const allOpen = data.tables.flatMap((t) => t.checks.filter((c) => c.status === "open"));
  const closedToday = data.tables.flatMap((t) => t.checks.filter((c) => c.closed_at && c.status !== "void" && new Date(c.opened_at).getTime() >= dayStart));
  const avgSeated = allOpen.length ? allOpen.reduce((a, c) => a + (now - new Date(c.opened_at).getTime()), 0) / allOpen.length : 0;
  const avgTurn = closedToday.length ? closedToday.reduce((a, c) => a + (new Date(c.closed_at!).getTime() - new Date(c.opened_at).getTime()), 0) / closedToday.length : 0;
  const lateRows = rows.filter((r) => r.stage === "late");
  const longest = openRows.reduce((m, r) => Math.max(m, r.kitchenFor), 0);
  const guests = allOpen.reduce((a, c) => a + (c.guests || 0), 0);
  const sections = [...new Set(data.tables.map((t) => t.section))];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Tables seated" value={`${allOpen.length} / ${data.tables.length}`} sub={guests ? `${guests} guests` : "Guests not entered"} />
        <Stat label="Average time seated" value={allOpen.length ? dur(avgSeated) : "—"} sub="Open checks right now" />
        <Stat label="Average table turn" value={closedToday.length ? dur(avgTurn) : "—"} sub={`${closedToday.length} check${closedToday.length === 1 ? "" : "s"} closed today`} />
        <Stat label="Waiting on the kitchen" value={String(rows.filter((r) => r.stage === "kitchen" || r.stage === "late").length)} sub={lateRows.length ? `${lateRows.length} over ${LATE_MIN} min` : "None late"} warn={lateRows.length > 0} />
        <Stat label="Longest kitchen wait" value={longest ? dur(longest) : "—"} sub="Oldest ticket still open" warn={longest > LATE_MIN * MIN} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Seg value={win} onChange={setWin} options={[["2", "2 h"], ["4", "4 h"], ["8", "8 h"], ["day", "Today"]]} />
        <Seg value={sort} onChange={setSort} options={[["attention", "Needs attention"], ["longest", "Seated longest"], ["table", "By table"]]} />
        {sections.length > 1 && (
          <select value={section} onChange={(e) => setSection(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm">
            <option value="">Every section</option>{sections.map((x) => <option key={x}>{x}</option>)}
          </select>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showFree} onChange={(e) => setShowFree(e.target.checked)} className="size-4 accent-foreground" />Show free tables</label>
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(Object.keys(STAGE) as Stage[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className={cn("h-2.5 w-4 rounded-sm", STAGE[k].bar)} />{STAGE[k].label}</span>)}
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-[#d8d2c7]" />Earlier checks</span>
        </div>
      </div>

      {!rows.length ? <Empty>No tables have had a check today. Seated tables show up here as they open.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <div className="min-w-[760px]">
            {/* axis */}
            <div className="grid grid-cols-[120px_1fr_150px] border-b border-border text-[11px] text-muted-foreground">
              <div className="px-4 py-2">Table</div>
              <div className="relative h-8">
                {ticks.map((t) => <span key={t} className="absolute top-2 -translate-x-1/2 whitespace-nowrap" style={{ left: `${pct(t)}%` }}>{time(t)}</span>)}
                <span className="absolute top-2 -translate-x-1/2 font-semibold text-foreground" style={{ left: `${pct(now)}%` }}>Now</span>
              </div>
              <div />
            </div>
            {rows.map((r) => {
              const lt = r.live;
              const action = !r.open ? null : r.open.unsent > 0 ? `Send ${r.open.unsent} item${r.open.unsent === 1 ? "" : "s"}`
                : r.stage === "late" ? `Chase kitchen · ${dur(r.kitchenFor)}` : r.stage === "kitchen" ? `In kitchen · ${dur(r.kitchenFor)}`
                  : can(s.user, "pay") ? "Take payment" : "Print bill";
              return (
                <div key={r.t.id} className={cn("grid grid-cols-[120px_1fr_150px] items-center border-b border-border/60 last:border-0", r.stage === "late" && "bg-destructive/[0.04]")}>
                  <button onClick={() => lt && onOpen(lt)} className="px-4 py-3 text-left">
                    <div className="font-semibold">{r.t.name}</div>
                    <div className="text-[11px] text-muted-foreground">{r.open ? `${r.open.guests ? `${r.open.guests} guests · ` : ""}${dur(r.seatedFor)}` : `${r.t.seats} seats`}</div>
                  </button>
                  <div className="relative h-12">
                    {ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${pct(t)}%` }} />)}
                    <span className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${pct(now)}%` }} />
                    {r.t.checks.filter((c) => c.status !== "open").map((c) => {
                      const a = new Date(c.opened_at).getTime(), b = new Date(c.closed_at ?? c.opened_at).getTime();
                      if (b < start) return null;
                      return (
                        <div key={c.order_id} title={`#${c.number} · ${time(a)}–${time(b)} · ${dur(b - a)} · ${fmt(c.total)}${c.status === "void" ? " · voided" : ""}`}
                          className={cn("absolute top-1/2 h-4 -translate-y-1/2 rounded-md bg-[#d8d2c7]", c.status === "void" && "opacity-50")}
                          style={{ left: `${pct(a)}%`, width: `${Math.max(0.6, pct(b) - pct(a))}%` }}>
                          {c.fires.map((f) => <span key={f.number} className="absolute inset-y-0.5 w-0.5 rounded bg-white/90" style={{ left: `${((new Date(f.at).getTime() - a) / Math.max(1, b - a)) * 100}%` }} />)}
                        </div>
                      );
                    })}
                    {r.open && (
                      <button onClick={() => lt && onOpen(lt)} className="absolute top-1/2 flex h-7 -translate-y-1/2 overflow-hidden rounded-lg ring-1 ring-black/5"
                        style={{ left: `${pct(new Date(r.open.opened_at).getTime())}%`, width: `${Math.max(1, pct(now) - pct(new Date(r.open.opened_at).getTime()))}%` }}
                        title={[`#${r.open.number} · seated ${time(new Date(r.open.opened_at).getTime())}`, ...r.open.fires.map((f) => `Fire ${f.course ? `course ${f.course}` : `KOT ${f.number}`} at ${time(new Date(f.at).getTime())}${f.bumped_at ? `, done ${time(new Date(f.bumped_at).getTime())}` : ""}`), `${fmt(r.open.total)} so far`].join("\n")}>
                        {r.segs.filter((g) => g.to > start).map((g, i) => {
                          const total = Math.max(1, now - Math.max(start, new Date(r.open!.opened_at).getTime()));
                          const w = ((Math.min(g.to, now) - Math.max(g.from, start)) / total) * 100;
                          return <span key={i} className={cn("h-full", STAGE[g.stage].bar)} style={{ width: `${Math.max(0, w)}%` }} />;
                        })}
                        {r.open.fires.map((f) => {
                          const a0 = Math.max(start, new Date(r.open!.opened_at).getTime());
                          const x = ((new Date(f.at).getTime() - a0) / Math.max(1, now - a0)) * 100;
                          return x >= 0 ? <span key={f.number} className="absolute inset-y-1 w-0.5 rounded bg-white" style={{ left: `${x}%` }} /> : null;
                        })}
                        {new Date(r.open.opened_at).getTime() < start && <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white">◀</span>}
                      </button>
                    )}
                  </div>
                  <div className="px-3">
                    {r.open && lt && action ? (
                      <button onClick={() => onOpen(lt, r.stage === "served" && r.open!.unsent === 0)}
                        className={cn("w-full rounded-xl px-3 py-2 text-[12.5px] font-semibold",
                          r.open.unsent > 0 ? "bg-foreground text-background" : r.stage === "late" ? "bg-destructive/10 text-destructive"
                            : r.stage === "served" ? "bg-saffron text-[#1d1c1a]" : "bg-muted")}>
                        {action}
                      </button>
                    ) : <span className="block text-right text-xs text-muted-foreground">{r.t.checks.length ? `${r.t.checks.length} check${r.t.checks.length === 1 ? "" : "s"} today` : "Free"}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Each bar runs from seating to now. White ticks are fires to the kitchen; hover a bar for the times. Grey bars are checks already closed today.</p>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-xl font-semibold tabular", warn && "text-destructive")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
