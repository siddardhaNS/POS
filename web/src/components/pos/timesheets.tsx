"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_URL, api, session } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, Seg, run, usePoll, usePos } from "./shared";

/* ---------- Types (mirror api/app/routers/timeclock.py) ---------- */

interface Brk { id: string; start: string; end: string | null; paid: boolean }
interface Entry {
  id: string; user_id: string; role: string; hourly_rate: number; note: string; clock_in: string; clock_out: string | null;
  open: boolean; missed_clock_out: boolean; hours: number; regular_hours: number; overtime_hours: number; break_hours: number;
  paid_break_hours: number; labour_cost: number; edited_by: string | null; edited_at: string | null; breaks: Brk[];
}
interface Row {
  user_id: string; name: string; role: string; hourly_rate: number; on_clock: boolean; hours: number; regular_hours: number;
  overtime_hours: number; break_hours: number; labour_cost: number; ot_premium: number; tips: number; sales: number;
  sales_per_hour: number; missed_clock_outs: number; entries: Entry[];
}
interface Settings { require_clock_in: boolean; ot_daily_hours: number; ot_weekly_hours: number; ot_multiplier: number }
interface Sheet {
  start: string; end: string; timezone: string; settings: Settings; net_sales: number; labour_pct: number | null;
  sales_per_labour_hour: number | null; missed_clock_outs: number;
  totals: { hours: number; regular_hours: number; overtime_hours: number; break_hours: number; labour_cost: number; ot_premium: number; tips: number };
  users: Row[];
}
interface Tips { total_tips: number; pool_hours: number; unassigned: number; rows: { user_id: string; name: string; role: string; hours: number; collected: number; share: number }[] }
interface StaffMember { id: string; name: string; role: string; is_active: boolean }

