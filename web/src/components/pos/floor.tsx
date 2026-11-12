"use client";

import { useState } from "react";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, Seg, run, useNow, usePoll, usePos } from "./shared";

export interface TableRow {
  id: string; name: string; seats: number; state: "free" | "unsent" | "kitchen" | "served";
  order_id: string | null; total: number; items: number; kitchen_since: string | null; opened_at: string | null;
}

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
  const { data: tables } = usePoll<TableRow[]>("/tables", 5000);

  async function open(t: TableRow, pay = false) {
    if (!can(s.user, "order")) return;
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

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-4">
        <Seg value={view} onChange={setView} options={[["map", "Map"], ["timeline", "Timeline"]]} />
        <span className="text-sm text-muted-foreground">{view === "map" ? "Tap a table to open its check" : "Sorted by who needs attention"}</span>
        {view === "map" && (
          <div className="ml-auto flex flex-wrap gap-4 text-xs text-muted-foreground">
            {(["unsent", "kitchen", "served"] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-full", STATE[k].dot)} />{STATE[k].label}</span>
            ))}
          </div>
        )}
      </div>

      {view === "map" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {tables?.map((t) => {
            const st = STATE[t.state];
            return (
              <button key={t.id} onClick={() => open(t)}
                className={cn("flex flex-col items-start rounded-[20px] p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg",
                  st.bg, st.bd, t.seats >= 6 ? "min-h-40 sm:col-span-1" : "min-h-32")}>
                <div className="flex w-full items-start justify-between">
                  <span className="text-2xl font-semibold">{t.name}</span>
                  {t.state !== "free" && <span className="font-mono text-sm font-semibold tabular">{fmt(t.total)}</span>}
                </div>
                <div className="mt-auto text-[13px] text-[#5d5a53]">
                  {t.state === "free" ? `${t.seats} seats` : `${st.label} · ${t.items} items`}
                </div>
              </button>
            );
          })}
        </div>
      ) : timeline.length === 0 ? (
        <Empty>No open tables. Everyone&apos;s been served.</Empty>
      ) : (
        <div className="space-y-2.5">
          {timeline.map(({ t, age, late }) => {
            const w = t.state === "unsent" ? 18 : t.state === "kitchen" ? 45 : 80;
            const c = late ? "bg-chili" : STATE[t.state].dot;
            const action = t.state === "unsent" ? "Send KOT" : late ? `Late · ${Math.floor(age)}m` : t.state === "kitchen" ? `In kitchen · ${Math.floor(age)}m` : can(s.user, "pay") ? "Take payment" : "Request bill";
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
    </div>
  );
}
