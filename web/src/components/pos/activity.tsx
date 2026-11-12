"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Empty, Seg, usePoll, usePos } from "./shared";

export interface AuditRow {
  id: string; action: string; user: string; order_id: string | null; order_number: number | null;
  detail: string; amount: number | null; created_at: string;
}

export const ACTION: Record<string, { l: string; tone: string }> = {
  discount: { l: "Discount", tone: "bg-saffron/20 text-saffron-deep" },
  discount_removed: { l: "Discount removed", tone: "bg-muted text-muted-foreground" },
  comp: { l: "Comp", tone: "bg-saffron/20 text-saffron-deep" },
  comp_removed: { l: "Comp removed", tone: "bg-muted text-muted-foreground" },
  item_removed: { l: "Fired item removed", tone: "bg-destructive/10 text-destructive" },
  void: { l: "Void", tone: "bg-destructive/10 text-destructive" },
  refund: { l: "Refund", tone: "bg-destructive/10 text-destructive" },
  reopen: { l: "Reopened", tone: "bg-sky/15 text-sky" },
  moved: { l: "Moved", tone: "bg-muted text-muted-foreground" },
  merged: { l: "Merged", tone: "bg-muted text-muted-foreground" },
  cash_in: { l: "Cash paid in", tone: "bg-leaf/15 text-[oklch(0.45_0.12_150)]" },
  cash_out: { l: "Cash paid out", tone: "bg-saffron/20 text-saffron-deep" },
  drawer_closed: { l: "Drawer closed", tone: "bg-muted text-muted-foreground" },
  price_change: { l: "Price change", tone: "bg-sky/15 text-sky" },
  tax_change: { l: "Tax change", tone: "bg-sky/15 text-sky" },
  role_change: { l: "Role change", tone: "bg-sky/15 text-sky" },
  pin_reset: { l: "PIN reset", tone: "bg-muted text-muted-foreground" },
  staff_activated: { l: "Staff reactivated", tone: "bg-muted text-muted-foreground" },
  staff_deactivated: { l: "Staff deactivated", tone: "bg-muted text-muted-foreground" },
};

const GROUPS: Record<string, string> = {
  all: "",
  money: "discount,discount_removed,comp,comp_removed,void,refund,reopen,item_removed",
  cash: "cash_in,cash_out,drawer_closed",
  admin: "price_change,tax_change,role_change,pin_reset,staff_activated,staff_deactivated",
};

export function ActivityList({ rows, fmt, tz, compact }: { rows: AuditRow[]; fmt: (v: number) => string; tz?: string; compact?: boolean }) {
  const at = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }); }
    catch { return new Date(iso).toLocaleTimeString(); }
  };
  return (
    <div className={cn(!compact && "overflow-hidden rounded-2xl border border-border bg-card")}>
      {rows.map((r) => {
        const a = ACTION[r.action] ?? { l: r.action, tone: "bg-muted" };
        return (
          <div key={r.id} className={cn("grid grid-cols-[auto_1fr_auto] items-start gap-3", compact ? "py-1.5 text-sm" : "border-b border-border/60 px-5 py-3.5 last:border-0")}>
            <span className={cn("mt-0.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", a.tone)}>{a.l}</span>
            <div className="min-w-0">
              <div className={cn("truncate", !compact && "font-medium")}>{r.detail || (r.order_number ? `Check #${r.order_number}` : "")}</div>
              <div className="text-xs text-muted-foreground">
                {r.user} · {at(r.created_at)}{!compact && r.order_number ? ` · check #${r.order_number}` : ""}
              </div>
            </div>
            {r.amount != null && <span className="font-mono text-sm">{fmt(r.amount)}</span>}
          </div>
        );
      })}
    </div>
  );
}

const todayIn = (tz?: string) => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined }).format(new Date()); }
  catch { return new Intl.DateTimeFormat("en-CA").format(new Date()); }
};

export function ActivityScreen() {
  const { s, fmt } = usePos();
  const tz = s.tenant?.timezone;
  const [day, setDay] = useState(() => todayIn(tz));
  const [group, setGroup] = useState("all");
  const { data: rows } = usePoll<AuditRow[]>(`/audit?day=${day}&action=${GROUPS[group]}`, 60000, "audit");
  const money = (rows ?? []).filter((r) => ["discount", "comp", "void", "refund", "item_removed"].includes(r.action));
  const total = (k: string) => money.filter((r) => r.action === k).reduce((a, r) => a + (r.amount ?? 0), 0);

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" value={day} max={todayIn(tz)} onChange={(e) => setDay(e.target.value || todayIn(tz))} className="h-10 w-44 bg-card" />
        <Seg value={group} onChange={setGroup} options={[["all", "Everything"], ["money", "Discounts, voids & refunds"], ["cash", "Cash"], ["admin", "Menu & staff"]]} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Discounts", "discount"], ["Comps", "comp"], ["Voids", "void"], ["Refunds", "refund"]].map(([l, k]) => (
          <div key={k} className="rounded-2xl border border-border bg-card p-4">
            <div className="text-sm text-muted-foreground">{l} · {money.filter((r) => r.action === k).length}</div>
            <div className="mt-1 font-mono text-2xl font-semibold">{fmt(total(k))}</div>
          </div>
        ))}
      </div>
      {rows && rows.length === 0 ? <Empty>Nothing recorded for this day.</Empty> : rows && <ActivityList rows={rows} fmt={fmt} tz={tz} />}
    </div>
  );
}
