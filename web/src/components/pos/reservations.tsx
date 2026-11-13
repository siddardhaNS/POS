"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, MessageCircle, Phone, Plus, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, run, useNow, usePoll, usePos } from "./shared";

/* ---------- Types (mirror api/app/routers/reservations.py) ---------- */

interface Res {
  id: string; kind: "booking" | "waitlist"; name: string; phone: string; email: string; party_size: number; at: string; duration_min: number;
  ends_at: string; table_id: string | null; table: string; section: string; notes: string; source: string; status: string;
  quoted_min: number | null; notified_at: string | null; seated_at: string | null; order_id: string | null; created_by: string;
}
interface Day {
  date: string; timezone: string; bookings: Res[]; waitlist: Res[];
  summary: { bookings: number; covers: number; seated: number; no_shows: number; waiting: number };
  tables: { id: string; name: string; seats: number; section: string }[];
}
interface Fit { id: string; name: string; seats: number; section: string; free: boolean; reason: string | null; booked_by: string | null }

const STATUS: Record<string, { label: string; tone: string }> = {
  booked: { label: "Booked", tone: "bg-muted text-foreground" },
  confirmed: { label: "Confirmed", tone: "bg-sky/15 text-sky" },
  seated: { label: "Seated", tone: "bg-leaf/15 text-[oklch(0.45_0.12_150)]" },
  completed: { label: "Done", tone: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground line-through" },
  no_show: { label: "No-show", tone: "bg-destructive/10 text-destructive" },
  waiting: { label: "Waiting", tone: "bg-saffron/20 text-saffron-deep" },
  notified: { label: "Notified", tone: "bg-sky/15 text-sky" },
  left: { label: "Left", tone: "bg-muted text-muted-foreground" },
};

const digits = (p: string) => p.replace(/[^0-9]/g, "");
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function todayIn(tz?: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function ReservationsScreen() {
  const { s } = usePos();
  const tz = s.tenant?.timezone;
  const [day, setDay] = useState(todayIn(tz));
  const { data, reload } = usePoll<Day>(`/reservations?date=${day}`, 30_000, ["reservations", "floor"]);
  const now = useNow(30_000);
  const [form, setForm] = useState<{ kind: "booking" | "waitlist"; edit?: Res } | null>(null);
  const [seating, setSeating] = useState<Res | null>(null);
  const [showDone, setShowDone] = useState(false);

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz || undefined });
  const isToday = day === todayIn(tz);

  async function setStatus(r: Res, status: string, ok?: string) {
    if (await run(api(`/reservations/${r.id}`, { method: "PATCH", body: { status } }), ok)) reload();
  }
  function notify(r: Res) {
    const msg = `Hi ${r.name}, your table at ${s.tenant?.name} is ready. Please come to the host stand.`;
    if (r.phone) window.open(`https://wa.me/${digits(r.phone)}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
    else navigator.clipboard?.writeText(msg);
    setStatus(r, "notified", r.phone ? `Message opened for ${r.name}` : "No phone number: message copied");
  }

  const bookings = (data?.bookings ?? []).filter((b) => showDone || !["completed", "cancelled", "no_show", "seated"].includes(b.status));
  const waiting = (data?.waitlist ?? []).filter((w) => ["waiting", "notified"].includes(w.status));

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-xl bg-card p-1 ring-1 ring-border">
          <button onClick={() => setDay(addDays(day, -1))} className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label="Previous day"><ChevronLeft className="size-4" /></button>
          <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-8 w-36 border-0 bg-transparent" />
          <button onClick={() => setDay(addDays(day, 1))} className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label="Next day"><ChevronRight className="size-4" /></button>
        </div>
        {!isToday && <button onClick={() => setDay(todayIn(tz))} className="text-sm font-medium hover:underline">Today</button>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => setForm({ kind: "waitlist" })} className="flex h-10 items-center gap-1.5 rounded-xl bg-card px-4 text-sm font-semibold ring-1 ring-border"><Clock className="size-4" />Add to waitlist</button>
          <button onClick={() => setForm({ kind: "booking" })} className="flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background"><Plus className="size-4" />New booking</button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Bookings" value={String(data.summary.bookings)} sub={`${data.summary.covers} guests`} />
          <Tile label="Seated" value={String(data.summary.seated)} />
          <Tile label="Waitlist" value={String(data.summary.waiting)} sub={waiting.length ? `Longest ${Math.max(...waiting.map((w) => Math.round((now - new Date(w.at).getTime()) / 60000)))} min` : "Nobody waiting"} />
          <Tile label="No-shows" value={String(data.summary.no_shows)} warn={data.summary.no_shows > 0} />
        </div>
      )}

      <div className="grid min-h-0 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div className="font-semibold">Bookings</div>
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="size-4 accent-foreground" />Show seated and closed</label>
          </div>
          {!data ? <Empty>Loading…</Empty> : !bookings.length ? <Empty>No bookings {isToday ? "today" : "this day"}{showDone ? "" : " still to come"}.</Empty> : (
            <div className="divide-y divide-border">
              {bookings.map((b) => {
                const late = ["booked", "confirmed"].includes(b.status) && isToday && now - new Date(b.at).getTime() > 15 * 60000;
                return (
                  <div key={b.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3", late && "bg-destructive/[0.04]")}>
                    <div className="w-16 font-mono text-sm font-semibold tabular">{time(b.at)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => setForm({ kind: "booking", edit: b })} className="font-medium hover:underline">{b.name}</button>
                        <span className="flex items-center gap-1 text-sm text-muted-foreground"><Users className="size-3.5" />{b.party_size}</span>
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", STATUS[b.status]?.tone)}>{STATUS[b.status]?.label ?? b.status}</span>
                        {late && <span className="text-xs font-semibold text-destructive">{Math.round((now - new Date(b.at).getTime()) / 60000)} min late</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[b.table ? `Table ${b.table.replace(/^T/, "")}` : "No table yet", b.phone, b.notes].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {["booked", "confirmed"].includes(b.status) && (
                      <div className="flex flex-wrap gap-1.5">
                        {b.status === "booked" && <Small onClick={() => setStatus(b, "confirmed", `${b.name} confirmed`)}>Confirm</Small>}
                        {can(s.user, "order") && isToday && <Small primary onClick={() => setSeating(b)}>Seat</Small>}
                        {b.phone && <a href={`tel:${b.phone.replace(/\s/g, "")}`} className="grid size-8 place-items-center rounded-lg bg-muted" title="Call"><Phone className="size-3.5" /></a>}
                        <Small onClick={() => setStatus(b, "no_show", `${b.name} marked as a no-show`)}>No-show</Small>
                        <Small onClick={() => confirm(`Cancel ${b.name}'s booking?`) && setStatus(b, "cancelled", "Booking cancelled")}>Cancel</Small>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3 font-semibold">Waitlist</div>
          {!data ? <Empty>Loading…</Empty> : !waiting.length ? <Empty>Nobody is waiting. Add walk-ins when the floor is full.</Empty> : (
            <div className="divide-y divide-border">
              {waiting.map((w, i) => {
                const waited = Math.round((now - new Date(w.at).getTime()) / 60000);
                const over = w.quoted_min != null && waited > w.quoted_min;
                return (
                  <div key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="grid size-7 place-items-center rounded-full bg-muted font-mono text-xs font-semibold">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{w.name}</span>
                        <span className="flex items-center gap-1 text-sm text-muted-foreground"><Users className="size-3.5" />{w.party_size}</span>
                        <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", STATUS[w.status]?.tone)}>{STATUS[w.status]?.label}</span>
                      </div>
                      <div className={cn("text-xs", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
                        Waiting {waited} min{w.quoted_min != null ? ` · quoted ${w.quoted_min}` : ""}{w.phone ? ` · ${w.phone}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Small onClick={() => notify(w)} title="Send a 'your table is ready' message"><MessageCircle className="size-3.5" />Notify</Small>
                      {can(s.user, "order") && <Small primary onClick={() => setSeating(w)}>Seat</Small>}
                      <Small onClick={() => setStatus(w, "left", `${w.name} removed from the waitlist`)}>Left</Small>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {form && <ResForm kind={form.kind} edit={form.edit} day={day} tz={tz} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {seating && <SeatDialog r={seating} onClose={() => setSeating(null)} onSeated={() => { setSeating(null); reload(); }} />}
    </div>
  );
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

function Small({ children, primary, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <button type="button" {...p} className={cn("flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold", primary ? "bg-foreground text-background" : "bg-muted")}>{children}</button>;
}

/** "YYYY-MM-DDTHH:MM" in the restaurant's time zone for a datetime-local input. */
function localInput(iso: string, tz?: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function ResForm({ kind, edit, day, tz, onClose, onSaved }: { kind: "booking" | "waitlist"; edit?: Res; day: string; tz?: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: edit?.name ?? "", phone: edit?.phone ?? "", party_size: String(edit?.party_size ?? 2),
    at: edit ? localInput(edit.at, tz) : `${day}T19:00`, duration_min: String(edit?.duration_min ?? ""), table_id: edit?.table_id ?? "",
    notes: edit?.notes ?? "", source: edit?.source ?? "phone", quoted_min: "",
  });
  const [fits, setFits] = useState<Fit[] | null>(null);
  const [quote, setQuote] = useState<{ minutes: number | null; basis: string; ahead: number } | null>(null);
  const party = Math.max(1, Number(f.party_size) || 1);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    let live = true;
    if (kind === "booking") {
      api<{ tables: Fit[] }>(`/reservations/availability?at=${encodeURIComponent(f.at)}&party=${party}${f.duration_min ? `&duration=${f.duration_min}` : ""}${edit ? `&skip=${edit.id}` : ""}`)
        .then((r) => live && setFits(r.tables)).catch(() => {});
    } else {
      api<{ minutes: number | null; basis: string; ahead: number }>(`/reservations/quote?party=${party}`).then((r) => live && setQuote(r)).catch(() => {});
    }
    return () => { live = false; };
  }, [kind, f.at, f.duration_min, party, edit]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { name: f.name, phone: f.phone, party_size: party, notes: f.notes };
    if (kind === "booking") {
      Object.assign(body, { at: f.at, ...(f.duration_min ? { duration_min: Number(f.duration_min) } : {}) });
      if (edit) Object.assign(body, f.table_id ? { table_id: f.table_id } : { clear_table: true });
      else Object.assign(body, { kind, source: f.source, table_id: f.table_id || null });
    } else {
      Object.assign(body, { kind, quoted_min: f.quoted_min !== "" ? Number(f.quoted_min) : quote?.minutes ?? null });
    }
    const r = await run(edit ? api(`/reservations/${edit.id}`, { method: "PATCH", body }) : api("/reservations", { body }),
      edit ? "Booking updated" : kind === "booking" ? `Booked ${f.name}, party of ${party}` : `${f.name} added to the waitlist`);
    if (r) onSaved();
  }

  const sel = "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? `Edit ${edit.name}'s booking` : kind === "booking" ? "New booking" : "Add to the waitlist"}</DialogTitle>
          <DialogDescription>{kind === "booking" ? "Times are in the restaurant's time zone." : "Quote a wait, then notify them when a table is ready."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-2"><Label htmlFor="rs-name">Name</Label><Input id="rs-name" autoFocus required maxLength={120} value={f.name} onChange={(e) => set({ name: e.target.value })} className="h-11" /></div>
            <div className="space-y-2"><Label>Guests</Label><Input type="number" min={1} max={60} required value={f.party_size} onChange={(e) => set({ party_size: e.target.value })} className="h-11 font-mono" /></div>
          </div>
          <div className="space-y-2"><Label>Phone</Label><Input type="tel" maxLength={40} value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="For confirmations and 'table ready' messages" className="h-11" /></div>
          {kind === "booking" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div className="space-y-2"><Label>Date and time</Label><Input type="datetime-local" required value={f.at} onChange={(e) => set({ at: e.target.value })} className="h-11" /></div>
                <div className="space-y-2"><Label>Stay (min)</Label><Input type="number" min={15} max={480} step={15} value={f.duration_min} onChange={(e) => set({ duration_min: e.target.value })} placeholder={String(party <= 2 ? 75 : party <= 4 ? 90 : 120)} className="h-11 font-mono" /></div>
              </div>
              <div className="space-y-2"><Label>Table</Label>
                <select value={f.table_id} onChange={(e) => set({ table_id: e.target.value })} className={sel}>
                  <option value="">Decide when they arrive</option>
                  {fits?.map((t) => <option key={t.id} value={t.id} disabled={!t.free && t.id !== f.table_id}>{t.name} · {t.seats} seats · {t.section}{t.free ? "" : t.reason === "booked" ? ` (booked: ${t.booked_by})` : " (in use now)"}</option>)}
                </select>
                {fits && !fits.length && <p className="text-xs text-destructive">No table seats {party}. Push tables together and pick none for now.</p>}
              </div>
              {!edit && (
                <div className="space-y-2"><Label>How they booked</Label>
                  <select value={f.source} onChange={(e) => set({ source: e.target.value })} className={sel}>
                    <option value="phone">Phone</option><option value="walk_in">In person</option><option value="online">Online</option><option value="other">Other</option>
                  </select></div>
              )}
            </>
          ) : (
            <div className="rounded-xl bg-muted/60 p-3 text-sm">
              {quote ? (quote.minutes === null ? quote.basis : <>Quote about <b>{quote.minutes} min</b><span className="text-muted-foreground"> · {quote.basis}{quote.ahead ? ` · ${quote.ahead} ahead` : ""}</span></>) : "Working out the wait…"}
              <div className="mt-2 flex items-center gap-2"><span className="text-muted-foreground">Quote instead</span>
                <Input type="number" min={0} max={600} value={f.quoted_min} onChange={(e) => set({ quoted_min: e.target.value })} placeholder={quote?.minutes != null ? String(quote.minutes) : "min"} className="h-9 w-24 bg-card font-mono" /><span className="text-muted-foreground">min</span></div>
            </div>
          )}
          <div className="space-y-2"><Label>Notes</Label><Input maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. birthday, high chair, window seat" className="h-11" /></div>
          <button type="submit" className="h-11 rounded-xl bg-foreground font-semibold text-background">{edit ? "Save" : kind === "booking" ? "Book" : "Add to waitlist"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SeatDialog({ r, onClose, onSeated }: { r: Res; onClose: () => void; onSeated: () => void }) {
  const { go } = usePos();
  const { data } = usePoll<{ tables: Fit[] }>(`/reservations/availability?at=${encodeURIComponent(new Date().toISOString())}&party=${r.party_size}&skip=${r.id}`, 0);
  const [pick, setPick] = useState<string>(r.table_id ?? "");
  async function seat(open: boolean) {
    const res = await run(api<{ order_id: string }>(`/reservations/${r.id}/seat`, { body: { table_id: pick } }), `${r.name} seated`);
    if (!res) return;
    onSeated();
    if (open) go("order", { orderId: res.order_id });
  }
  const tables = data?.tables ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Seat {r.name} · {r.party_size}</DialogTitle><DialogDescription>Best fits first. Tables in use or booked soon are greyed out.</DialogDescription></DialogHeader>
        {!data ? <Empty>Finding tables…</Empty> : !tables.length ? <Empty>No table seats {r.party_size}.</Empty> : (
          <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {tables.map((t) => (
              <button key={t.id} disabled={!t.free && t.id !== r.table_id} onClick={() => setPick(t.id)}
                className={cn("rounded-xl p-3 text-left ring-1 disabled:opacity-40", pick === t.id ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs opacity-70">{t.seats} seats</div>
                {!t.free && <div className="text-[10px] opacity-70">{t.reason === "booked" ? `Booked: ${t.booked_by}` : "In use"}</div>}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button disabled={!pick} onClick={() => seat(false)} className="h-11 flex-1 rounded-xl bg-muted font-semibold disabled:opacity-40">Seat</button>
          <button disabled={!pick} onClick={() => seat(true)} className="h-11 flex-1 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">Seat & open check</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
