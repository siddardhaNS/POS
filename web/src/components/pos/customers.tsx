"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cake, Download, Plus, Search, Star, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { API_URL, api, can, session } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, STATUS_TONE, Seg, run, usePoll, usePos } from "./shared";

export interface Customer {
  id: string; name: string; phone: string; email: string; gstin: string; address: string;
  birthday: string | null; anniversary: string | null; tags: string[]; notes: string; points: number; marketing_ok: boolean;
  created_at: string; visits: number; spend: number; avg_spend: number; first_visit: string | null; last_visit: string | null;
}
interface Detail extends Customer {
  favourites: { name: string; qty: number }[];
  orders: { id: string; number: number; status: string; channel: string; total: number; refunded: number; invoice_no: string; at: string }[];
}

const SEGMENTS: [string, string][] = [["", "All"], ["regular", "Regulars"], ["new", "New"], ["lapsed", "Lapsed"], ["birthday", "Birthdays soon"]];
const TAGS = ["Regular", "VIP", "Corporate", "Family", "Staff"];
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

/** Pretty phone: +91 98765 43210 style for the common lengths, digits otherwise. */
export function showPhone(p: string) {
  if (p.length === 12 && p.startsWith("91")) return `+91 ${p.slice(2, 7)} ${p.slice(7)}`;
  if (p.length === 11 && p.startsWith("1")) return `+1 ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7)}`;
  return p ? `+${p}` : "";
}

export function CustomersScreen() {
  const { fmt, go } = usePos();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("");
  const [sort, setSort] = useState("recent");
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQuery(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, reload } = usePoll<{ customers: Customer[]; total: number }>(
    `/customers?q=${encodeURIComponent(query)}&segment=${segment}&sort=${sort}`, 0, "customers");

  async function exportCsv() {
    try {
      const res = await fetch(`${API_URL}/customers-export.csv`, { headers: { authorization: `Bearer ${session.get()?.token ?? ""}` } });
      if (!res.ok) throw new Error("Couldn't export");
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: "customers.csv" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_420px]">
      <div className="flex min-h-0 flex-col gap-4 overflow-hidden p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or email" className="h-10 rounded-xl bg-card pl-9" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-10 rounded-xl border border-input bg-card px-3 text-sm" aria-label="Sort">
            <option value="recent">Last visit</option><option value="spend">Top spend</option><option value="visits">Most visits</option><option value="name">Name</option>
          </select>
          <button onClick={exportCsv} className="flex h-10 items-center gap-1.5 rounded-xl bg-card px-3 text-sm font-medium ring-1 ring-border"><Download className="size-4" />CSV</button>
          <button onClick={() => { setAdding(true); setSel(null); }} className="flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-3.5 text-sm font-medium text-background"><Plus className="size-4" />Add</button>
        </div>
        <div className="overflow-x-auto"><Seg value={segment} onChange={setSegment} options={SEGMENTS} /></div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-card">
          {!data ? <Empty>Loading…</Empty> : data.customers.length === 0 ? (
            <Empty>{query || segment ? "No one matches." : "Customers appear here once a phone number is added to a check (Guests & customer), or add them yourself."}</Empty>
          ) : data.customers.map((c) => (
            <button key={c.id} onClick={() => { setSel(c.id); setAdding(false); }}
              className={cn("grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-border/60 px-5 py-3 text-left last:border-0 hover:bg-muted/40", sel === c.id && "bg-accent/60")}>
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium">{c.name || "Unnamed guest"}
                  {c.tags.slice(0, 2).map((t) => <span key={t} className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">{t}</span>)}
                  {c.points > 0 && <span className="rounded bg-saffron/20 px-1.5 text-[11px] font-semibold text-saffron-deep">{c.points} pts</span>}</span>
                <span className="block text-xs text-muted-foreground">{showPhone(c.phone)} · {c.visits} visit{c.visits === 1 ? "" : "s"} · last {day(c.last_visit)}</span>
              </span>
              <span className="text-right font-mono text-sm">{fmt(c.spend)}<span className="block text-[11px] text-muted-foreground">avg {fmt(c.avg_spend)}</span></span>
            </button>
          ))}
        </div>
        {data && data.total > data.customers.length && <p className="text-xs text-muted-foreground">Showing {data.customers.length} of {data.total}. Search to narrow down.</p>}
      </div>
      <aside className={cn("min-h-0 overflow-y-auto border-t border-border bg-card p-6 lg:border-l lg:border-t-0", !sel && !adding && "hidden lg:block")}>
        {adding ? <CustomerForm onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); setSel(c.id); reload(); }} />
          : sel ? <CustomerDetail key={sel} id={sel} onClose={() => setSel(null)} onChanged={reload} openOrder={(id) => go("order", { orderId: id })} />
            : <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">Pick a customer to see their visits, favourites and notes.</div>}
      </aside>
    </div>
  );
}

