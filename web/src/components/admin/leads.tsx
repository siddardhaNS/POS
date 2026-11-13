"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, ExternalLink, Globe, Loader2, MapPin, Phone, Plus, Search, Star, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { API_URL, api, session } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ---------- Types (mirror api/app/routers/leads.py) ---------- */

interface Candidate {
  osm_id: string | null; google_place_id: string | null; name: string; category: string; cuisine: string; address: string;
  area: string; city: string; postcode: string; lat: number | null; lon: number | null; phone: string; website: string; email: string;
  rating: number | null; reviews: number | null; opening_hours: string; sources: string[]; distance_m: number;
  lead_id: string | null; lead_status: string | null; customer: boolean;
}
interface SearchResult { center: { lat: number; lon: number; label: string; city: string }; results: Candidate[]; notes: string[]; counts: { total: number; with_phone: number; new: number } }
interface Lead extends Omit<Candidate, "distance_m" | "lead_id" | "lead_status" | "customer"> {
  id: string; contact_name: string; contacts: Contact[]; details: Record<string, string>; custom_fields: { label: string; value: string }[]; status: string; follow_up_on: string | null; notes: string; created_at: string; last_contacted_at: string | null;
  activities?: { id: string; kind: string; text: string; user: string; created_at: string }[];
}
interface Contact { name: string; role: string; phone: string; whatsapp: boolean; email: string; decision_maker: boolean }
interface LeadList { leads: Lead[]; counts: Record<string, number>; total: number; due: number; cities: string[] }
interface Sources { osm: boolean; google: boolean; categories: { key: string; label: string }[] }

export const LEAD_STATUSES: [string, string][] = [
  ["new", "New"], ["contacted", "Contacted"], ["interested", "Interested"], ["demo", "Demo booked"], ["won", "Won"], ["lost", "Lost"], ["not_fit", "Not a fit"],
];
const LABEL = Object.fromEntries(LEAD_STATUSES);
const TONE: Record<string, string> = {
  new: "bg-muted text-foreground", contacted: "bg-[oklch(0.94_0.05_250)] text-[oklch(0.42_0.12_250)]", interested: "bg-accent text-accent-foreground",
  demo: "bg-saffron/20 text-saffron-deep", won: "bg-[oklch(0.94_0.05_150)] text-[oklch(0.42_0.12_150)]", lost: "bg-destructive/10 text-destructive",
  not_fit: "bg-muted text-muted-foreground",
};
const SRC: Record<string, string> = { osm: "OpenStreetMap", google: "Google", manual: "Added by hand" };
const KIND: Record<string, string> = { note: "Note", call: "Call", email: "Email", visit: "Visit", status: "Status" };

const today = () => new Date().toISOString().slice(0, 10);
const mapUrl = (l: { google_place_id: string | null; osm_id: string | null; lat: number | null; lon: number | null; name: string }) =>
  l.google_place_id ? `https://www.google.com/maps/place/?q=place_id:${l.google_place_id}`
    : l.osm_id ? `https://www.openstreetmap.org/${l.osm_id}`
      : l.lat != null ? `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=18/${l.lat}/${l.lon}` : null;
const site = (u: string) => (u.startsWith("http") ? u : `https://${u}`);

function Pill({ s }: { s: string }) {
  return <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", TONE[s])}>{LABEL[s] ?? s}</span>;
}

/* ---------- Leads screen ---------- */

