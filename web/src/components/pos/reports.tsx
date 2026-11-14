"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { API_URL, hasModule, session } from "@/lib/api";
import { cn } from "@/lib/utils";
import { type DrawerReport, esc, header, printHtml } from "./print";
import { Empty, METHOD_LABEL, Seg, usePoll, usePos } from "./shared";

/* ---------- Types (mirror api/app/routers/reports.py) ---------- */

interface Totals {
  gross_sales: number; comps: number; discounts: number; net_sales: number; tax: number; tips: number; refunds: number;
  refund_count: number; total_collected: number; orders: number; avg_check: number; guests: number; per_guest: number;
}
interface Day { date: string; orders: number; net_sales: number; gross_sales: number; comps: number; discounts: number; tax: number; tips: number; refunds: number; guests: number; avg_check: number }
interface Overview { totals: Totals; previous?: Totals; by_day: Day[]; previous_by_day?: Day[]; heatmap: { net: number[][]; orders: number[][] } }
interface Item { menu_item_id: string | null; name: string; category: string; qty: number; comp_qty: number; gross_sales: number; comps: number; net_sales: number; pct_sales: number; avg_price: number; orders: number }
interface Cat { category: string; items: number; qty: number; net_sales: number; pct_sales: number }
interface Items {
  total_net: number; total_qty: number; items: Item[]; categories: Cat[]; top: Item[]; bottom: Item[];
  modifiers: { group: string; name: string; qty: number; revenue: number }[];
  previous?: { total_net: number; items: Record<string, { qty: number; net_sales: number }>; categories: Record<string, { qty: number; net_sales: number }> };
}
interface Method { method: string; count: number; amount: number; tips: number; refund_count: number; refunds: number; net: number; pct: number }
interface Channel { channel: string; orders: number; net_sales: number; guests: number; tips: number; avg_check: number; pct_sales: number }
interface Payments { methods: Method[]; channels: Channel[]; previous?: { methods: Method[]; channels: Channel[] } }
interface StaffRow {
  user_id: string | null; name: string; role: string; orders: number; guests: number; net_sales: number; avg_check: number; tips: number;
  payments: number; collected: number; discount_count: number; discounts: number; comp_count: number; comps: number;
  void_count: number; voids: number; refund_count: number; refunds: number;
}
interface Staff { staff: StaffRow[]; previous?: StaffRow[] }
type Summary = Record<string, { count: number; amount: number }>;
interface Exceptions { summary: Summary; previous?: Summary; rows: { id: string; action: string; user: string; order_number: number | null; detail: string; amount: number | null; created_at: string }[] }
interface Tax {
  label: string; rate: number; taxable: number; tax: number; effective_rate: number; days: { date: string; orders: number; taxable: number; tax: number }[];
  previous?: { taxable: number; tax: number };
  by_rate?: { name: string; rate: number; taxable: number; tax: number }[];
  hsn?: { hsn: string; rate: number; qty: number; taxable: number; tax: number }[];
  b2b_invoices?: number; credit_notes?: { count: number; amount: number; tax: number };
}
interface Eod {
  date: string; tax_label: string; totals: Totals; payments: Method[]; channels: Channel[]; exceptions: Summary; voided_checks: number;
  open_checks: number; open_value: number; first_order_at: string | null; last_order_at: string | null; hours: number[];
  drawers: DrawerReport[]; drawer_totals: { expected: number; counted: number; over_short: number };
}

/* ---------- Labels & helpers ---------- */

export const CHANNEL_LABEL: Record<string, string> = {
  dine_in: "Dine-in", takeaway: "Takeaway", website: "Website", swiggy: "Swiggy", zomato: "Zomato", doordash: "DoorDash", ubereats: "Uber Eats",
};
const ACTION_LABEL: Record<string, string> = {
  discount: "Discounts", comp: "Comps", void: "Voids", refund: "Refunds", item_removed: "Items removed", reopen: "Checks reopened",
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Preset = "today" | "yesterday" | "7d" | "month" | "last_month" | "custom";
type Tab = "overview" | "items" | "staff" | "payments" | "exceptions" | "tax" | "eod";

/** Today's date (YYYY-MM-DD) in the restaurant's time zone. */
function todayIn(tz?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

function rangeFor(p: Preset, today: string): [string, string] {
  const d = parse(today);
  switch (p) {
    case "today": return [today, today];
    case "yesterday": { const y = addDays(today, -1); return [y, y]; }
    case "7d": return [addDays(today, -6), today];
    case "month": return [iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), today];
    case "last_month": return [iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))), iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)))];
    default: return [today, today];
  }
}

