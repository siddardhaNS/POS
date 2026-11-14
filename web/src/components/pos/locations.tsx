"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Copy, MapPin, Plus, Send, Store } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, money, session, type Session } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, Seg, run, usePoll, usePos } from "./shared";

/* ---------- Types (mirror api/app/routers/locations.py) ---------- */

interface Totals { net_sales: number; orders: number; tax: number; tips: number; discounts: number; refunds: number; open_checks: number; avg_check: number }
export interface Location {
  id: string; name: string; location_name: string; city: string; address: string; phone: string; status: string;
  currency: string; timezone: string; home: boolean; current: boolean; today?: Totals;
}
interface Summary { start: string; end: string; locations: (Location & Totals)[]; total: (Totals & { currency: string }) | null }
interface Access { id: string; name: string; home_tenant_id: string; tenant_ids: string[] }

export const locationLabel = (l: Pick<Location, "name" | "location_name" | "city">) => l.location_name || l.city || l.name;

/** Move this device to another location of the business: new token, device rebound, POS reloaded. */
export async function switchLocation(tenantId: string) {
  const s = await api<Session>("/auth/switch", { body: { tenant_id: tenantId } });
  session.set(s);
  try { localStorage.setItem("tiffin.device", JSON.stringify(s)); } catch { /* storage blocked: this tab only */ }
  window.location.reload();
}

/* ---------- Sidebar switcher ---------- */