export function LeadsPanel() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const [hasPhone, setHasPhone] = useState(false);
  const [due, setDue] = useState(false);
  const [data, setData] = useState<LeadList | null>(null);
  const [finding, setFinding] = useState(false);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (q) p.set("q", q);
    if (city) p.set("city", city);
    if (hasPhone) p.set("has_phone", "true");
    if (due) p.set("due", "true");
    try { setData(await api<LeadList>(`/admin/leads?${p}`)); } catch (e) { toast.error((e as Error).message); }
  }, [status, q, city, hasPhone, due]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function exportCsv() {
    try {
      const res = await fetch(`${API_URL}/admin/leads/export/csv${status ? `?status=${status}` : ""}`, { headers: { authorization: `Bearer ${session.get()?.token}` } });
      if (!res.ok) throw new Error("Couldn't export");
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: `tiffin-leads-${today()}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error((e as Error).message); }
  }

  const pipeline = LEAD_STATUSES.slice(0, 5);
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">Find restaurants by area and work them from first call to signed up.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={exportCsv} className="flex h-10 items-center gap-1.5 rounded-xl bg-card px-4 text-sm font-medium ring-1 ring-border"><Download className="size-4" />CSV</button>
          <button onClick={() => setAdding(true)} className="flex h-10 items-center gap-1.5 rounded-xl bg-card px-4 text-sm font-medium ring-1 ring-border"><Plus className="size-4" />Add by hand</button>
          <button onClick={() => setFinding(true)} className="flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background"><Search className="size-4" />Find restaurants</button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {pipeline.map(([k, l]) => (
          <button key={k} onClick={() => setStatus(status === k ? "" : k)}
            className={cn("rounded-2xl border bg-card p-4 text-left transition", status === k ? "border-foreground/30 ring-1 ring-foreground/10" : "border-border hover:border-foreground/20")}>
            <div className="text-sm text-muted-foreground">{l}</div>
            <div className="mt-2 font-mono text-2xl font-semibold tabular">{data?.counts[k] ?? "–"}</div>
          </button>
        ))}
        <button onClick={() => setDue(!due)} className={cn("rounded-2xl border bg-card p-4 text-left transition", due ? "border-saffron ring-1 ring-saffron/30" : "border-border hover:border-foreground/20")}>
          <div className="text-sm text-muted-foreground">Follow up today</div>
          <div className={cn("mt-2 font-mono text-2xl font-semibold tabular", !!data?.due && "text-saffron-deep")}>{data?.due ?? "–"}</div>
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, area, cuisine, phone" className="h-10 bg-card pl-9" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-lg border border-input bg-card px-3 text-sm">
          <option value="">Every status</option>{LEAD_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)} className="h-10 rounded-lg border border-input bg-card px-3 text-sm">
          <option value="">Every city</option>{data?.cities.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} className="size-4 accent-foreground" />Has a phone number</label>
        <span className="ml-auto text-sm text-muted-foreground">{data ? `${data.leads.length} of ${data.total}` : ""}</span>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        {!data ? <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
          : !data.leads.length ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {data.total ? "No leads match these filters." : <>No leads yet. Click <b>Find restaurants</b> and search an area to start.</>}
            </div>
          ) : data.leads.map((l) => (
            <button key={l.id} onClick={() => setOpen(l.id)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-border px-5 py-3.5 text-left last:border-0 hover:bg-muted/40 md:grid-cols-[2fr_1.4fr_1fr_auto]">
              <div className="min-w-0">
                <div className="truncate font-medium">{l.name}</div>
                <div className="truncate text-xs text-muted-foreground">{[l.cuisine || l.category, l.area, l.city].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="hidden min-w-0 text-sm md:block">
                <div className="truncate">{l.phone || <span className="text-muted-foreground">No phone</span>}</div>
                <div className="truncate text-xs text-muted-foreground">{l.website ? l.website.replace(/^https?:\/\/(www\.)?/, "") : l.email || ""}</div>
              </div>
              <div className="hidden text-sm text-muted-foreground md:block">
                {l.follow_up_on ? <span className={cn(l.follow_up_on <= today() && !["won", "lost", "not_fit"].includes(l.status) && "font-medium text-saffron-deep")}>Follow up {new Date(l.follow_up_on + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  : l.rating != null ? <span className="inline-flex items-center gap-1"><Star className="size-3.5" />{l.rating} ({l.reviews ?? 0})</span> : ""}
              </div>
              <div className="row-span-2 self-center md:row-span-1"><Pill s={l.status} /></div>
            </button>
          ))}
      </div>

      {finding && <FindDialog onClose={() => setFinding(false)} onSaved={() => { setFinding(false); load(); }} />}
      {adding && <AddDialog onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); load(); setOpen(id); }} />}
      {open && <LeadDialog id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}

/* ---------- Find restaurants ---------- */

function FindDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [sources, setSources] = useState<Sources | null>(null);
  const [area, setArea] = useState("");
  const [radius, setRadius] = useState(2);
  const [cats, setCats] = useState<string[]>(["restaurant", "cafe", "fast_food"]);
  const [from, setFrom] = useState<string[]>(["osm"]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SearchResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [onlyPhone, setOnlyPhone] = useState(false);

  useEffect(() => {
    api<Sources>("/admin/leads/sources").then((s) => { setSources(s); if (s.google) setFrom(["osm", "google"]); }).catch(() => {});
  }, []);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setRes(null);
    try {
      const r = await api<SearchResult>("/admin/leads/search", { body: { area, radius_km: radius, categories: cats, sources: from } });
      setRes(r);
      setPicked(new Set(r.results.map((c, i) => (!c.lead_id && !c.customer ? i : -1)).filter((i) => i >= 0)));
      r.notes.forEach((n) => toast.info(n));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shown = useMemo(() => (res?.results ?? []).map((c, i) => [c, i] as const).filter(([c]) => !onlyPhone || c.phone), [res, onlyPhone]);
  const selectable = shown.filter(([c]) => !c.lead_id && !c.customer);
  const allOn = selectable.length > 0 && selectable.every(([, i]) => picked.has(i));
  async function save() {
    const items = (res?.results ?? []).filter((_, i) => picked.has(i)); // the API ignores the extra preview fields
    if (!items.length) return toast.error("Pick at least one restaurant");
    setBusy(true);
    try {
      const r = await api<{ added: number; skipped: number }>("/admin/leads/import", { body: { items } });
      toast.success(`${r.added} lead${r.added === 1 ? "" : "s"} saved${r.skipped ? ` · ${r.skipped} already known` : ""}`);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Find restaurants</DialogTitle>
          <DialogDescription>Search an area, review what comes back, and save the ones worth approaching.</DialogDescription>
        </DialogHeader>
        <form onSubmit={search} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-2"><Label htmlFor="lf-area">Area</Label>
              <Input id="lf-area" autoFocus required minLength={2} value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Indiranagar, Bengaluru or Jersey City, NJ" className="h-11" /></div>
            <div className="space-y-2"><Label>Within</Label>
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm">
                {[0.5, 1, 2, 3, 5, 10].map((k) => <option key={k} value={k}>{k} km</option>)}
              </select></div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(sources?.categories ?? []).map((c) => (
              <button type="button" key={c.key} onClick={() => setCats(toggle(cats, c.key))}
                className={cn("h-9 rounded-lg px-3 text-sm font-medium ring-1", cats.includes(c.key) ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>{c.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted-foreground">Search</span>
            <label className="flex items-center gap-2"><input type="checkbox" checked={from.includes("osm")} onChange={() => setFrom(toggle(from, "osm"))} className="size-4 accent-foreground" />OpenStreetMap <span className="text-xs text-muted-foreground">free</span></label>
            <label className={cn("flex items-center gap-2", !sources?.google && "opacity-50")} title={sources?.google ? "" : "Set GOOGLE_PLACES_API_KEY on the API to turn this on"}>
              <input type="checkbox" disabled={!sources?.google} checked={from.includes("google")} onChange={() => setFrom(toggle(from, "google"))} className="size-4 accent-foreground" />
              Google {sources && !sources.google ? <span className="text-xs text-muted-foreground">not set up</span> : <span className="text-xs text-muted-foreground">phones and ratings, paid per search</span>}
            </label>
            <button type="submit" disabled={busy || !area.trim() || !cats.length || !from.length} className="ml-auto flex h-10 items-center gap-2 rounded-xl bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-40">
              {busy && !res ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}Search
            </button>
          </div>
        </form>

        {busy && !res && <div className="py-8 text-center text-sm text-muted-foreground">Searching… OpenStreetMap can take up to a minute when it is busy.</div>}
        {res && (
          <div className="grid gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="min-w-0 truncate text-muted-foreground"><MapPin className="mr-1 inline size-4" />{res.center.label}</span>
              <span className="ml-auto text-muted-foreground">{res.counts.total} found · {res.counts.with_phone} with a phone · {res.counts.new} new</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set([...picked, ...selectable.map(([, i]) => i)]))} className="size-4 accent-foreground" />Select all shown</label>
              <label className="flex items-center gap-2 text-muted-foreground"><input type="checkbox" checked={onlyPhone} onChange={(e) => setOnlyPhone(e.target.checked)} className="size-4 accent-foreground" />Only with a phone number</label>
            </div>
            <div className="max-h-[45vh] divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {!shown.length && <div className="p-6 text-center text-sm text-muted-foreground">Nothing found. Try a bigger radius or another area name.</div>}
              {shown.map(([c, i]) => {
                const done = !!c.lead_id || c.customer;
                return (
                  <label key={i} className={cn("flex cursor-pointer items-start gap-3 px-4 py-3", done && "cursor-default opacity-60")}>
                    <input type="checkbox" disabled={done} checked={picked.has(i)} onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })} className="mt-1 size-4 accent-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">{c.name}
                        {c.customer && <span className="rounded-md bg-leaf/15 px-1.5 py-0.5 text-[11px] font-semibold text-[oklch(0.45_0.12_150)]">Tiffin customer</span>}
                        {c.lead_status && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold">Saved · {LABEL[c.lead_status]}</span>}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{[c.cuisine || c.category, c.address || c.area, `${c.distance_m < 1000 ? `${c.distance_m} m` : `${(c.distance_m / 1000).toFixed(1)} km`} away`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                      <span className="block">{c.phone || "No phone"}</span>
                      <span className="block">{c.rating != null ? `★ ${c.rating} (${c.reviews ?? 0})` : c.sources.map((s) => SRC[s]).join(" + ")}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <button onClick={save} disabled={busy || !picked.size} className="h-11 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">
              {busy ? "Saving…" : `Save ${picked.size} lead${picked.size === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Add by hand ---------- */

function AddDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({ name: "", city: "", area: "", phone: "", email: "", contact_name: "", notes: "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { onSaved((await api<Lead>("/admin/leads", { body: f })).id); toast.success("Lead added"); } catch (err) { toast.error((err as Error).message); }
  }
  const field = (k: keyof typeof f, l: string, type = "text") => (
    <div className="space-y-2"><Label htmlFor={`la-${k}`}>{l}</Label><Input id={`la-${k}`} type={type} required={k === "name"} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} className="h-11" /></div>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Add a lead</DialogTitle><DialogDescription>A restaurant you heard about or met in person.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          {field("name", "Restaurant")}
          <div className="grid gap-4 sm:grid-cols-2">{field("area", "Area")}{field("city", "City")}</div>
          <div className="grid gap-4 sm:grid-cols-2">{field("contact_name", "Contact person")}{field("phone", "Phone", "tel")}</div>
          {field("email", "Email", "email")}
          <div className="space-y-2"><Label htmlFor="la-notes">Notes</Label><Textarea id="la-notes" rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></div>
          <button type="submit" className="h-11 rounded-xl bg-foreground font-semibold text-background">Add lead</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- One lead ---------- */

function LeadDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [l, setL] = useState<Lead | null>(null);
  const [kind, setKind] = useState<"call" | "email" | "visit" | "note">("call");
  const [text, setText] = useState("");
  const [next, setNext] = useState("");

  useEffect(() => {
    api<Lead>(`/admin/leads/${id}`).then(setL).catch((e) => toast.error(e.message));
  }, [id]);

  async function patch(body: Record<string, unknown>, ok?: string) {
    try { setL(await api<Lead>(`/admin/leads/${id}`, { method: "PATCH", body })); if (ok) toast.success(ok); onChanged(); } catch (e) { toast.error((e as Error).message); }
  }
  async function log(e: React.FormEvent) {
    e.preventDefault();
    try {
      setL(await api<Lead>(`/admin/leads/${id}/activities`, { body: { kind, text, follow_up_on: next || null } }));
      setText(""); setNext(""); onChanged();
    } catch (err) { toast.error((err as Error).message); }
  }
  async function remove() {
    if (!l || !confirm(`Delete the lead for ${l.name}?`)) return;
    try { await api(`/admin/leads/${id}`, { method: "DELETE" }); toast.success("Lead deleted"); onChanged(); onClose(); } catch (e) { toast.error((e as Error).message); }
  }
  const map = l ? mapUrl(l) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {!l ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div> : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-3"><DialogTitle className="text-xl">{l.name}</DialogTitle><Pill s={l.status} /></div>
              <DialogDescription>{[l.cuisine || l.category, l.address || [l.area, l.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2 text-sm">
              {l.phone && <a href={`tel:${l.phone.replace(/\s/g, "")}`} className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 font-medium"><Phone className="size-4" />{l.phone}</a>}
              {l.website && <a href={site(l.website)} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 font-medium"><Globe className="size-4" />Website</a>}
              {map && <a href={map} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 font-medium"><ExternalLink className="size-4" />Map</a>}
              {l.rating != null && <span className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3"><Star className="size-4" />{l.rating} · {l.reviews ?? 0} reviews</span>}
              <span className="flex h-9 items-center rounded-lg px-1 text-xs text-muted-foreground">{l.sources.map((s) => SRC[s] ?? s).join(" + ")}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Status</Label>
                <select value={l.status} onChange={(e) => patch({ status: e.target.value }, `Moved to ${LABEL[e.target.value]}`)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm">
                  {LEAD_STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div className="space-y-2"><Label>Follow up on</Label>
                <div className="flex gap-2">
                  <Input type="date" value={l.follow_up_on ?? ""} onChange={(e) => (e.target.value ? patch({ follow_up_on: e.target.value }) : patch({ clear_follow_up: true }))} className="h-11" />
                  {l.follow_up_on && <button onClick={() => patch({ clear_follow_up: true })} className="h-11 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted">Clear</button>}
                </div></div>
            </div>

            <LeadProfile key={l.id} lead={l} onSave={(body) => patch(body, "Saved")} />

            <form onSubmit={log} className="grid gap-2 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                {(["call", "email", "visit", "note"] as const).map((k) => (
                  <button type="button" key={k} onClick={() => setKind(k)} className={cn("h-8 rounded-lg px-3 text-sm font-medium ring-1", kind === k ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>{KIND[k]}</button>
                ))}
              </div>
              <Textarea required rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "call" ? "What did they say? e.g. owner busy, call back after 4 pm" : kind === "note" ? "Anything worth remembering" : "What happened?"} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Next follow-up</span>
                <Input type="date" min={today()} value={next} onChange={(e) => setNext(e.target.value)} className="h-9 w-40" />
                <button type="submit" disabled={!text.trim()} className="ml-auto h-9 rounded-lg bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-40">Log {KIND[kind].toLowerCase()}</button>
              </div>
            </form>

            <div className="divide-y divide-border text-sm">
              {l.activities?.map((a) => (
                <div key={a.id} className="flex gap-3 py-2.5">
                  <span className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{KIND[a.kind] ?? a.kind}</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap">{a.text}</span>
                  <span className="shrink-0 text-right text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}<span className="block">{a.user}</span></span>
                </div>
              ))}
            </div>
            <button onClick={remove} className="flex h-9 w-fit items-center gap-1.5 rounded-lg px-3 text-sm text-destructive hover:bg-destructive/10"><Trash2 className="size-4" />Delete lead</button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Contacts, restaurant details and custom fields ---------- */

const ROLES = ["Owner", "Partner", "Manager", "Head chef", "Accountant", "IT / admin"];
const digits = (p: string) => p.replace(/[^0-9]/g, "");
const blankContact = (): Contact => ({ name: "", role: "", phone: "", whatsapp: false, email: "", decision_maker: false });

function LeadProfile({ lead, onSave }: { lead: Lead; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const initial = useMemo(() => ({
    phone: lead.phone, email: lead.email, website: lead.website,
    contacts: lead.contacts ?? [], details: lead.details ?? {}, custom_fields: lead.custom_fields ?? [],
  }), [lead]);
  const [f, setF] = useState(initial);
  const [fields, setFields] = useState<{ key: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api<{ key: string; label: string }[]>("/admin/leads/fields").then(setFields).catch(() => {}); }, []);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const setContact = (i: number, p: Partial<Contact>) => setF((x) => ({
    ...x, contacts: x.contacts.map((c, k) => (k === i ? { ...c, ...p } : p.decision_maker ? { ...c, decision_maker: false } : c)),
  }));
  const setCustom = (i: number, p: Partial<{ label: string; value: string }>) =>
    setF((x) => ({ ...x, custom_fields: x.custom_fields.map((c, k) => (k === i ? { ...c, ...p } : c)) }));
  async function save() {
    setSaving(true);
    await onSave({ ...f, custom_fields: f.custom_fields.filter((c) => c.label.trim()) });
    setSaving(false);
  }
  const box = "h-9 bg-card";
  const section = "mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const addBtn = "flex h-9 w-fit items-center gap-1.5 rounded-lg bg-card px-3 text-sm font-medium ring-1 ring-border";
  return (
    <div className="grid gap-4 rounded-xl bg-muted/40 p-3.5">
      <div>
        <div className={section}>Restaurant</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Main phone" type="tel" className={box} />
          <Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Main email" type="email" className={box} />
          <Input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="Website" className={box} />
        </div>
      </div>

      <div>
        <div className={section}>People</div>
        <div className="grid gap-2">
          {f.contacts.map((c, i) => (
            <div key={i} className="grid gap-2 rounded-lg bg-card p-2.5 ring-1 ring-border">
              <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                <Input value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} placeholder="Name" className="h-9" />
                <Input value={c.role} onChange={(e) => setContact(i, { role: e.target.value })} placeholder="Role" list="lead-roles" className="h-9" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={c.phone} onChange={(e) => setContact(i, { phone: e.target.value })} placeholder="Phone" type="tel" className="h-9" />
                <Input value={c.email} onChange={(e) => setContact(i, { email: e.target.value })} placeholder="Email" type="email" className="h-9" />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={c.whatsapp} onChange={(e) => setContact(i, { whatsapp: e.target.checked })} className="size-4 accent-foreground" />On WhatsApp</label>
                <label className="flex items-center gap-1.5"><input type="radio" name="decision-maker" checked={c.decision_maker} onChange={() => setContact(i, { decision_maker: true })} className="size-4 accent-foreground" />Decision maker</label>
                <span className="ml-auto flex gap-1.5">
                  {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="flex h-8 items-center gap-1 rounded-lg bg-muted px-2.5 text-xs font-medium"><Phone className="size-3.5" />Call</a>}
                  {c.phone && c.whatsapp && <a href={`https://wa.me/${digits(c.phone)}`} target="_blank" rel="noreferrer" className="flex h-8 items-center rounded-lg bg-muted px-2.5 text-xs font-medium">WhatsApp</a>}
                  {c.email && <a href={`mailto:${c.email}`} className="flex h-8 items-center rounded-lg bg-muted px-2.5 text-xs font-medium">Email</a>}
                  <button type="button" onClick={() => setF((x) => ({ ...x, contacts: x.contacts.filter((_, k) => k !== i) }))} title="Remove person"
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Trash2 className="size-3.5" /></button>
                </span>
              </div>
            </div>
          ))}
          <datalist id="lead-roles">{ROLES.map((r) => <option key={r} value={r} />)}</datalist>
          <button type="button" onClick={() => setF((x) => ({ ...x, contacts: [...x.contacts, { ...blankContact(), decision_maker: !x.contacts.length }] }))} className={addBtn}>
            <Plus className="size-4" />Add person
          </button>
        </div>
      </div>

      <div>
        <div className={section}>Details</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((d) => (
            <label key={d.key} className="grid grid-cols-[8.5rem_1fr] items-center gap-2 text-sm">
              <span className="text-muted-foreground">{d.label}</span>
              <Input value={f.details[d.key] ?? ""} onChange={(e) => setF((x) => ({ ...x, details: { ...x.details, [d.key]: e.target.value } }))} className={box} />
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className={section}>Other details</div>
        <div className="grid gap-2">
          {f.custom_fields.map((c, i) => (
            <div key={i} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-2">
              <Input value={c.label} onChange={(e) => setCustom(i, { label: e.target.value })} placeholder="Label" className={box} />
              <Input value={c.value} onChange={(e) => setCustom(i, { value: e.target.value })} placeholder="Value" className={box} />
              <button type="button" onClick={() => setF((x) => ({ ...x, custom_fields: x.custom_fields.filter((_, k) => k !== i) }))}
                className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setF((x) => ({ ...x, custom_fields: [...x.custom_fields, { label: "", value: "" }] }))} className={addBtn}>
            <Plus className="size-4" />Add a field
          </button>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 flex gap-2 rounded-lg bg-card p-2 ring-1 ring-border">
          <button type="button" onClick={() => setF(initial)} className="h-10 rounded-lg px-4 text-sm text-muted-foreground hover:bg-muted">Undo changes</button>
          <button type="button" disabled={saving} onClick={save} className="ml-auto h-10 rounded-lg bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-40">
            {saving ? "Saving…" : "Save details"}
          </button>
        </div>
      )}
    </div>
  );
}