const shortDate = (s: string) => parse(s).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
const timeOf = (s: string | null) => (s ? new Date(s).toLocaleTimeString([], { timeStyle: "short" }) : "—");
const pct = (v: number) => `${v.toFixed(1)}%`;

function delta(cur: number, prev: number | undefined) {
  if (prev === undefined) return null;
  if (!prev) return cur ? { t: "New", up: true } : null;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  return { t: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`, up: d >= 0 };
}

async function downloadCsv(report: string, start: string, end: string) {
  try {
    const token = session.get()?.token;
    const res = await fetch(`${API_URL}/reports/export.csv?report=${report}&start=${start}&end=${end}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || "Couldn't export");
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `${report}.csv`;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

/* ---------- Screen ---------- */

export function ReportsScreen() {
  const { s } = usePos();
  const today = todayIn(s.tenant?.timezone);
  const [preset, setPreset] = useState<Preset>("today");
  const [custom, setCustom] = useState<[string, string]>([addDays(today, -6), today]);
  const [compare, setCompare] = useState(true);
  const [picked, setTab] = useState<Tab>("overview");
  const plus = hasModule(s.tenant, "reports_plus");
  const tab: Tab = plus || picked === "overview" || picked === "eod" ? picked : "overview";
  const [start, end] = preset === "custom" ? custom : rangeFor(preset, today);
  const q = `start=${start}&end=${end}${compare ? "&compare=1" : ""}`;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <div className="overflow-x-auto">
          <Seg value={preset} onChange={setPreset} options={[["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["month", "This month"], ["last_month", "Last month"], ["custom", "Custom"]]} />
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" value={custom[0]} max={custom[1]} onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])} className="h-9 w-40" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={custom[1]} min={custom[0]} max={today} onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])} className="h-9 w-40" />
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="size-4 accent-foreground" />
          Compare with the period before
        </label>
        <span className="ml-auto text-sm text-muted-foreground">{start === end ? shortDate(start) : `${shortDate(start)} – ${shortDate(end)}`}</span>
      </div>
      <div className="shrink-0 overflow-x-auto">
        <Seg value={tab} onChange={setTab} options={plus
          ? [["overview", "Overview"], ["items", "Items"], ["staff", "Staff"], ["payments", "Payments & channels"], ["exceptions", "Exceptions"], ["tax", "Tax"], ["eod", "End of day"]]
          : [["overview", "Overview"], ["eod", "End of day"]]} />
      </div>
      {tab === "overview" && <OverviewTab q={q} start={start} end={end} />}
      {tab === "items" && <ItemsTab q={q} start={start} end={end} />}
      {tab === "staff" && <StaffTab q={q} start={start} end={end} />}
      {tab === "payments" && <PaymentsTab q={q} start={start} end={end} />}
      {tab === "exceptions" && <ExceptionsTab q={q} start={start} end={end} />}
      {tab === "tax" && <TaxTab q={q} start={start} end={end} />}
      {tab === "eod" && <EodTab day={end} today={today} />}
    </div>
  );
}

type TabProps = { q: string; start: string; end: string };

/* ---------- Building blocks ---------- */

function Card({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-2xl border border-border bg-card p-5", className)}>
      {(title || action) && <div className="mb-4 flex items-center gap-3"><div className="font-semibold">{title}</div><div className="ml-auto">{action}</div></div>}
      {children}
    </div>
  );
}

function Kpi({ label, value, d, invert, sub }: { label: string; value: string; d?: ReturnType<typeof delta>; invert?: boolean; sub?: string }) {
  const good = d ? (invert ? !d.up : d.up) : true;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-1.5 font-mono text-xl font-semibold tabular md:text-2xl">{value}</div>
      <div className={cn("mt-1 text-xs", d ? (good ? "text-[oklch(0.5_0.13_150)]" : "text-destructive") : "text-muted-foreground")}>
        {d ? `${d.t} vs before` : sub ?? " "}
      </div>
    </div>
  );
}

function CsvButton({ report, start, end }: { report: string; start: string; end: string }) {
  const { s } = usePos();
  if (!hasModule(s.tenant, "reports_plus")) return null; // CSV export is part of Advanced reports
  return (
    <button onClick={() => downloadCsv(report, start, end)} className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-semibold">
      <Download className="size-3.5" />CSV
    </button>
  );
}

function Table({ head, rows, align }: { head: string[]; rows: React.ReactNode[][]; align?: ("l" | "r")[] }) {
  if (!rows.length) return <Empty>Nothing in this period.</Empty>;
  const a = (i: number) => (align?.[i] ?? (i === 0 ? "l" : "r")) === "r" ? "text-right" : "text-left";
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[520px] text-sm">
        <thead><tr className="border-b border-border text-xs text-muted-foreground">{head.map((h, i) => <th key={h} className={cn("pb-2 font-medium", a(i))}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, j) => (
            <tr key={j} className="border-b border-border/60 last:border-0">
              {r.map((c, i) => <td key={i} className={cn("py-2.5", i > 0 && "font-mono tabular", a(i))}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Share({ v }: { v: number }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block"><span className="block h-full rounded-full bg-saffron" style={{ width: `${Math.min(100, v)}%` }} /></span>
      {pct(v)}
    </span>
  );
}

function Loading({ data, error }: { data: unknown; error: string | null }) {
  if (error) return <Card><Empty>{error}</Empty></Card>;
  if (!data) return <Card><Empty>Loading…</Empty></Card>;
  return null;
}

/* ---------- Overview ---------- */

function OverviewTab({ q, start, end }: TabProps) {
  const { fmt, s } = usePos();
  const { data, error } = usePoll<Overview>(`/reports/overview?${q}`, 60000, "orders");
  if (!data) return <Loading data={data} error={error} />;
  const t = data.totals, p = data.previous;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Net sales" value={fmt(t.net_sales)} d={delta(t.net_sales, p?.net_sales)} />
        <Kpi label="Checks" value={String(t.orders)} d={delta(t.orders, p?.orders)} />
        <Kpi label="Average check" value={fmt(t.avg_check)} d={delta(t.avg_check, p?.avg_check)} />
        <Kpi label="Guests" value={String(t.guests)} d={delta(t.guests, p?.guests)} sub={t.guests ? `${fmt(t.per_guest)} per guest` : undefined} />
        <Kpi label="Gross sales" value={fmt(t.gross_sales)} d={delta(t.gross_sales, p?.gross_sales)} />
        <Kpi label="Discounts & comps" value={fmt(t.discounts + t.comps)} d={delta(t.discounts + t.comps, p ? p.discounts + p.comps : undefined)} invert
          sub={`Discounts ${fmt(t.discounts)} · comps ${fmt(t.comps)}`} />
        <Kpi label={s.tenant?.tips_enabled ? "Tips" : "Tax"} value={fmt(s.tenant?.tips_enabled ? t.tips : t.tax)}
          d={delta(s.tenant?.tips_enabled ? t.tips : t.tax, p ? (s.tenant?.tips_enabled ? p.tips : p.tax) : undefined)} />
        <Kpi label="Refunds" value={fmt(t.refunds)} d={delta(t.refunds, p?.refunds)} invert sub={`${t.refund_count} refund${t.refund_count === 1 ? "" : "s"}`} />
      </div>
      <Card title="Collected" className="py-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {[["Net sales", t.net_sales], ["Tax", t.tax], ["Tips", t.tips], ["Refunds", -t.refunds], ["Total collected", t.total_collected]].map(([l, v]) => (
            <div key={l as string}><div className="text-muted-foreground">{l}</div><div className={cn("font-mono tabular", l === "Total collected" && "font-semibold")}>{fmt(v as number)}</div></div>
          ))}
        </div>
      </Card>
      <Card title={start === end ? "Sales by hour" : "Net sales by day"} action={<CsvButton report="sales_by_day" start={start} end={end} />}>
        {start === end
          ? <Bars labels={Array.from({ length: 24 }, (_, h) => String(h))} values={data.heatmap.net.reduce((acc, row) => acc.map((v, i) => v + row[i]), Array(24).fill(0) as number[])} fmt={fmt} />
          : <Bars labels={data.by_day.map((d) => shortDate(d.date))} values={data.by_day.map((d) => d.net_sales)} prev={data.previous_by_day?.map((d) => d.net_sales)} fmt={fmt} />}
      </Card>
      {start !== end && <Card title="Busiest times (net sales by weekday and hour)"><Heatmap net={data.heatmap.net} fmt={fmt} /></Card>}
    </>
  );
}

function Bars({ labels, values, prev, fmt }: { labels: string[]; values: number[]; prev?: number[]; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values, ...(prev ?? []));
  const every = Math.ceil(labels.length / 12);
  return (
    <div>
      <div className="mb-2 h-5 font-mono text-sm text-muted-foreground">
        {hover != null ? `${labels[hover]} · ${fmt(values[hover])}${prev?.[hover] != null ? ` (before: ${fmt(prev[hover])})` : ""}` : prev ? "Bars: this period · outline: the period before" : " "}
      </div>
      <div className="flex h-48 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
        {values.map((v, i) => (
          <div key={i} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            {prev?.[i] != null && <div className="absolute inset-x-0 bottom-0 rounded-t-sm border border-b-0 border-foreground/30" style={{ height: `${(prev[i] / max) * 100}%` }} />}
            <div className={cn("relative rounded-t-sm transition-colors", hover === i ? "bg-saffron" : "bg-foreground")} style={{ height: `${Math.max(1, (v / max) * 100)}%`, opacity: v ? 1 : 0.15 }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {labels.map((l, i) => <span key={i} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground">{i % every === 0 ? l : ""}</span>)}
      </div>
    </div>
  );
}

function Heatmap({ net, fmt }: { net: number[][]; fmt: (v: number) => string }) {
  const max = Math.max(1, ...net.flat());
  const hours = net[0].map((_, h) => h).filter((h) => net.some((r) => r[h]));
  if (!hours.length) return <Empty>No sales in this period.</Empty>;
  const cols = Array.from({ length: hours[hours.length - 1] - hours[0] + 1 }, (_, i) => hours[0] + i);
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <div className="inline-grid gap-[3px]" style={{ gridTemplateColumns: `2.5rem repeat(${cols.length}, minmax(1.6rem, 1fr))` }}>
        <span />
        {cols.map((h) => <span key={h} className="text-center text-[10px] text-muted-foreground">{h}</span>)}
        {net.map((row, d) => (
          <div key={d} className="contents">
            <span className="text-xs text-muted-foreground">{WEEKDAYS[d]}</span>
            {cols.map((h) => (
              <span key={h} title={`${WEEKDAYS[d]} ${h}:00 · ${fmt(row[h])}`} className="h-6 rounded-[4px] bg-saffron"
                style={{ opacity: row[h] ? 0.15 + 0.85 * (row[h] / max) : 0.06 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Items ---------- */

function ItemsTab({ q, start, end }: TabProps) {
  const { fmt } = usePos();
  const { data, error } = usePoll<Items>(`/reports/items?${q}`, 60000, "orders");
  const [all, setAll] = useState(false);
  if (!data) return <Loading data={data} error={error} />;
  const prev = data.previous;
  const change = (cur: number, before: number | undefined) => {
    const d = delta(cur, before ?? (prev ? 0 : undefined));
    return d ? <span className={cn("ml-1.5 text-[11px]", d.up ? "text-[oklch(0.5_0.13_150)]" : "text-destructive")}>{d.t}</span> : null;
  };
  const list = all ? data.items : data.items.slice(0, 15);
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Categories">
          <Table head={["Category", "Qty", "Net sales", "Share"]} rows={data.categories.map((c) => [
            c.category, c.qty, <>{fmt(c.net_sales)}{change(c.net_sales, prev?.categories[c.category]?.net_sales)}</>, <Share key="s" v={c.pct_sales} />])} />
        </Card>
        <Card title="Most and least ordered">
          <div className="grid gap-4 sm:grid-cols-2">
            {[["Top sellers", data.top], ["Slowest sellers", data.bottom]].map(([l, rows]) => (
              <div key={l as string}>
                <div className="mb-2 text-xs font-medium text-muted-foreground">{l as string}</div>
                {(rows as Item[]).length ? (rows as Item[]).slice(0, 8).map((i) => (
                  <div key={i.name} className="flex justify-between gap-2 py-1 text-sm"><span className="truncate">{i.name}</span><span className="font-mono tabular">{i.qty}</span></div>
                )) : <div className="text-sm text-muted-foreground">Not enough items yet.</div>}
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Items" action={<CsvButton report="items" start={start} end={end} />}>
        <Table head={["Item", "Qty", "Comped", "Net sales", "Share", "Avg price"]} rows={list.map((i) => [
          <span key="n"><span className="font-medium">{i.name}</span><span className="block text-xs text-muted-foreground">{i.category}</span></span>,
          <>{i.qty}{change(i.qty, prev?.items[`${i.menu_item_id}|${i.name}`]?.qty)}</>, i.comp_qty || "—", fmt(i.net_sales), <Share key="s" v={i.pct_sales} />, fmt(i.avg_price)])} />
        {data.items.length > 15 && (
          <button onClick={() => setAll(!all)} className="mt-3 text-sm font-medium hover:underline">{all ? "Show fewer" : `Show all ${data.items.length} items`}</button>
        )}
      </Card>
      {!!data.modifiers.length && (
        <Card title="Modifiers">
          <Table head={["Choice", "Group", "Times picked", "Extra charged"]} align={["l", "l", "r", "r"]}
            rows={data.modifiers.map((m) => [m.name, <span key="g" className="font-sans text-muted-foreground">{m.group}</span>, m.qty, m.revenue ? fmt(m.revenue) : "—"])} />
        </Card>
      )}
    </>
  );
}

/* ---------- Staff ---------- */

function StaffTab({ q, start, end }: TabProps) {
  const { fmt } = usePos();
  const { data, error } = usePoll<Staff>(`/reports/staff?${q}`, 60000, "orders");
  if (!data) return <Loading data={data} error={error} />;
  const before = new Map((data.previous ?? []).map((r) => [r.user_id, r]));
  return (
    <Card title="Staff performance" action={<CsvButton report="staff" start={start} end={end} />}>
      <Table head={["Staff", "Checks", "Net sales", "Avg check", "Tips", "Collected", "Discounts", "Comps", "Voids", "Refunds"]}
        rows={data.staff.map((r) => {
          const d = data.previous ? delta(r.net_sales, before.get(r.user_id)?.net_sales ?? 0) : null;
          return [
            <span key="n"><span className="font-medium">{r.name}</span><span className="block text-xs capitalize text-muted-foreground">{r.role}</span></span>,
            r.orders, <>{fmt(r.net_sales)}{d && <span className={cn("ml-1.5 text-[11px]", d.up ? "text-[oklch(0.5_0.13_150)]" : "text-destructive")}>{d.t}</span>}</>,
            fmt(r.avg_check), fmt(r.tips), fmt(r.collected),
            r.discount_count ? `${r.discount_count} · ${fmt(r.discounts)}` : "—", r.comp_count ? `${r.comp_count} · ${fmt(r.comps)}` : "—",
            r.void_count ? `${r.void_count} · ${fmt(r.voids)}` : "—", r.refund_count ? `${r.refund_count} · ${fmt(r.refunds)}` : "—",
          ];
        })} />
      <p className="mt-3 text-xs text-muted-foreground">Checks and sales count toward whoever opened the check; collected counts toward whoever took the payment.</p>
    </Card>
  );
}

/* ---------- Payments & channels ---------- */

function PaymentsTab({ q, start, end }: TabProps) {
  const { fmt } = usePos();
  const { data, error } = usePoll<Payments>(`/reports/payments?${q}`, 60000, "orders");
  if (!data) return <Loading data={data} error={error} />;
  const prevM = new Map((data.previous?.methods ?? []).map((m) => [m.method, m.net]));
  const prevC = new Map((data.previous?.channels ?? []).map((c) => [c.channel, c.net_sales]));
  const ch = (cur: number, b: number | undefined) => {
    const d = data.previous ? delta(cur, b ?? 0) : null;
    return d ? <span className={cn("ml-1.5 text-[11px]", d.up ? "text-[oklch(0.5_0.13_150)]" : "text-destructive")}>{d.t}</span> : null;
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Payment methods" action={<CsvButton report="payments" start={start} end={end} />}>
        <Table head={["Method", "Payments", "Amount", "Tips", "Refunded", "Net", "Share"]} rows={data.methods.map((m) => [
          METHOD_LABEL[m.method] ?? m.method, m.count, fmt(m.amount), fmt(m.tips), m.refunds ? `−${fmt(m.refunds)}` : "—",
          <>{fmt(m.net)}{ch(m.net, prevM.get(m.method))}</>, <Share key="s" v={m.pct} />])} />
      </Card>
      <Card title="Channels" action={<CsvButton report="channels" start={start} end={end} />}>
        <Table head={["Channel", "Checks", "Net sales", "Avg check", "Share"]} rows={data.channels.map((c) => [
          CHANNEL_LABEL[c.channel] ?? c.channel, c.orders, <>{fmt(c.net_sales)}{ch(c.net_sales, prevC.get(c.channel))}</>, fmt(c.avg_check), <Share key="s" v={c.pct_sales} />])} />
      </Card>
    </div>
  );
}

/* ---------- Exceptions ---------- */

function ExceptionsTab({ q, start, end }: TabProps) {
  const { fmt } = usePos();
  const { data, error } = usePoll<Exceptions>(`/reports/exceptions?${q}`, 60000, ["orders", "audit"]);
  const [kind, setKind] = useState<string>("all");
  if (!data) return <Loading data={data} error={error} />;
  const rows = kind === "all" ? data.rows : data.rows.filter((r) => r.action === kind);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Object.entries(ACTION_LABEL).map(([k, l]) => {
          const v = data.summary[k] ?? { count: 0, amount: 0 };
          return (
            <button key={k} onClick={() => setKind(kind === k ? "all" : k)} className={cn("rounded-2xl border bg-card p-4 text-left", kind === k ? "border-foreground" : "border-border")}>
              <div className="text-sm text-muted-foreground">{l}</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular">{v.count}</div>
              <div className="text-xs text-muted-foreground">
                {v.amount ? fmt(v.amount) : " "}
                {data.previous && ` · before ${data.previous[k]?.count ?? 0}`}
              </div>
            </button>
          );
        })}
      </div>
      <Card title={kind === "all" ? "Everything" : ACTION_LABEL[kind]} action={<CsvButton report="exceptions" start={start} end={end} />}>
        <Table head={["When", "Type", "Check", "By", "Amount", "Reason / detail"]} align={["l", "l", "r", "l", "r", "l"]}
          rows={rows.map((r) => [
            new Date(r.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }),
            <span key="t" className="font-sans">{ACTION_LABEL[r.action]?.replace(/s$/, "") ?? r.action}</span>,
            r.order_number ? `#${r.order_number}` : "—", <span key="u" className="font-sans">{r.user}</span>,
            r.amount != null ? fmt(r.amount) : "—", <span key="d" className="font-sans text-muted-foreground">{r.detail}</span>,
          ])} />
      </Card>
    </>
  );
}

/* ---------- Tax ---------- */

function TaxTab({ q, start, end }: TabProps) {
  const { fmt, s } = usePos();
  const { data, error } = usePoll<Tax>(`/reports/tax?${q}`, 60000, "orders");
  if (!data) return <Loading data={data} error={error} />;
  const days = data.days.filter((d) => d.orders);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Taxable sales" value={fmt(data.taxable)} d={data.previous ? delta(data.taxable, data.previous.taxable) : null} />
        <Kpi label={`${data.label || "Tax"} collected`} value={fmt(data.tax)} d={data.previous ? delta(data.tax, data.previous.tax) : null} />
        <Kpi label="Tax rate" value={`${data.rate.toFixed(3).replace(/\.?0+$/, "")}%`} sub="Set in Settings → Taxes" />
        <Kpi label="Effective rate" value={`${data.effective_rate.toFixed(2)}%`} sub="Collected ÷ taxable (rounding)" />
      </div>
      {!!data.by_rate?.length && (
        <Card title="By tax component">
          <Table head={["Tax", "Rate", "Taxable value", "Tax"]} rows={data.by_rate.map((r) => [r.name, `${r.rate}%`, fmt(r.taxable), fmt(r.tax)])} />
        </Card>
      )}
      {!!data.hsn?.length && s.tenant?.market === "IN" && (
        <Card title={`HSN summary${data.b2b_invoices ? ` · ${data.b2b_invoices} B2B invoice${data.b2b_invoices === 1 ? "" : "s"}` : ""}`}>
          <Table head={["HSN / SAC", "GST rate", "Qty", "Taxable value", "Tax"]} rows={data.hsn.map((h) => [h.hsn, `${h.rate}%`, h.qty, fmt(h.taxable), fmt(h.tax)])} />
        </Card>
      )}
      <Card title="By day" action={<CsvButton report="tax" start={start} end={end} />}>
        <Table head={["Date", "Checks", "Taxable", "Tax"]} rows={days.map((d) => [shortDate(d.date), d.orders, fmt(d.taxable), fmt(d.tax)])} />
      </Card>
    </>
  );
}

/* ---------- End of day ---------- */

function EodTab({ day: initial, today }: { day: string; today: string }) {
  const { fmt, s } = usePos();
  const [day, setDay] = useState(initial);
  const { data, error } = usePoll<Eod>(`/reports/eod?date=${day}`, 60000, ["orders", "cash"]);
  const hourMax = useMemo(() => Math.max(1, ...(data?.hours ?? [])), [data]);
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-9 w-40" />
      {data && <button onClick={() => printEod(data, s.tenant, fmt)} className="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-semibold text-background"><Printer className="size-4" />Print</button>}
      <CsvButton report="orders" start={day} end={day} />
    </div>
  );
  if (!data) return <>{controls}<Loading data={data} error={error} /></>;
  const t = data.totals;
  return (
    <>
      {controls}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Net sales" value={fmt(t.net_sales)} sub={`${t.orders} checks · avg ${fmt(t.avg_check)}`} />
        <Kpi label="Total collected" value={fmt(t.total_collected)} sub={`Tax ${fmt(t.tax)} · tips ${fmt(t.tips)}`} />
        <Kpi label="Open checks" value={String(data.open_checks)} sub={data.open_checks ? `${fmt(data.open_value)} not yet paid` : "All checks closed"} />
        <Kpi label="Service" value={`${timeOf(data.first_order_at)} – ${timeOf(data.last_order_at)}`} sub="First check opened · last closed" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sales">
          {[["Gross sales", t.gross_sales], ["Comps", -t.comps], ["Discounts", -t.discounts], ["Net sales", t.net_sales], [data.tax_label || "Tax", t.tax], ["Tips", t.tips], ["Refunds", -t.refunds], ["Total collected", t.total_collected]]
            .map(([l, v]) => <Row key={l as string} l={l as string} v={fmt(v as number)} strong={l === "Net sales" || l === "Total collected"} />)}
          <Row l="Voided checks" v={String(data.voided_checks)} />
        </Card>
        <Card title="Payments">
          {data.payments.length ? data.payments.map((m) => <Row key={m.method} l={`${METHOD_LABEL[m.method] ?? m.method} (${m.count})`} v={fmt(m.net)} />) : <Empty>No payments.</Empty>}
          {!!data.channels.length && <div className="mt-3 border-t border-border pt-3">{data.channels.map((c) => <Row key={c.channel} l={`${CHANNEL_LABEL[c.channel] ?? c.channel} (${c.orders})`} v={fmt(c.net_sales)} />)}</div>}
        </Card>
        <Card title="Cash drawers">
          {data.drawers.length ? (
            <>
              {data.drawers.map((d, i) => (
                <div key={i} className="mb-3 rounded-xl bg-muted/60 p-3 text-sm">
                  <div className="font-medium">{timeOf(d.opened_at)} – {d.closed_at ? timeOf(d.closed_at) : "still open"}{d.opened_by ? ` · ${d.opened_by}` : ""}</div>
                  <Row l="Expected" v={fmt(d.expected_cash)} />
                  {d.counted_cash != null && <><Row l="Counted" v={fmt(d.counted_cash)} /><Row l="Over / short" v={fmt(d.difference ?? 0)} strong /></>}
                </div>
              ))}
              <Row l="Over / short (closed drawers)" v={fmt(data.drawer_totals.over_short)} strong />
            </>
          ) : <Empty>No cash drawer opened this day.</Empty>}
        </Card>
        <Card title="Exceptions">
          {Object.entries(ACTION_LABEL).map(([k, l]) => <Row key={k} l={l} v={`${data.exceptions[k]?.count ?? 0}${data.exceptions[k]?.amount ? ` · ${fmt(data.exceptions[k].amount)}` : ""}`} />)}
        </Card>
      </div>
      <Card title="Sales by hour">
        <div className="flex h-32 items-end gap-[3px]">
          {data.hours.map((v, h) => <div key={h} title={`${h}:00 · ${fmt(v)}`} className="flex-1 rounded-t-sm bg-foreground" style={{ height: `${Math.max(1, (v / hourMax) * 100)}%`, opacity: v ? 1 : 0.15 }} />)}
        </div>
        <div className="mt-1.5 flex gap-[3px]">{data.hours.map((_, h) => <span key={h} className="flex-1 text-center text-[10px] text-muted-foreground">{h % 3 === 0 ? h : ""}</span>)}</div>
      </Card>
    </>
  );
}

function Row({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return <div className={cn("flex justify-between gap-3 py-1 text-sm", strong && "font-semibold")}><span className={strong ? "" : "text-muted-foreground"}>{l}</span><span className="font-mono tabular">{v}</span></div>;
}

function printEod(d: Eod, tenant: Parameters<typeof header>[0], fmt: (v: number) => string) {
  const r = (l: string, v: string, b = false) => `<div class="r${b ? " b" : ""}"><span>${esc(l)}</span><span>${v}</span></div>`;
  const t = d.totals;
  const day = parse(d.date).toLocaleDateString(undefined, { dateStyle: "full", timeZone: "UTC" });
  const body = `${header(tenant)}<hr><div class="c b">END OF DAY</div><div class="c">${esc(day)}</div>
    <div class="c">Printed ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</div><hr>
    ${r("Gross sales", fmt(t.gross_sales))}${r("Comps", "−" + fmt(t.comps))}${r("Discounts", "−" + fmt(t.discounts))}
    ${r("Net sales", fmt(t.net_sales), true)}${r(d.tax_label || "Tax", fmt(t.tax))}${r("Tips", fmt(t.tips))}${r("Refunds", "−" + fmt(t.refunds))}
    ${r("Total collected", fmt(t.total_collected), true)}<hr>
    ${r("Checks", String(t.orders))}${r("Average check", fmt(t.avg_check))}${r("Guests", String(t.guests))}
    ${r("Voided checks", String(d.voided_checks))}${r("Open checks", `${d.open_checks}${d.open_checks ? " · " + fmt(d.open_value) : ""}`)}<hr>
    <div class="b">PAYMENTS</div>${d.payments.map((m) => r(`${METHOD_LABEL[m.method] ?? m.method} (${m.count})`, fmt(m.net))).join("") || "<div>None</div>"}<hr>
    <div class="b">CHANNELS</div>${d.channels.map((c) => r(`${CHANNEL_LABEL[c.channel] ?? c.channel} (${c.orders})`, fmt(c.net_sales))).join("") || "<div>None</div>"}<hr>
    <div class="b">EXCEPTIONS</div>${Object.entries(ACTION_LABEL).map(([k, l]) => r(l, `${d.exceptions[k]?.count ?? 0}${d.exceptions[k]?.amount ? " · " + fmt(d.exceptions[k].amount) : ""}`)).join("")}
    ${d.drawers.length ? `<hr><div class="b">CASH DRAWERS</div>${d.drawers.map((x) => `${r(`${timeOf(x.opened_at)} – ${x.closed_at ? timeOf(x.closed_at) : "open"}`, "")}${r("  Expected", fmt(x.expected_cash))}${x.counted_cash != null ? r("  Counted", fmt(x.counted_cash)) + r("  Over / short", fmt(x.difference ?? 0), true) : ""}`).join("")}` : ""}
    <hr><div class="c">${esc(timeOf(d.first_order_at))} – ${esc(timeOf(d.last_order_at))}</div>`;
  printHtml(body, `End of day ${d.date}`);
}
