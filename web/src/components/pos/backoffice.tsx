"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ListPlus, Plus, ScanText, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/auth-shell";
import { MenuImport } from "./menu-import";
import type { Category, MenuItem, ModGroup } from "./types";
import { METHOD_LABEL, Seg, VegDot, run, usePoll, usePos } from "./shared";

/* ---------------- Dashboard ---------------- */

interface Kpi { net_sales: number; orders: number; avg_order: number; tips: number; tax: number; discounts: number; refunds: number }
interface Summary { current: Kpi; previous: Kpi; labels: string[]; series: number[]; payment_mix: Record<string, number>; channels: Record<string, number> }

export function Dashboard() {
  const { s, fmt } = usePos();
  const [range, setRange] = useState<"today" | "7d" | "30d">("today");
  const { data } = usePoll<Summary>(`/reports/summary?range=${range}`, 30000, "orders");
  const [hover, setHover] = useState<number | null>(null);

  const delta = (a: number, b: number) => (b ? `${a >= b ? "+" : "−"}${Math.abs(((a - b) / b) * 100).toFixed(1)}% vs previous` : "No prior data");
  const max = Math.max(1, ...(data?.series ?? [1]));
  const kpis = data ? [
    { l: "Net sales", v: fmt(data.current.net_sales), d: delta(data.current.net_sales, data.previous.net_sales), up: data.current.net_sales >= data.previous.net_sales },
    { l: "Orders", v: String(data.current.orders), d: delta(data.current.orders, data.previous.orders), up: data.current.orders >= data.previous.orders },
    { l: "Avg order value", v: fmt(data.current.avg_order), d: delta(data.current.avg_order, data.previous.avg_order), up: data.current.avg_order >= data.previous.avg_order },
    s.tenant?.tips_enabled
      ? { l: "Tips collected", v: fmt(data.current.tips), d: `Discounts ${fmt(data.current.discounts)} · refunds ${fmt(data.current.refunds)}`, up: true }
      : { l: "Tax collected", v: fmt(data.current.tax), d: `Discounts ${fmt(data.current.discounts)} · refunds ${fmt(data.current.refunds)}`, up: true },
  ] : [];

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold">{{ today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" }[range]}</h2>
        <div className="ml-auto"><Seg value={range} onChange={setRange} options={[["today", "Today"], ["7d", "7 days"], ["30d", "30 days"]]} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.l} className="rounded-2xl border border-border bg-card p-5">
            <div className="text-sm text-muted-foreground">{k.l}</div>
            <div className="mt-2 font-mono text-2xl font-semibold tabular md:text-3xl">{k.v}</div>
            <div className={cn("mt-1.5 text-xs", k.up ? "text-[oklch(0.5_0.13_150)]" : "text-destructive")}>{k.d}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{range === "today" ? "Sales by hour" : "Sales by day"}</div>
            <div className="font-mono text-sm text-muted-foreground">{hover != null && data ? `${data.labels[hover]} · ${fmt(data.series[hover])}` : "Hover a bar"}</div>
          </div>
          <div className="mt-6 flex h-56 items-end gap-1.5" onMouseLeave={() => setHover(null)}>
            {data?.series.map((v, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2" onMouseEnter={() => setHover(i)}>
                <div className={cn("w-full rounded-t-md transition-colors", hover === i ? "bg-saffron" : "bg-foreground")} style={{ height: `${Math.max(2, (v / max) * 100)}%`, opacity: v ? 1 : 0.15 }} />
                <span className="text-[10px] text-muted-foreground">{data.labels[i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="font-semibold">Payments & channels</div>
          <div className="mt-4 space-y-3 text-sm">
            {data && Object.entries(data.payment_mix).length === 0 && <p className="text-muted-foreground">No paid checks in this period yet.</p>}
            {data && Object.entries(data.payment_mix).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-muted-foreground">{METHOD_LABEL[k] ?? k}</span><span className="font-mono">{v} checks</span></div>
            ))}
            {data && Object.entries(data.channels).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="capitalize text-muted-foreground">{k.replace("_", "-")}</span><span className="font-mono">{fmt(v)}</span></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Menu ---------------- */

const STATIONS = ["Curry", "Tandoor", "Fry", "Cold", "Bar", "Kitchen"];

export function MenuAdmin() {
  const { s, fmt } = usePos();
  const edit = can(s.user, "menu_edit");
  const { data: menu, reload, setData } = usePoll<Category[]>("/menu/manage", 0, "menu");
  const [cat, setCat] = useState<string | null>(null);
  const [sel, setSel] = useState<MenuItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [options, setOptions] = useState<MenuItem | null>(null);
  const active = cat ?? menu?.[0]?.id ?? null;
  const cur = menu?.find((c) => c.id === active);

  const patch = (id: string, p: Partial<MenuItem>) =>
    setData((d) => d && d.map((c) => ({ ...c, items: c.items.map((i) => i.id === id ? { ...i, ...p } : i) })));

  async function toggle(m: MenuItem) {
    if (!edit) return toast.error('View only · editing the menu needs "Edit menu & prices"');
    patch(m.id, { available: !m.available });
    if (await run(api(`/menu/items/${m.id}`, { method: "PATCH", body: { available: !m.available } }))) {
      toast.success(m.available ? `${m.name} marked out of stock on all channels` : `${m.name} back on all channels`);
    } else reload();
  }

  async function save() {
    if (!sel) return;
    const body = { name: sel.name, price: sel.price, is_veg: sel.is_veg, station: sel.station, category_id: sel.category_id, available: sel.available };
    const r = sel.id ? await run(api(`/menu/items/${sel.id}`, { method: "PATCH", body }), `${sel.name} published`)
      : await run(api("/menu/items", { body }), `${sel.name} added to the menu`);
    if (r) { setSel(null); reload(); }
  }

  async function remove() {
    if (!sel?.id) return;
    if (await run(api(`/menu/items/${sel.id}`, { method: "DELETE" }), `${sel.name} deleted`)) { setSel(null); reload(); }
  }

  async function addCategory() {
    const name = prompt("New category name");
    if (name && await run(api("/menu/categories", { body: { name } }), `${name} added`)) reload();
  }

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_380px]">
      <div className="flex min-h-0 flex-col gap-4 overflow-auto p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-2">
          {menu?.map((c) => (
            <button key={c.id} onClick={() => { setCat(c.id); setSel(null); }}
              className={cn("rounded-xl px-3.5 py-2 text-sm font-medium", active === c.id ? "bg-foreground text-background" : "bg-card text-[#5d5a53] ring-1 ring-border")}>
              {c.name} <span className="opacity-60">{c.items.length}</span>
            </button>
          ))}
          {edit && <button onClick={addCategory} className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">+ Category</button>}
          {edit && (
            <button onClick={() => setImporting(true)}
              className="ml-auto flex items-center gap-1.5 rounded-xl bg-card px-3.5 py-2 text-sm font-medium ring-1 ring-border">
              <ScanText className="size-4" />Import
            </button>
          )}
          {edit && active && (
            <button onClick={() => setSel({ id: "", category_id: active, name: "", price: 0, is_veg: true, station: "Curry", available: true, modifiers: [] })}
              className="flex items-center gap-1.5 rounded-xl bg-foreground px-3.5 py-2 text-sm font-medium text-background">
              <Plus className="size-4" />New item
            </button>
          )}
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid grid-cols-[1fr_90px_90px_60px] gap-3 border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <span>Item</span><span>Price</span><span>Station</span><span>Live</span>
          </div>
          {cur?.items.map((m) => (
            <div key={m.id} onClick={() => setSel({ ...m })} role="button"
              className={cn("grid cursor-pointer grid-cols-[1fr_90px_90px_60px] items-center gap-3 border-b border-border/60 px-5 py-3.5 last:border-0 hover:bg-muted/40", sel?.id === m.id && "bg-accent/60")}>
              <span className="flex items-center gap-2.5 font-medium"><VegDot veg={m.is_veg} />{m.name}
                {m.modifiers.length > 0 && <span className="rounded bg-accent px-1.5 text-[11px] font-medium text-accent-foreground">{m.modifiers.length} option set{m.modifiers.length > 1 ? "s" : ""}</span>}</span>
              <span className="font-mono text-sm">{fmt(m.price)}</span>
              <span className="text-sm text-muted-foreground">{m.station}</span>
              <button onClick={(e) => { e.stopPropagation(); toggle(m); }} aria-label="Toggle availability"
                className={cn("relative h-6 w-10 rounded-full transition", m.available ? "bg-leaf" : "bg-[#d6d2ca]")}>
                <span className={cn("absolute top-[3px] size-[18px] rounded-full bg-white shadow transition-all", m.available ? "left-[19px]" : "left-[3px]")} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <MenuImport open={importing} onOpenChange={setImporting} onDone={reload} />
      {options && <ModifierEditor item={options} onClose={() => setOptions(null)} onSaved={(m) => { setOptions(null); setSel(m); reload(); }} />}
      <aside className={cn("border-t border-border bg-card p-6 lg:border-l lg:border-t-0", !sel && "hidden lg:block")}>
        {!sel ? (
          <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">Select an item to edit its price, station and availability.</div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{sel.id ? "Edit item" : "New item"}</div>
              <button onClick={() => setSel(null)}><X className="size-5 text-muted-foreground" /></button>
            </div>
            <fieldset disabled={!edit} className="space-y-5">
              <div className="space-y-2"><Label>Name</Label><Input value={sel.name} onChange={(e) => setSel({ ...sel, name: e.target.value })} className="h-10" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Price ({s.tenant?.currency})</Label>
                  <Input type="number" step="0.01" min={0} value={sel.price} onChange={(e) => setSel({ ...sel, price: Number(e.target.value) })} className="h-10 font-mono" /></div>
                <div className="space-y-2"><Label>Category</Label>
                  <NativeSelect value={sel.category_id} onChange={(e) => setSel({ ...sel, category_id: e.target.value })}>
                    {menu?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </NativeSelect></div>
              </div>
              <div className="space-y-2">
                <Label>Kitchen station</Label>
                <div className="flex flex-wrap gap-2">
                  {STATIONS.map((st) => (
                    <button type="button" key={st} onClick={() => setSel({ ...sel, station: st })}
                      className={cn("rounded-lg px-3 py-1.5 text-sm ring-1 ring-border", sel.station === st ? "bg-foreground text-background" : "bg-card")}>{st}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                {[true, false].map((v) => (
                  <button type="button" key={String(v)} onClick={() => setSel({ ...sel, is_veg: v })}
                    className={cn("flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm ring-1 ring-border", sel.is_veg === v ? "bg-foreground text-background" : "bg-card")}>
                    <VegDot veg={v} />{v ? "Veg" : "Non-veg"}
                  </button>
                ))}
              </div>
            </fieldset>
            {sel.id && (
              <div className="space-y-2 rounded-2xl bg-muted/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Options & add-ons</span>
                  {edit && <button onClick={() => setOptions(sel)} className="flex items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-sm font-medium ring-1 ring-border"><ListPlus className="size-4" />Edit</button>}
                </div>
                {sel.modifiers.length === 0 ? <p className="text-sm text-muted-foreground">None. Add sizes, spice levels or extras that staff pick when ordering.</p> : (
                  sel.modifiers.map((g) => (
                    <div key={g.id} className="text-sm">
                      <span className="font-medium">{g.name}</span> <span className="text-muted-foreground">· {g.min ? "required" : "optional"}{g.max ? `, up to ${g.max}` : ""}</span>
                      <div className="text-muted-foreground">{g.options.map((o) => o.price ? `${o.name} +${fmt(o.price)}` : o.name).join(" · ")}</div>
                    </div>
                  ))
                )}
              </div>
            )}
            {edit ? (
              <div className="flex gap-2 pt-2">
                {sel.id && <button onClick={remove} className="grid size-11 place-items-center rounded-xl bg-destructive/10 text-destructive"><Trash2 className="size-4" /></button>}
                <button onClick={save} disabled={!sel.name} className="h-11 flex-1 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">
                  {sel.id ? "Save & publish" : "Add to menu"}
                </button>
              </div>
            ) : <p className="text-sm text-muted-foreground">View only for your role. Ask a manager to change prices or stock.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ---------------- Staff ---------------- */

interface StaffRow { id: string; name: string; email: string | null; role: string; is_active: boolean; has_pin: boolean }

const ROLE_INFO: Record<string, string> = {
  owner: "Everything, including roles and settings",
  manager: "Service, reports, menu and staff",
  cashier: "Floor, orders, payments, online orders",
  captain: "Floor and orders (requests bills)",
  chef: "Kitchen display and menu view",
};

export function Staff() {
  const { s } = usePos();
  const { data: staff, reload } = usePoll<StaffRow[]>("/staff", 0);
  const [form, setForm] = useState({ name: "", role: "captain", pin: "" });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await run(api("/staff", { body: form }), `${form.name} added · PIN ${form.pin}`)) {
      setForm({ name: "", role: "captain", pin: "" });
      reload();
    }
  }
  async function setPin(u: StaffRow) {
    const pin = prompt(`New 4-digit PIN for ${u.name}`);
    if (pin && /^\d{4}$/.test(pin) && await run(api(`/staff/${u.id}`, { method: "PATCH", body: { pin } }), "PIN updated")) reload();
  }
  async function toggleActive(u: StaffRow) {
    if (await run(api(`/staff/${u.id}`, { method: "PATCH", body: { is_active: !u.is_active } }), u.is_active ? `${u.name} deactivated` : `${u.name} reactivated`)) reload();
  }

  return (
    <div className="grid h-full min-h-0 gap-5 overflow-auto p-5 md:p-7 lg:grid-cols-[1fr_360px]">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {staff?.map((u) => (
          <div key={u.id} className={cn("flex items-center gap-4 border-b border-border/60 px-5 py-4 last:border-0", !u.is_active && "opacity-50")}>
            <span className="grid size-10 place-items-center rounded-full bg-muted text-sm font-semibold">{u.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{u.name} {u.id === s.user.id && <span className="text-xs text-muted-foreground">(you)</span>}</div>
              <div className="text-xs text-muted-foreground"><span className="capitalize">{u.role}</span> · {ROLE_INFO[u.role]}</div>
            </div>
            <span className={cn("hidden rounded-md px-2 py-0.5 text-xs sm:block", u.has_pin ? "bg-muted" : "bg-accent text-accent-foreground")}>{u.has_pin ? "PIN set" : "No PIN"}</span>
            {(u.role !== "owner" || u.id === s.user.id) && <button onClick={() => setPin(u)} className="text-sm font-medium hover:underline">PIN</button>}
            {u.role !== "owner" && <button onClick={() => toggleActive(u)} className="text-sm text-muted-foreground hover:text-foreground">{u.is_active ? "Deactivate" : "Activate"}</button>}
          </div>
        ))}
      </div>
      <form onSubmit={add} className="h-fit space-y-4 rounded-2xl border border-border bg-card p-5">
        <div className="font-semibold">Add staff</div>
        <div className="space-y-2"><Label>Name</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-10" /></div>
        <div className="space-y-2"><Label>Role</Label>
          <NativeSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {["manager", "cashier", "captain", "chef"].filter((r) => r !== "manager" || s.user.role === "owner").map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
          </NativeSelect>
          <p className="text-xs text-muted-foreground">{ROLE_INFO[form.role]}</p>
        </div>
        <div className="space-y-2"><Label>4-digit PIN</Label>
          <Input required inputMode="numeric" pattern="\d{4}" maxLength={4} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })} className="h-10 font-mono tracking-[0.5em]" /></div>
        <button className="h-11 w-full rounded-xl bg-foreground font-semibold text-background">Add to team</button>
      </form>
    </div>
  );
}

/* ---------------- Modifier editor ---------------- */

type DraftGroup = { name: string; required: boolean; max: number; options: { name: string; price: string }[] };

function ModifierEditor({ item, onClose, onSaved }: { item: MenuItem; onClose: () => void; onSaved: (m: MenuItem) => void }) {
  const { s } = usePos();
  const [groups, setGroups] = useState<DraftGroup[]>(item.modifiers.map((g: ModGroup) => ({
    name: g.name, required: g.min > 0, max: g.max, options: g.options.map((o) => ({ name: o.name, price: o.price ? String(o.price) : "" })),
  })));
  const upd = (i: number, p: Partial<DraftGroup>) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const updOpt = (i: number, k: number, p: Partial<DraftGroup["options"][number]>) =>
    upd(i, { options: groups[i].options.map((o, j) => (j === k ? { ...o, ...p } : o)) });

  async function save() {
    const body = {
      groups: groups.map((g) => ({
        name: g.name.trim(), min: g.required ? 1 : 0, max: g.max,
        options: g.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), price: Number(o.price) || 0 })),
      })).filter((g) => g.name && g.options.length),
    };
    const m = await run(api<MenuItem>(`/menu/items/${item.id}/modifiers`, { method: "PUT", body }), `Options saved for ${item.name}`);
    if (m) onSaved(m);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Options for {item.name}</DialogTitle>
          <DialogDescription>Group choices like Size or Spice level. Option prices are added to the item price ({s.tenant?.currency}).</DialogDescription>
        </DialogHeader>
        {groups.map((g, i) => (
          <div key={i} className="space-y-3 rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={g.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Group name, e.g. Size" className="h-10 min-w-40 flex-1 font-medium" maxLength={80} />
              <Seg value={g.required ? "req" : "opt"} onChange={(v) => upd(i, { required: v === "req" })} options={[["req", "Required"], ["opt", "Optional"]]} />
              <label className="flex items-center gap-2 text-sm text-muted-foreground">Max
                <Input type="number" min={0} max={20} value={g.max} onChange={(e) => upd(i, { max: Number(e.target.value) || 0 })} className="h-10 w-16" />
              </label>
              <button onClick={() => setGroups(groups.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-lg bg-destructive/10 text-destructive" aria-label="Remove group"><Trash2 className="size-4" /></button>
            </div>
            <p className="text-xs text-muted-foreground">{g.max === 1 ? "Staff pick exactly one." : g.max ? `Staff pick up to ${g.max}.` : "Staff pick as many as they like (max 0 = no limit)."}</p>
            {g.options.map((o, k) => (
              <div key={k} className="flex gap-2">
                <Input value={o.name} onChange={(e) => updOpt(i, k, { name: e.target.value })} placeholder="Option, e.g. Large" className="h-10 flex-1" maxLength={80} />
                <Input type="number" min={0} step="0.01" value={o.price} onChange={(e) => updOpt(i, k, { price: e.target.value })} placeholder="+ price" className="h-10 w-28 font-mono" />
                <button onClick={() => upd(i, { options: g.options.filter((_, j) => j !== k) })} className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted" aria-label="Remove option"><X className="size-4" /></button>
              </div>
            ))}
            <button onClick={() => upd(i, { options: [...g.options, { name: "", price: "" }] })} className="text-sm font-medium text-saffron-deep">+ Add option</button>
          </div>
        ))}
        <button onClick={() => setGroups([...groups, { name: "", required: false, max: 1, options: [{ name: "", price: "" }, { name: "", price: "" }] }])}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-border text-sm font-medium"><Plus className="size-4" />Add option group</button>
        <button onClick={save} className="h-12 rounded-xl bg-foreground font-semibold text-background">Save options</button>
      </DialogContent>
    </Dialog>
  );
}