const ROLES = ["owner", "manager", "cashier", "captain", "chef"];
const h1 = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)} h`;

/** YYYY-MM-DD for a date in the restaurant's time zone. */
function ymd(d: Date, tz?: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** "YYYY-MM-DDTHH:MM" in the restaurant's time zone, for datetime-local inputs (the API reads naive times that way). */
function localInput(iso: string | null, tz?: string) {
  if (!iso) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function TimesheetsScreen() {
  const { s, fmt } = usePos();
  const tz = s.tenant?.timezone;
  const today = ymd(new Date(), tz);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = addDays(today, -dow);
  const [range, setRange] = useState<"week" | "last" | "custom">("week");
  const [custom, setCustom] = useState<[string, string]>([addDays(thisMonday, -14), today]);
  const [tab, setTab] = useState<"hours" | "tips" | "settings">("hours");
  const [start, end] = range === "week" ? [thisMonday, today] : range === "last" ? [addDays(thisMonday, -7), addDays(thisMonday, -1)] : custom;
  const { data, reload } = usePoll<Sheet>(`/timesheets?start=${start}&end=${end}`, 60_000, "timeclock");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Entry | "new" | null>(null);

  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }) : "—");
  const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", timeZone: tz || undefined });

  async function exportCsv() {
    try {
      const res = await fetch(`${API_URL}/timesheets/export.csv?start=${start}&end=${end}`, { headers: { authorization: `Bearer ${session.get()?.token}` } });
      if (!res.ok) throw new Error("Couldn't export");
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `timesheets-${start}-to-${end}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error((e as Error).message); }
  }

  const t = data?.totals;
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <Seg value={range} onChange={setRange} options={[["week", "This week"], ["last", "Last week"], ["custom", "Custom"]]} />
        {range === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" value={custom[0]} max={custom[1]} onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])} className="h-9 w-40" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={custom[1]} min={custom[0]} onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])} className="h-9 w-40" />
          </div>
        )}
        <div className="shrink-0"><Seg value={tab} onChange={setTab} options={[["hours", "Hours & pay"], ["tips", "Tips"], ["settings", "Settings"]]} /></div>
        <div className="ml-auto flex gap-2">
          <button onClick={exportCsv} className="flex h-9 items-center gap-1.5 rounded-lg bg-card px-3 text-sm font-medium ring-1 ring-border"><Download className="size-4" />Payroll CSV</button>
          <button onClick={() => setEdit("new")} className="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-semibold text-background"><Plus className="size-4" />Add shift</button>
        </div>
      </div>

      {tab === "hours" && (!data ? <Empty>Loading timesheets…</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label="Hours worked" value={h1(t!.hours)} sub={t!.overtime_hours ? `${h1(t!.overtime_hours)} overtime` : "No overtime"} />
            <Tile label="Labour cost" value={fmt(t!.labour_cost)} sub={t!.ot_premium ? `incl. ${fmt(t!.ot_premium)} overtime premium` : undefined} />
            <Tile label="Labour % of sales" value={data.labour_pct != null ? `${data.labour_pct.toFixed(1)}%` : "—"} sub={`Net sales ${fmt(data.net_sales)}`} warn={(data.labour_pct ?? 0) > 35} />
            <Tile label="Sales per labour hour" value={data.sales_per_labour_hour != null ? fmt(data.sales_per_labour_hour) : "—"} />
            <Tile label="Missed clock-outs" value={String(data.missed_clock_outs)} sub={data.missed_clock_outs ? "Fix the times below" : "All shifts closed"} warn={data.missed_clock_outs > 0} />
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                {["Staff", "Rate", "Regular", "Overtime", "Breaks", "Labour cost", "Tips", "Sales / hour"].map((x, i) => (
                  <th key={x} className={cn("px-4 py-3 font-medium", i === 0 ? "text-left" : "text-right")}>{x}</th>
                ))}
              </tr></thead>
              <tbody>
                {!data.users.length && <tr><td colSpan={8}><Empty>No shifts in this period. Staff clock in from the lock screen, or add a shift.</Empty></td></tr>}
                {data.users.map((u) => {
                  const isOpen = open.has(u.user_id);
                  return (
                    <FragmentRows key={u.user_id}>
                      <tr onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(u.user_id)) n.delete(u.user_id); else n.add(u.user_id); return n; })}
                        className="cursor-pointer border-b border-border/60 hover:bg-muted/40">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 font-medium">
                            {isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                            {u.name}
                            {u.on_clock && <span className="rounded-full bg-leaf/15 px-2 py-0.5 text-[11px] font-semibold text-[oklch(0.45_0.12_150)]">On the clock</span>}
                            {u.missed_clock_outs > 0 && <AlertTriangle className="size-4 text-destructive" />}
                          </div>
                          <div className="pl-6 text-xs text-muted-foreground"><span className="capitalize">{u.role}</span> · {u.entries.length} shift{u.entries.length === 1 ? "" : "s"}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular">{u.hourly_rate ? `${fmt(u.hourly_rate)}/h` : <span className="text-muted-foreground">not set</span>}</td>
                        <td className="px-4 py-3 text-right font-mono tabular">{h1(u.regular_hours)}</td>
                        <td className={cn("px-4 py-3 text-right font-mono tabular", u.overtime_hours > 0 && "text-saffron-deep")}>{u.overtime_hours ? h1(u.overtime_hours) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono tabular text-muted-foreground">{u.break_hours ? h1(u.break_hours) : "—"}</td>
                        <td className="px-4 py-3 text-right font-mono tabular">{fmt(u.labour_cost)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular">{fmt(u.tips)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular">{u.sales_per_hour ? fmt(u.sales_per_hour) : "—"}</td>
                      </tr>
                      {isOpen && u.entries.map((e) => (
                        <tr key={e.id} className="border-b border-border/40 bg-muted/30 text-[13px]">
                          <td className="py-2.5 pl-10 pr-4">
                            <div>{day(e.clock_in)} · {time(e.clock_in)} – {e.open ? <span className="font-medium text-[oklch(0.45_0.12_150)]">now</span> : time(e.clock_out)}</div>
                            <div className="text-xs text-muted-foreground">
                              {e.breaks.length ? `${e.breaks.length} break${e.breaks.length === 1 ? "" : "s"}` : "No breaks"}
                              {e.note && ` · ${e.note}`}{e.edited_by && ` · edited by ${e.edited_by}`}
                              {e.missed_clock_out && <span className="font-medium text-destructive"> · missed clock-out</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular text-muted-foreground">{fmt(e.hourly_rate)}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular">{h1(e.regular_hours)}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular">{e.overtime_hours ? h1(e.overtime_hours) : "—"}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular text-muted-foreground">{e.break_hours ? h1(e.break_hours) : "—"}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular">{fmt(e.labour_cost)}</td>
                          <td colSpan={2} className="px-4 py-2.5 text-right">
                            <button onClick={() => setEdit(e)} className="rounded-lg bg-card px-3 py-1.5 text-xs font-semibold ring-1 ring-border">Edit</button>
                          </td>
                        </tr>
                      ))}
                    </FragmentRows>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Overtime is paid at {data.settings.ot_multiplier}× {data.settings.ot_daily_hours ? `after ${data.settings.ot_daily_hours} h a day` : ""}
            {data.settings.ot_daily_hours && data.settings.ot_weekly_hours ? " or " : ""}{data.settings.ot_weekly_hours ? `after ${data.settings.ot_weekly_hours} h a week` : ""}.
            Unpaid breaks are taken off the hours. Rates are the ones in place when each shift started; set them in Staff &amp; roles.
          </p>
        </>
      ))}

      {tab === "tips" && <TipsPanel start={start} end={end} />}
      {tab === "settings" && data && <SettingsPanel settings={data.settings} onSaved={reload} />}

      {edit && <EntryDialog entry={edit === "new" ? null : edit} tz={tz} defaultDay={today} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-xl font-semibold tabular", warn && "text-destructive")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ---------- Tips ---------- */

function TipsPanel({ start, end }: { start: string; end: string }) {
  const { fmt } = usePos();
  const [mode, setMode] = useState<"individual" | "pooled">("individual");
  const [roles, setRoles] = useState<string[]>(["cashier", "captain"]);
  const { data } = usePoll<Tips>(`/timesheets/tips?start=${start}&end=${end}&mode=${mode}&roles=${roles.join(",")}`, 0, ["timeclock", "orders"]);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Seg value={mode} onChange={setMode} options={[["individual", "Who collected them"], ["pooled", "Pool by hours"]]} />
        {mode === "pooled" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Shared among</span>
            {ROLES.map((r) => (
              <button key={r} onClick={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])}
                className={cn("h-8 rounded-lg px-3 capitalize ring-1", roles.includes(r) ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>{r}</button>
            ))}
          </div>
        )}
      </div>
      {!data ? <Empty>Loading…</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap gap-x-8 gap-y-1 border-b border-border px-4 py-3 text-sm">
            <span>Tips in this period <b className="font-mono">{fmt(data.total_tips)}</b></span>
            {mode === "pooled" && <span className="text-muted-foreground">{data.pool_hours.toFixed(2)} pooled hours</span>}
            {data.unassigned > 0 && <span className="text-muted-foreground">{fmt(data.unassigned)} not assigned to anyone</span>}
          </div>
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground">
              {["Staff", "Hours", "Collected", mode === "pooled" ? "Share of pool" : "Their tips"].map((x, i) => <th key={x} className={cn("px-4 py-3 font-medium", i ? "text-right" : "text-left")}>{x}</th>)}
            </tr></thead>
            <tbody>
              {!data.rows.length && <tr><td colSpan={4}><Empty>No tips or shifts in this period.</Empty></td></tr>}
              {data.rows.map((r) => (
                <tr key={r.user_id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3"><div className="font-medium">{r.name}</div><div className="text-xs capitalize text-muted-foreground">{r.role}</div></td>
                  <td className="px-4 py-3 text-right font-mono tabular">{r.hours.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular">{fmt(r.collected)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular">{fmt(r.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- Settings ---------- */

function SettingsPanel({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [f, setF] = useState({ require_clock_in: settings.require_clock_in, ot_daily_hours: String(settings.ot_daily_hours), ot_weekly_hours: String(settings.ot_weekly_hours) });
  async function save() {
    const r = await run(api("/timesheets/settings", { method: "PATCH", body: {
      require_clock_in: f.require_clock_in, ot_daily_hours: Number(f.ot_daily_hours) || 0, ot_weekly_hours: Number(f.ot_weekly_hours) || 0,
    } }), "Time clock settings saved");
    if (r) onSaved();
  }
  return (
    <div className="grid max-w-xl gap-4">
      <button type="button" onClick={() => setF({ ...f, require_clock_in: !f.require_clock_in })} className="flex w-full items-center justify-between gap-6 rounded-2xl bg-card p-4 text-left ring-1 ring-border">
        <span><span className="block font-medium">Staff must clock in to use the POS</span><span className="text-sm text-muted-foreground">Cashiers, captains and chefs who aren&apos;t on the clock can&apos;t unlock the POS (owners and managers always can).</span></span>
        <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition", f.require_clock_in ? "bg-leaf" : "bg-[#d6d2ca]")}><span className={cn("absolute top-1 size-5 rounded-full bg-white shadow transition-all", f.require_clock_in ? "left-6" : "left-1")} /></span>
      </button>
      <div className="grid gap-4 rounded-2xl bg-card p-4 ring-1 ring-border sm:grid-cols-2">
        <div className="space-y-2"><Label>Overtime after (hours a day)</Label><Input type="number" min={0} max={24} step="0.5" value={f.ot_daily_hours} onChange={(e) => setF({ ...f, ot_daily_hours: e.target.value })} className="h-11 font-mono" /><p className="text-xs text-muted-foreground">0 = no daily overtime</p></div>
        <div className="space-y-2"><Label>Overtime after (hours a week)</Label><Input type="number" min={0} max={168} step="0.5" value={f.ot_weekly_hours} onChange={(e) => setF({ ...f, ot_weekly_hours: e.target.value })} className="h-11 font-mono" /><p className="text-xs text-muted-foreground">0 = no weekly overtime</p></div>
      </div>
      <button onClick={save} className="h-11 w-fit rounded-xl bg-foreground px-6 font-semibold text-background">Save settings</button>
    </div>
  );
}

/* ---------- Add / edit a shift ---------- */

function EntryDialog({ entry, tz, defaultDay, onClose, onSaved }: { entry: Entry | null; tz?: string; defaultDay: string; onClose: () => void; onSaved: () => void }) {
  const { data: staff } = usePoll<StaffMember[]>(entry ? null : "/staff", 0);
  const [userId, setUserId] = useState("");
  const [cin, setCin] = useState(localInput(entry?.clock_in ?? null, tz) || `${defaultDay}T09:00`);
  const [cout, setCout] = useState(localInput(entry?.clock_out ?? null, tz) || (entry ? "" : `${defaultDay}T17:00`));
  const [note, setNote] = useState(entry?.note ?? "");
  const [breaks, setBreaks] = useState<Brk[]>(entry?.breaks ?? []);
  const [nb, setNb] = useState({ start: "", end: "", paid: false });
  const [sure, setSure] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!entry) {
      if (!userId) return toast.error("Pick who worked the shift");
      const r = await run(api("/timesheets/entries", { body: { user_id: userId, clock_in: cin, clock_out: cout || null, note,
        breaks: nb.start ? [{ start: nb.start, end: nb.end || null, paid: nb.paid }] : [] } }), "Shift added");
      if (r) onSaved();
      return;
    }
    const body: Record<string, unknown> = { clock_in: cin, note };
    if (cout) body.clock_out = cout; else if (!entry.open) body.reopen = true;
    if (await run(api(`/timesheets/entries/${entry.id}`, { method: "PATCH", body }), "Shift updated")) onSaved();
  }
  async function addBreak() {
    if (!entry || !nb.start) return;
    const r = await run(api<Entry>(`/timesheets/entries/${entry.id}/breaks`, { body: { start: nb.start, end: nb.end || null, paid: nb.paid } }), "Break added");
    if (r) { setBreaks(r.breaks); setNb({ start: "", end: "", paid: false }); }
  }
  async function removeBreak(b: Brk) {
    if (await run(api(`/timesheets/breaks/${b.id}`, { method: "DELETE" }), "Break removed")) setBreaks((x) => x.filter((y) => y.id !== b.id));
  }
  async function remove() {
    if (!entry) return;
    if (!sure) return setSure(true);
    if (await run(api(`/timesheets/entries/${entry.id}`, { method: "DELETE" }), "Shift deleted")) onSaved();
  }
  const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }) : "now");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit shift" : "Add a shift"}</DialogTitle>
          <DialogDescription>Times are in the restaurant&apos;s time zone. Every change is saved to the activity log.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          {!entry && (
            <div className="space-y-2"><Label>Staff member</Label>
              <select required value={userId} onChange={(e) => setUserId(e.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm">
                <option value="">Pick someone</option>
                {staff?.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
              </select></div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label>Clocked in</Label><Input type="datetime-local" required value={cin} onChange={(e) => setCin(e.target.value)} className="h-11" /></div>
            <div className="space-y-2"><Label>Clocked out</Label><Input type="datetime-local" value={cout} onChange={(e) => setCout(e.target.value)} className="h-11" />
              <p className="text-xs text-muted-foreground">Leave empty if still on shift</p></div>
          </div>
          <div className="space-y-2"><Label>Note</Label><Input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. forgot to clock out, left at 11" className="h-11" /></div>
          <div className="space-y-2 rounded-xl bg-muted/50 p-3">
            <div className="text-sm font-medium">Breaks</div>
            {breaks.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span>{hm(b.start)} – {hm(b.end)} · {b.paid ? "paid" : "unpaid"}</span>
                <button type="button" onClick={() => removeBreak(b)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-card"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input type="datetime-local" value={nb.start} onChange={(e) => setNb({ ...nb, start: e.target.value })} className="h-10 bg-card" aria-label="Break start" />
              <Input type="datetime-local" value={nb.end} onChange={(e) => setNb({ ...nb, end: e.target.value })} className="h-10 bg-card" aria-label="Break end" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={nb.paid} onChange={(e) => setNb({ ...nb, paid: e.target.checked })} className="size-4 accent-foreground" />Paid</label>
            </div>
            {entry && <button type="button" disabled={!nb.start} onClick={addBreak} className="h-9 rounded-lg bg-card px-3 text-sm font-medium ring-1 ring-border disabled:opacity-40">Add break</button>}
            {!entry && <p className="text-xs text-muted-foreground">Optional: one break is saved with the shift; add more after.</p>}
          </div>
          <div className="flex gap-2">
            {entry && <button type="button" onClick={remove} onBlur={() => setSure(false)} className={cn("h-11 rounded-xl px-4 text-sm font-semibold", sure ? "bg-destructive text-white" : "text-destructive")}>{sure ? "Click again to delete" : "Delete shift"}</button>}
            <button type="submit" className="ml-auto h-11 rounded-xl bg-foreground px-6 font-semibold text-background">{entry ? "Save" : "Add shift"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
