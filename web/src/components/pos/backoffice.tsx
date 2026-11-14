"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ListPlus, Plus, ScanText, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ALLERGEN_LABEL, NUTRIENTS, SUGGESTED_TAGS, allergenList } from "@/lib/menu";
import { api, can, hasModule } from "@/lib/api";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/auth-shell";
import { MenuImport } from "./menu-import";
import type { Category, MenuItem, ModGroup } from "./types";
import { Seg, VegDot, run, usePoll, usePos } from "./shared";

/* ---------------- Menu ---------------- */

const STATIONS = ["Curry", "Tandoor", "Fry", "Cold", "Bar", "Kitchen"];

const COURSE_LABEL: Record<string, string> = { drinks: "Drinks", starters: "Starters", mains: "Mains", sides: "Sides", desserts: "Desserts" };

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
    const body = {
      name: sel.name, price: sel.price, is_veg: sel.is_veg, station: sel.station, category_id: sel.category_id, available: sel.available,
      description: sel.description ?? "", tags: sel.tags ?? [], allergens: sel.allergens ?? [],
      nutrition: Object.fromEntries(Object.entries(sel.nutrition ?? {}).filter(([, v]) => v != null && !Number.isNaN(v))),
    };
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
        {cur && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Course type for {cur.name}</span>
            <select value={cur.phase_set ? cur.phase : ""} disabled={!edit}
              onChange={async (e) => {
                const phase = e.target.value;
                const r = await run(api<{ phase: string; phase_set: boolean }>(`/menu/categories/${cur.id}`, { method: "PATCH", body: { phase } }), "Course type saved");
                if (r) setData((d) => d && d.map((c) => (c.id === cur.id ? { ...c, phase: r.phase, phase_set: r.phase_set } : c)));
              }}
              className="h-9 rounded-lg border border-input bg-card px-2.5 text-sm">
              <option value="">Automatic ({COURSE_LABEL[cur.phase] ?? cur.phase})</option>
              {Object.entries(COURSE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">Used on the Floor timeline to show which course each table is on and when it will clear.</span>
          </div>
        )}
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid grid-cols-[1fr_90px_90px_60px] gap-3 border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <span>Item</span><span>Price</span><span>Station</span><span>Live</span>
          </div>
          {cur?.items.map((m) => (
            <div key={m.id} onClick={() => setSel({ ...m })} role="button"
              className={cn("grid cursor-pointer grid-cols-[1fr_90px_90px_60px] items-center gap-3 border-b border-border/60 px-5 py-3.5 last:border-0 hover:bg-muted/40", sel?.id === m.id && "bg-accent/60")}>
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-medium"><VegDot veg={m.is_veg} />{m.name}
                {m.modifiers.length > 0 && <span className="rounded bg-accent px-1.5 text-[11px] font-medium text-accent-foreground">{m.modifiers.length} option set{m.modifiers.length > 1 ? "s" : ""}</span>}
                {!!m.allergens?.length && <span title={`Contains ${allergenList(m.allergens)}`} className="rounded bg-chili/10 px-1.5 text-[11px] font-medium text-chili">{m.allergens.length} allergen{m.allergens.length > 1 ? "s" : ""}</span>}
                {m.tags?.slice(0, 2).map((t) => <span key={t} className="rounded bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{t}</span>)}</span>
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
              <GuestDetails item={sel} onChange={(p) => setSel({ ...sel, ...p })} />
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

/* ---------------- Guest details (description, tags, allergens, nutrition) ---------------- */

function GuestDetails({ item, onChange }: { item: MenuItem; onChange: (p: Partial<MenuItem>) => void }) {
  const [tag, setTag] = useState("");
  const tags = item.tags ?? [];
  const allergens = item.allergens ?? [];
  const addTag = (t: string) => {
    const v = t.trim();
    if (v && !tags.some((x) => x.toLowerCase() === v.toLowerCase()) && tags.length < 12) onChange({ tags: [...tags, v] });
    setTag("");
  };
  return (
    <div className="space-y-4 rounded-2xl bg-muted/60 p-4">
      <div>
        <div className="font-medium">Guest details</div>
        <p className="text-xs text-muted-foreground">Shown on the QR menu and to staff when they take the order.</p>
      </div>
      <div className="space-y-2"><Label>Description</Label>
        <Textarea value={item.description ?? ""} maxLength={600} rows={2} placeholder="Slow-cooked black lentils, butter, cream"
          onChange={(e) => onChange({ description: e.target.value })} className="bg-card" /></div>
      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button type="button" key={t} onClick={() => onChange({ tags: tags.filter((x) => x !== t) })}
              className="flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background">{t}<X className="size-3" /></button>
          ))}
          {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).slice(0, 6).map((t) => (
            <button type="button" key={t} onClick={() => addTag(t)} className="rounded-full bg-card px-2.5 py-1 text-xs ring-1 ring-border">+ {t}</button>
          ))}
        </div>
        <Input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={30} placeholder="Add a tag, e.g. South Indian"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(tag); } }} onBlur={() => tag && addTag(tag)} className="h-9 bg-card" />
      </div>
      <div className="space-y-2">
        <Label>Allergens</Label>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(ALLERGEN_LABEL).map(([k, l]) => {
            const on = allergens.includes(k);
            return (
              <button type="button" key={k} onClick={() => onChange({ allergens: on ? allergens.filter((x) => x !== k) : [...allergens, k] })}
                className={cn("rounded-full px-2.5 py-1 text-xs ring-1", on ? "bg-chili text-white ring-chili" : "bg-card ring-border")}>{l}</button>
            );
          })}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Nutrition per serving</Label>
        <div className="grid grid-cols-4 gap-2">
          {NUTRIENTS.map(({ k, l, unit }) => (
            <label key={k} className="space-y-1 text-[11px] text-muted-foreground">{l} ({unit})
              <Input type="number" min={0} step="0.1" value={item.nutrition?.[k] ?? ""} className="h-9 bg-card font-mono text-sm"
                onChange={(e) => onChange({ nutrition: { ...item.nutrition, [k]: e.target.value === "" ? undefined : Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Staff ---------------- */

interface StaffRow { id: string; name: string; email: string | null; role: string; is_active: boolean; has_pin: boolean ; hourly_rate?: number }

const ROLE_INFO: Record<string, string> = {
  owner: "Everything, including roles and settings",
  manager: "Service, reports, menu and staff",
  cashier: "Floor, orders, payments, online orders",
  captain: "Floor and orders (requests bills)",
  chef: "Kitchen display and menu view",
};

export function Staff() {
  const { s, fmt } = usePos();
  const { data: staff, reload } = usePoll<StaffRow[]>("/staff", 0);
  const [form, setForm] = useState({ name: "", role: "captain", pin: "", hourly_rate: "" });
  const pay = hasModule(s.tenant, "timeclock") && can(s.user, "timesheets");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: form.name, role: form.role, pin: form.pin, ...(pay && form.hourly_rate ? { hourly_rate: Number(form.hourly_rate) } : {}) };
    if (await run(api("/staff", { body }), `${form.name} added · PIN ${form.pin}`)) {
      setForm({ name: "", role: "captain", pin: "", hourly_rate: "" });
      reload();
    }
  }
  async function setPin(u: StaffRow) {
    const pin = prompt(`New 4-digit PIN for ${u.name}`);
    if (pin && /^\d{4}$/.test(pin) && await run(api(`/staff/${u.id}`, { method: "PATCH", body: { pin } }), "PIN updated")) reload();
  }
  async function setRate(u: StaffRow, v: string) {
    const rate = Number(v);
    if (v === "" || Number.isNaN(rate) || rate === (u.hourly_rate ?? 0)) return;
    if (await run(api(`/staff/${u.id}`, { method: "PATCH", body: { hourly_rate: rate } }), `${u.name}: ${fmt(rate)} an hour`)) reload();
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
            {pay && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Hourly rate, used for labour cost on timesheets">
                <Input type="number" min={0} step="0.01" defaultValue={u.hourly_rate || ""} placeholder="Rate" onBlur={(e) => setRate(u, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="h-8 w-20 font-mono text-sm" />/h
              </label>
            )}
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
        {pay && <div className="space-y-2"><Label>Hourly rate (optional)</Label><Input type="number" min={0} step="0.01" value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} className="h-10 font-mono" /></div>}
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