function CustomerDetail({ id, onClose, onChanged, openOrder }: { id: string; onClose: () => void; onChanged: () => void; openOrder: (id: string) => void }) {
  const { fmt } = usePos();
  const { data, reload } = usePoll<Detail>(`/customers/${id}`, 0, "customers");
  const [editing, setEditing] = useState(false);
  if (!data) return <Empty>Loading…</Empty>;
  if (editing) return <CustomerForm initial={data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); onChanged(); }} />;
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">{data.name || "Unnamed guest"}</div>
          <div className="text-sm text-muted-foreground">{showPhone(data.phone)}{data.email ? ` · ${data.email}` : ""}</div>
          {data.gstin && <div className="font-mono text-xs text-muted-foreground">GSTIN {data.gstin}</div>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="rounded-lg bg-muted px-3 py-1.5 text-sm font-medium">Edit</button>
          <button onClick={onClose} aria-label="Close"><X className="size-5 text-muted-foreground" /></button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Visits", String(data.visits)], ["Spent", fmt(data.spend)], ["Average", fmt(data.avg_spend)]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-muted/60 p-3"><div className="font-mono text-lg font-semibold">{v}</div><div className="text-xs text-muted-foreground">{l}</div></div>
        ))}
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">First visit</span><span>{day(data.first_visit)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Last visit</span><span>{day(data.last_visit)}</span></div>
        {data.birthday && <div className="flex justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><Cake className="size-3.5" />Birthday</span><span>{day(data.birthday)}</span></div>}
        {data.anniversary && <div className="flex justify-between"><span className="text-muted-foreground">Anniversary</span><span>{day(data.anniversary)}</span></div>}
        <div className="flex justify-between"><span className="flex items-center gap-1.5 text-muted-foreground"><Star className="size-3.5" />Loyalty points</span><span className="font-mono">{data.points}</span></div>
        {!data.marketing_ok && <div className="text-xs text-saffron-deep">Doesn&apos;t want offers or messages</div>}
      </div>
      {!!data.tags.length && <div className="flex flex-wrap gap-1.5">{data.tags.map((t) => <span key={t} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{t}</span>)}</div>}
      {data.notes && <p className="whitespace-pre-wrap rounded-xl bg-saffron/10 p-3 text-sm">{data.notes}</p>}
      {!!data.favourites.length && (
        <div className="space-y-1.5">
          <div className="font-medium">Usually orders</div>
          {data.favourites.map((f) => <div key={f.name} className="flex justify-between text-sm"><span>{f.name}</span><span className="font-mono text-muted-foreground">{f.qty}×</span></div>)}
        </div>
      )}
      <PointsPanel id={data.id} name={data.name} />
      <div className="space-y-1.5">
        <div className="font-medium">Checks</div>
        {data.orders.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : data.orders.map((o) => (
          <button key={o.id} onClick={() => openOrder(o.id)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
            <span>#{o.number} · {day(o.at)}{o.invoice_no ? <span className="text-xs text-muted-foreground"> · {o.invoice_no}</span> : null}</span>
            <span className="flex items-center gap-2"><span className={cn("rounded px-1.5 text-[11px] capitalize", STATUS_TONE[o.status] ?? "bg-muted")}>{o.status}</span><span className="font-mono">{fmt(o.total)}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CustomerForm({ initial, onClose, onSaved }: { initial?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const { s } = usePos();
  const [f, setF] = useState({
    name: initial?.name ?? "", phone: initial?.phone ?? "", email: initial?.email ?? "", birthday: initial?.birthday ?? "",
    anniversary: initial?.anniversary ?? "", gstin: initial?.gstin ?? "", address: initial?.address ?? "", notes: initial?.notes ?? "",
    tags: initial?.tags ?? [], marketing_ok: initial?.marketing_ok ?? true,
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, email: f.email || null, birthday: f.birthday || null, anniversary: f.anniversary || null };
    const r = initial ? await run(api<Customer>(`/customers/${initial.id}`, { method: "PUT", body }), "Customer saved")
      : await run(api<Customer>("/customers", { body }), "Customer added");
    if (r) onSaved(r);
  }
  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-center justify-between"><div className="text-lg font-semibold">{initial ? "Edit customer" : "New customer"}</div>
        <button type="button" onClick={onClose}><X className="size-5 text-muted-foreground" /></button></div>
      <div className="space-y-2"><Label>Name</Label><Input value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} className="h-10" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2"><Label>Phone</Label><Input required type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} className="h-10" /></div>
        <div className="space-y-2"><Label>Email</Label><Input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} className="h-10" /></div>
        <div className="space-y-2"><Label>Birthday</Label><Input type="date" value={f.birthday} onChange={(e) => set({ birthday: e.target.value })} className="h-10" /></div>
        <div className="space-y-2"><Label>Anniversary</Label><Input type="date" value={f.anniversary} onChange={(e) => set({ anniversary: e.target.value })} className="h-10" /></div>
      </div>
      {s.tenant?.market === "IN" && <div className="space-y-2"><Label>GSTIN (business invoices)</Label><Input value={f.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} className="h-10 font-mono" /></div>}
      <div className="space-y-2"><Label>Tags</Label>
        <div className="flex flex-wrap gap-1.5">{[...new Set([...TAGS, ...f.tags])].map((t) => {
          const on = f.tags.includes(t);
          return <button type="button" key={t} onClick={() => set({ tags: on ? f.tags.filter((x) => x !== t) : [...f.tags, t] })}
            className={cn("rounded-full px-2.5 py-1 text-xs ring-1", on ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>{t}</button>;
        })}</div></div>
      <div className="space-y-2"><Label>Notes</Label><Textarea rows={3} value={f.notes} maxLength={2000} placeholder="Allergic to nuts · likes the window table" onChange={(e) => set({ notes: e.target.value })} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.marketing_ok} onChange={(e) => set({ marketing_ok: e.target.checked })} className="size-4" />Happy to receive offers and messages</label>
      <button className="h-11 w-full rounded-xl bg-foreground font-semibold text-background">Save</button>
    </form>
  );
}

interface PointsHistory { points: number; value: number; entries: { id: string; kind: string; points: number; note: string; user: string; order_number: number | null; created_at: string }[] }

function PointsPanel({ id, name }: { id: string; name: string }) {
  const { s, fmt } = usePos();
  const { data, setData } = usePoll<PointsHistory>(s.tenant?.loyalty_enabled ? `/customers/${id}/points` : null, 0, "customers");
  const [pts, setPts] = useState("");
  const [note, setNote] = useState("");
  if (!s.tenant?.loyalty_enabled || !data) return null;
  async function adjust() {
    const r = await run(api<PointsHistory>(`/customers/${id}/points`, { body: { points: Number(pts), note } }), `Points updated for ${name || "the guest"}`);
    if (r) { setData(r); setPts(""); setNote(""); }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between"><span className="font-medium">Points</span><span className="text-sm text-muted-foreground"><span className="font-mono font-semibold text-foreground">{data.points}</span> · worth {fmt(data.value)}</span></div>
      {can(s.user, "discount") && (
        <div className="flex gap-2">
          <Input type="number" value={pts} onChange={(e) => setPts(e.target.value)} placeholder="+50 / −20" className="h-9 w-24 font-mono" />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason" maxLength={200} className="h-9 flex-1" />
          <button onClick={adjust} disabled={!Number(pts) || note.trim().length < 2} className="h-9 rounded-lg bg-foreground px-3 text-sm font-semibold text-background disabled:opacity-40">Adjust</button>
        </div>
      )}
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {data.entries.map((e) => (
          <div key={e.id} className="flex justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{new Date(e.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · {e.note || e.kind}{e.user ? ` · ${e.user}` : ""}</span>
            <span className={cn("font-mono font-semibold", e.points < 0 ? "text-saffron-deep" : "text-[oklch(0.45_0.12_150)]")}>{e.points > 0 ? "+" : ""}{e.points}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