export function LocationSwitcher({ enabled }: { enabled: boolean }) {
  const { s } = usePos();
  const [list, setList] = useState<Location[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    api<Location[]>("/locations").then(setList).catch(() => setList(null));
  }, [enabled, s.tenant?.id]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!enabled || !list || list.length < 2) return null;
  const cur = list.find((l) => l.current);
  return (
    <div ref={box} className="relative px-2 pb-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-lg bg-white/[0.07] px-2.5 py-2 text-left text-[13px] text-white/80 hover:bg-white/12">
        <MapPin className="size-3.5 shrink-0 text-saffron" />
        <span className="min-w-0 flex-1 truncate">{cur ? locationLabel(cur) : "Switch location"}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute inset-x-2 top-full z-50 mt-1 overflow-hidden rounded-xl bg-[#2a2926] p-1 shadow-xl ring-1 ring-white/10">
          {list.map((l) => (
            <button key={l.id} disabled={l.current || !["trial", "active"].includes(l.status)}
              onClick={() => run(switchLocation(l.id))}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-white/80 hover:bg-white/10 disabled:cursor-default">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-white">{locationLabel(l)}</span>
                <span className="block truncate text-[11px] text-white/45">
                  {l.today ? `${money(l.today.net_sales, { currency: l.currency as "INR" | "USD" })} today · ${l.today.open_checks} open` : l.city || l.status}
                </span>
              </span>
              {l.current && <Check className="size-4 text-saffron" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Locations screen ---------- */

export function LocationsScreen() {
  const { s } = usePos();
  const fmtC = (v: number, currency: string) => money(v, { currency: currency as "INR" | "USD" });
  const { data: list, reload } = usePoll<Location[]>("/locations", 60_000, "orders");
  const [range, setRange] = useState<"today" | "7d" | "30d">("today");
  const today = new Date();
  const back = { today: 0, "7d": 6, "30d": 29 }[range];
  const start = new Date(today.getTime() - back * 86400000).toISOString().slice(0, 10);
  const { data: sum } = usePoll<Summary>(`/locations/summary?start=${start}&end=${today.toISOString().slice(0, 10)}`, 60_000, "orders");
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState<Location | null>(null);
  const [pushing, setPushing] = useState(false);
  const owner = s.user.role === "owner";

  async function rename(l: Location) {
    const name = prompt("Location name", l.location_name || l.city);
    if (name?.trim() && await run(api(`/locations/${l.id}`, { method: "PATCH", body: { location_name: name.trim() } }), "Location renamed")) reload();
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold">{s.tenant?.name}</h2>
          <p className="text-sm text-muted-foreground">{list ? `${list.length} location${list.length === 1 ? "" : "s"}` : ""}</p>
        </div>
        {owner && (list?.length ?? 0) > 1 && <button onClick={() => setPushing(true)} className="ml-auto flex h-10 items-center gap-1.5 rounded-xl bg-card px-4 text-sm font-semibold ring-1 ring-border"><Send className="size-4" />Push menu to outlets</button>}
        {owner && <button onClick={() => setAdding(true)} className={cn((list?.length ?? 0) > 1 ? "" : "ml-auto", "flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background")}><Plus className="size-4" />Add location</button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list?.map((l) => (
          <div key={l.id} className={cn("rounded-2xl border bg-card p-4", l.current ? "border-foreground/40 ring-1 ring-foreground/10" : "border-border")}>
            <div className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-muted"><Store className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold">{locationLabel(l)}
                  {l.home && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium">First location</span>}
                  {l.current && <span className="rounded-md bg-leaf/15 px-1.5 py-0.5 text-[11px] font-semibold text-[oklch(0.45_0.12_150)]">You&apos;re here</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{[l.address, l.city].filter(Boolean).join(", ") || "No address yet"}</div>
              </div>
            </div>
            {l.today && (
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><div className="text-[11px] text-muted-foreground">Today</div><div className="font-mono font-semibold tabular">{fmtC(l.today.net_sales, l.currency)}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Checks</div><div className="font-mono tabular">{l.today.orders}</div></div>
                <div><div className="text-[11px] text-muted-foreground">Open now</div><div className="font-mono tabular">{l.today.open_checks}</div></div>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {!l.current && <button onClick={() => run(switchLocation(l.id))} className="h-8 rounded-lg bg-foreground px-3 text-xs font-semibold text-background">Switch here</button>}
              {owner && <button onClick={() => rename(l)} className="h-8 rounded-lg bg-muted px-3 text-xs font-medium">Rename</button>}
              {owner && list.length > 1 && <button onClick={() => setCopying(l)} className="flex h-8 items-center gap-1 rounded-lg bg-muted px-3 text-xs font-medium"><Copy className="size-3.5" />Copy menu here</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="font-semibold">All locations</div>
          <div className="ml-auto"><Seg value={range} onChange={setRange} options={[["today", "Today"], ["7d", "7 days"], ["30d", "30 days"]]} /></div>
        </div>
        {!sum ? <Empty>Loading…</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                {["Location", "Net sales", "Checks", "Avg check", "Tips", "Refunds", "Open now"].map((h, i) => <th key={h} className={cn("pb-2 font-medium", i ? "text-right" : "text-left")}>{h}</th>)}
              </tr></thead>
              <tbody>
                {sum.locations.map((l) => (
                  <tr key={l.id} className="border-b border-border/60">
                    <td className="py-2.5 font-medium">{locationLabel(l)}</td>
                    <td className="py-2.5 text-right font-mono tabular">{fmtC(l.net_sales, l.currency)}</td>
                    <td className="py-2.5 text-right font-mono tabular">{l.orders}</td>
                    <td className="py-2.5 text-right font-mono tabular">{fmtC(l.avg_check, l.currency)}</td>
                    <td className="py-2.5 text-right font-mono tabular">{fmtC(l.tips, l.currency)}</td>
                    <td className="py-2.5 text-right font-mono tabular">{fmtC(l.refunds, l.currency)}</td>
                    <td className="py-2.5 text-right font-mono tabular">{l.open_checks}</td>
                  </tr>
                ))}
                {sum.total && sum.locations.length > 1 && (
                  <tr className="font-semibold">
                    <td className="pt-3">Total</td>
                    <td className="pt-3 text-right font-mono tabular">{fmtC(sum.total.net_sales, sum.total.currency)}</td>
                    <td className="pt-3 text-right font-mono tabular">{sum.total.orders}</td>
                    <td className="pt-3 text-right font-mono tabular">{fmtC(sum.total.avg_check, sum.total.currency)}</td>
                    <td className="pt-3 text-right font-mono tabular">{fmtC(sum.total.tips, sum.total.currency)}</td>
                    <td className="pt-3 text-right font-mono tabular">{fmtC(sum.total.refunds, sum.total.currency)}</td>
                    <td className="pt-3 text-right font-mono tabular">{sum.total.open_checks}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {owner && list && list.length > 1 && <ManagerAccess locations={list} />}
      {adding && list && <AddLocation locations={list} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); reload(); }} />}
      {copying && list && <CopyMenu to={copying} locations={list} onClose={() => setCopying(null)} />}
      {pushing && list && <PushMenu locations={list} onClose={() => setPushing(false)} />}
    </div>
  );
}

function ManagerAccess({ locations }: { locations: Location[] }) {
  const { data, reload } = usePoll<Access[]>("/locations/access", 0);
  async function toggle(m: Access, tid: string) {
    const next = m.tenant_ids.includes(tid) ? m.tenant_ids.filter((x) => x !== tid) : [...m.tenant_ids, tid];
    if (await run(api(`/locations/access/${m.id}`, { method: "PUT", body: { tenant_ids: next } }), "Access updated")) reload();
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="font-semibold">Manager access</div>
      <p className="mt-1 text-sm text-muted-foreground">Managers always work at their own location. Tick the other locations each one may switch into. Owners can use every location.</p>
      {!data ? <Empty>Loading…</Empty> : !data.length ? <p className="mt-3 text-sm text-muted-foreground">No managers yet. Add them in Staff &amp; roles.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="pb-2 text-left font-medium">Manager</th>
              {locations.map((l) => <th key={l.id} className="pb-2 text-center font-medium">{locationLabel(l)}</th>)}</tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2.5 font-medium">{m.name}</td>
                  {locations.map((l) => (
                    <td key={l.id} className="py-2.5 text-center">
                      {l.id === m.home_tenant_id ? <span className="text-xs text-muted-foreground">Home</span>
                        : <input type="checkbox" checked={m.tenant_ids.includes(l.id)} onChange={() => toggle(m, l.id)} className="size-4 accent-foreground" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddLocation({ locations, onClose, onAdded }: { locations: Location[]; onClose: () => void; onAdded: () => void }) {
  const cur = locations.find((l) => l.current) ?? locations[0];
  const [f, setF] = useState({ location_name: "", city: "", address: "", phone: "", copy_menu_from: cur?.id ?? "", copy_tables: false });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await run(api<Location>("/locations", { body: { ...f, copy_menu_from: f.copy_menu_from || null } }), `${f.location_name} added`);
    setBusy(false);
    if (r) onAdded();
  }
  const sel = "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Add a location</DialogTitle>
          <DialogDescription>A new outlet of the same business, with its own floor, staff, cash drawer and sales. It gets your taxes, currency and modules.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="space-y-2"><Label htmlFor="loc-name">Location name</Label><Input id="loc-name" required maxLength={80} value={f.location_name} onChange={(e) => setF({ ...f, location_name: e.target.value })} placeholder="e.g. Downtown, Airport, Koramangala" className="h-11" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>City</Label><Input maxLength={120} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} className="h-11" /></div>
            <div className="space-y-2"><Label>Phone</Label><Input type="tel" maxLength={40} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="h-11" /></div>
          </div>
          <div className="space-y-2"><Label>Address</Label><Input maxLength={400} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} className="h-11" /></div>
          <div className="space-y-2"><Label>Menu</Label>
            <select value={f.copy_menu_from} onChange={(e) => setF({ ...f, copy_menu_from: e.target.value })} className={sel}>
              {locations.map((l) => <option key={l.id} value={l.id}>Copy the menu from {locationLabel(l)}</option>)}
              <option value="">Start with the starter menu</option>
            </select></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.copy_tables} onChange={(e) => setF({ ...f, copy_tables: e.target.checked })} className="size-4 accent-foreground" />Copy the floor plan too</label>
          <button type="submit" disabled={busy} className="h-11 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">{busy ? "Adding…" : "Add location"}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyMenu({ to, locations, onClose }: { to: Location; locations: Location[]; onClose: () => void }) {
  const others = locations.filter((l) => l.id !== to.id);
  const [from, setFrom] = useState(others[0]?.id ?? "");
  const [mode, setMode] = useState<"add_missing" | "overwrite_prices">("add_missing");
  async function go() {
    const r = await run(api<Record<string, number>>(`/locations/${to.id}/copy-menu`, { body: { from_tenant_id: from, mode } }));
    if (r) { toast.success(`Menu copied to ${locationLabel(to)}`); onClose(); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Copy menu to {locationLabel(to)}</DialogTitle><DialogDescription>Categories, items and options are matched by name.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm">
            {others.map((l) => <option key={l.id} value={l.id}>From {locationLabel(l)}</option>)}
          </select>
          <Seg value={mode} onChange={setMode} options={[["add_missing", "Add missing items"], ["overwrite_prices", "Also update prices"]]} />
          <button onClick={go} className="h-11 rounded-xl bg-foreground font-semibold text-background">Copy menu</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PushMenu({ locations, onClose }: { locations: Location[]; onClose: () => void }) {
  const here = locations.find((l) => l.current);
  const others = locations.filter((l) => !l.current && ["trial", "active"].includes(l.status));
  const [to, setTo] = useState<string[]>(others.map((l) => l.id));
  const [mode, setMode] = useState<"add_missing" | "overwrite_prices" | "full">("overwrite_prices");
  async function push() {
    const r = await run(api<{ name: string; items_added: number; prices_updated: number; details_updated?: number }[]>("/locations/push-menu", { body: { to, mode } }));
    if (!r) return;
    toast.success(r.map((x) => `${x.name}: ${x.items_added} added, ${x.prices_updated} prices${x.details_updated ? `, ${x.details_updated} details` : ""}`).join(" · ") || "Nothing to change");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Push the menu from {here ? locationLabel(here) : "here"}</DialogTitle>
          <DialogDescription>Change the menu once here, then send it to the outlets you pick. Dishes are matched by name; anything an outlet has that this one doesn&apos;t stays as it is.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            {others.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={to.includes(l.id)} className="size-4"
                onChange={(e) => setTo(e.target.checked ? [...to, l.id] : to.filter((x) => x !== l.id))} />{locationLabel(l)}</label>
            ))}
          </div>
          <div className="space-y-2"><Label>What to send</Label>
            <Seg value={mode} onChange={setMode} options={[["add_missing", "New dishes only"], ["overwrite_prices", "+ prices"], ["full", "+ prices & details"]]} />
            <p className="text-xs text-muted-foreground">{mode === "full" ? "Prices, descriptions, allergens, channels and what's sold out are made the same everywhere." : mode === "overwrite_prices" ? "New dishes are added and prices are made the same." : "Only dishes the outlet doesn't have yet are added."}</p></div>
          <button onClick={push} disabled={!to.length} className="h-11 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">Push to {to.length} outlet{to.length === 1 ? "" : "s"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
