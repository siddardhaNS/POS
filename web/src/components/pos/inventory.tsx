"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, History, PackagePlus, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, Seg, run, usePoll, usePos } from "./shared";

/* ---------- Types (mirror api/app/routers/inventory.py) ---------- */

interface Stock {
  id: string; name: string; category: string; unit: string; on_hand: number; par_level: number; cost: number; value: number;
  low: boolean; out: boolean; supplier_id: string | null; supplier: string; active: boolean; recipes: number; is_prep?: boolean;
}
interface StockList { items: Stock[]; value: number; low: number; auto_86: boolean }
interface Move { id: string; kind: string; qty: number; unit: string; cost: number; value: number; reason: string; user: string; created_at: string }
interface RLine { stock_item_id: string; qty: number; unit: string; modifier_group: string; modifier_option: string; stock_item?: string; cost?: number }
interface Recipe {
  menu_item_id: string; name: string; category: string; price: number; cost: number; food_cost_pct: number;
  lines: RLine[]; option_lines: RLine[]; modifiers: { group: string; options: string[] }[];
}
interface Supplier { id: string; name: string; phone: string; email: string; notes: string; active: boolean; payment_terms_days?: number; gstin?: string }
interface POLine { id: string; stock_item_id: string; stock_item: string; unit: string; qty: number; cost: number; received_qty: number; total: number }
interface PO { id: string; number: number; supplier_id: string | null; supplier: string; status: string; expected_on: string | null; note: string; lines: POLine[]; total: number; created_at: string; received_at: string | null }
interface Count { id: string; note: string; user: string; variance_value: number; created_at: string; lines: { name: string; unit: string; expected: number; counted: number; variance: number; value: number }[] }
interface Report {
  net_sales: number; cost_of_sales: number; food_cost_pct: number; waste_value: number; received_value: number; count_variance_value: number; stock_value: number;
  items: { stock_item_id: string; name: string; unit: string; used: number; used_value: number; waste: number; waste_value: number; received: number; received_value: number }[];
  waste_reasons: { reason: string; count: number; value: number }[];
}

/** Units of the same kind can be mixed (a recipe in g for stock kept in kg). Mirrors app/stock.py. */
const UNITS: Record<string, string[]> = { weight: ["g", "kg", "oz", "lb"], volume: ["ml", "l", "fl oz"], count: ["pc", "dozen"] };
const kindOf = (u: string) => Object.keys(UNITS).find((k) => UNITS[k].includes(u)) ?? "count";
const sameKind = (u: string) => UNITS[kindOf(u)];
const ALL_UNITS = Object.values(UNITS).flat();
const n3 = (v: number) => (Math.round(v * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });

const PO_TONE: Record<string, string> = { draft: "bg-muted text-muted-foreground", sent: "bg-sky/15 text-sky", received: "bg-leaf/15 text-[oklch(0.45_0.12_150)]", cancelled: "bg-muted text-muted-foreground" };
const KIND_LABEL: Record<string, string> = { received: "Received", sale: "Sold", waste: "Waste", adjust: "Adjusted", count: "Count", transfer_in: "Transfer in", transfer_out: "Transfer out", produced: "Made in-house", prep_use: "Used in a preparation" };

type Tab = "stock" | "recipes" | "orders" | "bills" | "transfers" | "suppliers" | "count" | "report";

export function InventoryScreen() {
  const { s } = usePos();
  const manage = can(s.user, "inventory");
  const [tab, setTab] = useState<Tab>("stock");
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5 md:p-7">
      {manage && (
        <div className="shrink-0 overflow-x-auto">
          <Seg value={tab} onChange={setTab} options={[["stock", "Stock"], ["recipes", "Recipes & food cost"], ["orders", "Purchase orders"], ["bills", "Bills & payables"], ...(s.tenant?.brand_id ? [["transfers", "Transfers"] as [Tab, string]] : []), ["suppliers", "Suppliers"], ["count", "Stock count"], ["report", "Reports"]]} />
        </div>
      )}
      {(tab === "stock" || !manage) && <StockTab manage={manage} />}
      {manage && tab === "recipes" && <RecipesTab />}
      {manage && tab === "orders" && <OrdersTab />}
      {manage && tab === "bills" && <BillsTab />}
      {manage && tab === "transfers" && <TransfersTab />}
      {manage && tab === "suppliers" && <SuppliersTab />}
      {manage && tab === "count" && <CountTab />}
      {manage && tab === "report" && <ReportTab />}
    </div>
  );
}

/* ---------- Shared bits ---------- */

const sel = "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div className="min-w-0 space-y-2"><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

function Btn({ children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...p} className={cn("flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-sm font-medium disabled:opacity-40", className)}>{children}</button>;
}

function Primary({ children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...p} className={cn("flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-40", className)}>{children}</button>;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-2xl border border-border bg-card", className)}>{children}</div>;
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

/* ---------- Stock ---------- */

function StockTab({ manage }: { manage: boolean }) {
  const { fmt } = usePos();
  const { data, reload } = usePoll<StockList>("/inventory/items", 30000, "inventory");
  const { data: suppliers } = usePoll<Supplier[]>(manage ? "/inventory/suppliers" : null, 0, "inventory");
  const [q, setQ] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [edit, setEdit] = useState<Stock | "new" | null>(null);
  const [mv, setMv] = useState<{ item: Stock; kind: "received" | "waste" | "adjust" } | null>(null);
  const [hist, setHist] = useState<Stock | null>(null);
  const [prep, setPrep] = useState<Stock | null>(null);

  const rows = (data?.items ?? []).filter((i) => (!onlyLow || i.low) && (!q || `${i.name} ${i.category}`.toLowerCase().includes(q.toLowerCase())));
  async function auto86(v: boolean) {
    if (await run(api("/inventory/settings", { method: "PUT", body: { auto_86: v } }), v ? "Dishes now sell out when an ingredient runs out" : "Auto sold-out turned off")) reload();
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Stock value" value={fmt(data?.value ?? 0)} sub="On hand × average cost" />
        <Tile label="Low or out" value={String(data?.low ?? 0)} sub="At or below the reorder level" warn={!!data?.low} />
        {manage && (
          <button onClick={() => data && auto86(!data.auto_86)} className="col-span-2 flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 text-left">
            <span><span className="block font-medium">Sell out dishes automatically</span><span className="text-sm text-muted-foreground">Mark a dish unavailable when an ingredient in its recipe runs out, and bring it back when restocked.</span></span>
            <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition", data?.auto_86 ? "bg-leaf" : "bg-[#d6d2ca]")}><span className={cn("absolute top-1 size-5 rounded-full bg-white shadow transition-all", data?.auto_86 ? "left-6" : "left-1")} /></span>
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stock" className="h-10 w-56 bg-card" />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} className="size-4 accent-foreground" />Low stock only</label>
        {manage && <Primary className="ml-auto" onClick={() => setEdit("new")}><Plus className="size-4" />Add stock item</Primary>}
      </div>
      <Card>
        {!data ? <Empty>Loading…</Empty> : !rows.length ? <Empty>{data.items.length ? "Nothing matches." : "No stock items yet. Add your ingredients and packaged goods, then give dishes their recipes."}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                {["Item", "On hand", "Reorder at", "Cost", "Value", ""].map((h, i) => <th key={i} className={cn("px-4 py-3 font-medium", i === 0 ? "text-left" : "text-right")}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">{i.name}
                        {i.is_prep && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Made here</span>}
                        {i.out ? <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold text-destructive">Out</span>
                          : i.low && <span className="rounded-md bg-saffron/20 px-1.5 py-0.5 text-[11px] font-semibold text-saffron-deep">Low</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{[i.category, i.supplier, i.recipes ? `in ${i.recipes} recipe${i.recipes === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className={cn("px-4 py-3 text-right font-mono tabular", i.low && "text-destructive")}>{n3(i.on_hand)} {i.unit}</td>
                    <td className="px-4 py-3 text-right font-mono tabular text-muted-foreground">{n3(i.par_level)} {i.unit}</td>
                    <td className="px-4 py-3 text-right font-mono tabular">{fmt(i.cost)}/{i.unit}</td>
                    <td className="px-4 py-3 text-right font-mono tabular">{fmt(i.value)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {i.is_prep && <Btn onClick={() => setPrep(i)} className="bg-saffron/20 text-saffron-deep">Make</Btn>}
                        {manage && !i.is_prep && <Btn onClick={() => setMv({ item: i, kind: "received" })}>Receive</Btn>}
                        {manage && !i.is_prep && <Btn onClick={() => setPrep(i)} title="Made in-house from other stock">Prep</Btn>}
                        <Btn onClick={() => setMv({ item: i, kind: "waste" })}>Waste</Btn>
                        {manage && <Btn onClick={() => setMv({ item: i, kind: "adjust" })}>Adjust</Btn>}
                        <Btn onClick={() => setHist(i)} title="History"><History className="size-4" /></Btn>
                        {manage && <Btn onClick={() => setEdit(i)}>Edit</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <ItemDialog item={edit === "new" ? null : edit} suppliers={suppliers ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {mv && <MoveDialog {...mv} onClose={() => setMv(null)} onSaved={() => { setMv(null); reload(); }} />}
      {hist && <HistoryDialog item={hist} onClose={() => setHist(null)} />}
      {prep && <PrepDialog item={prep} stock={data?.items ?? []} manage={manage} onClose={() => setPrep(null)} onSaved={reload} />}
    </>
  );
}

function ItemDialog({ item, suppliers, onClose, onSaved }: { item: Stock | null; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const { fmt } = usePos();
  const [f, setF] = useState({
    name: item?.name ?? "", category: item?.category ?? "", unit: item?.unit ?? "kg", par_level: String(item?.par_level ?? ""),
    cost: String(item?.cost ?? ""), on_hand: "", supplier_id: item?.supplier_id ?? "", active: item?.active ?? true,
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { name: f.name, category: f.category, unit: f.unit, par_level: Number(f.par_level) || 0, cost: Number(f.cost) || 0, supplier_id: f.supplier_id || null };
    const r = await run(item ? api(`/inventory/items/${item.id}`, { method: "PATCH", body: { ...body, active: f.active } })
      : api("/inventory/items", { body: { ...body, on_hand: Number(f.on_hand) || 0 } }), item ? "Saved" : "Stock item added");
    if (r) onSaved();
  }
  const units = item ? sameKind(item.unit) : ALL_UNITS;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{item ? `Edit ${item.name}` : "Add stock item"}</DialogTitle>
          <DialogDescription>An ingredient or packaged good you buy and keep on hand.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <Field label="Name"><Input required maxLength={160} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Basmati rice" className="h-11" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category"><Input maxLength={80} value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="e.g. Dry goods" className="h-11" /></Field>
            <Field label="Counted in" hint={item ? "Only units of the same kind" : undefined}>
              <select value={f.unit} onChange={(e) => set({ unit: e.target.value })} className={sel}>{units.map((u) => <option key={u}>{u}</option>)}</select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`Cost per ${f.unit}`} hint={item ? "Updates automatically as deliveries come in" : undefined}>
              <Input type="number" min={0} step="0.01" value={f.cost} onChange={(e) => set({ cost: e.target.value })} className="h-11 font-mono" /></Field>
            <Field label={`Reorder at (${f.unit})`}><Input type="number" min={0} step="0.001" value={f.par_level} onChange={(e) => set({ par_level: e.target.value })} className="h-11 font-mono" /></Field>
          </div>
          {!item && <Field label={`On hand now (${f.unit})`}><Input type="number" min={0} step="0.001" value={f.on_hand} onChange={(e) => set({ on_hand: e.target.value })} className="h-11 font-mono" /></Field>}
          <Field label="Usual supplier">
            <select value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })} className={sel}>
              <option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {item && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} className="size-4 accent-foreground" />Still in use</label>}
          {!item && Number(f.on_hand) > 0 && Number(f.cost) > 0 && <p className="text-xs text-muted-foreground">Opening value {fmt(Number(f.on_hand) * Number(f.cost))}</p>}
          <Primary type="submit" className="h-11 justify-center">{item ? "Save" : "Add stock item"}</Primary>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const WASTE_REASONS = ["Spoiled", "Expired", "Dropped", "Burnt / cooking error", "Returned by guest", "Staff meal"];

function MoveDialog({ item, kind, onClose, onSaved }: { item: Stock; kind: "received" | "waste" | "adjust"; onClose: () => void; onSaved: () => void }) {
  const { fmt } = usePos();
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState(item.unit);
  const [cost, setCost] = useState(String(item.cost || ""));
  const [reason, setReason] = useState(kind === "waste" ? WASTE_REASONS[0] : "");
  const title = { received: `Receive ${item.name}`, waste: `Record waste · ${item.name}`, adjust: `Adjust ${item.name}` }[kind];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { kind, qty: Number(qty), unit, reason, ...(kind === "received" ? { cost: Number(cost) || 0 } : {}) };
    if (await run(api(`/inventory/items/${item.id}/movements`, { body }), kind === "received" ? "Stock received" : kind === "waste" ? "Waste recorded" : "Stock adjusted")) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>On hand now: {n3(item.on_hand)} {item.unit}</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label={kind === "adjust" ? "Change (use − to remove)" : "Quantity"}>
              <Input autoFocus required type="number" step="0.001" min={kind === "adjust" ? undefined : 0.001} value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 font-mono" /></Field>
            <Field label="Unit"><select value={unit} onChange={(e) => setUnit(e.target.value)} className={sel}>{sameKind(item.unit).map((u) => <option key={u}>{u}</option>)}</select></Field>
          </div>
          {kind === "received" && <Field label={`Cost per ${unit}`} hint={Number(qty) > 0 ? `Delivery value ${fmt(Number(qty) * (Number(cost) || 0))}` : undefined}>
            <Input type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="h-11 font-mono" /></Field>}
          {kind === "waste" ? (
            <Field label="Reason"><div className="flex flex-wrap gap-2">{WASTE_REASONS.map((r) => (
              <button type="button" key={r} onClick={() => setReason(r)} className={cn("h-9 rounded-lg px-3 text-sm ring-1", reason === r ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>{r}</button>
            ))}</div></Field>
          ) : (
            <Field label={kind === "adjust" ? "Reason" : "Note (optional)"}><Input required={kind === "adjust"} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "adjust" ? "e.g. found extra in the store room" : "e.g. invoice 1042"} className="h-11" /></Field>
          )}
          <Primary type="submit" className="h-11 justify-center">{kind === "received" ? "Receive" : kind === "waste" ? "Record waste" : "Adjust"}</Primary>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ item, onClose }: { item: Stock; onClose: () => void }) {
  const { fmt } = usePos();
  const { data } = usePoll<Move[]>(`/inventory/items/${item.id}/movements`, 0, "inventory");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{item.name}</DialogTitle><DialogDescription>Last 100 stock changes</DialogDescription></DialogHeader>
        {!data ? <Empty>Loading…</Empty> : !data.length ? <Empty>No changes yet.</Empty> : (
          <div className="divide-y divide-border text-sm">
            {data.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{KIND_LABEL[m.kind] ?? m.kind}{m.reason ? <span className="font-normal text-muted-foreground"> · {m.reason}</span> : null}</div>
                  <div className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}{m.user ? ` · ${m.user}` : ""}</div>
                </div>
                <div className={cn("text-right font-mono tabular", m.qty < 0 ? "text-destructive" : "text-[oklch(0.45_0.12_150)]")}>{m.qty > 0 ? "+" : ""}{n3(m.qty)} {m.unit}<div className="text-xs text-muted-foreground">{fmt(Math.abs(m.value))}</div></div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Recipes ---------- */

function RecipesTab() {
  const { fmt } = usePos();
  const { data, reload } = usePoll<Recipe[]>("/inventory/recipes", 0, ["inventory", "menu"]);
  const { data: stock } = usePoll<StockList>("/inventory/items", 0, "inventory");
  const [open, setOpen] = useState<Recipe | null>(null);
  const [q, setQ] = useState("");
  const rows = (data ?? []).filter((r) => !q || `${r.name} ${r.category}`.toLowerCase().includes(q.toLowerCase()));
  const withRecipe = (data ?? []).filter((r) => r.lines.length);
  const avg = withRecipe.length ? withRecipe.reduce((a, r) => a + r.food_cost_pct, 0) / withRecipe.length : 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Dishes with a recipe" value={`${withRecipe.length} / ${data?.length ?? 0}`} sub="Only these deduct stock when sold" />
        <Tile label="Average food cost" value={`${avg.toFixed(1)}%`} sub="Of menu price, dishes with a recipe" warn={avg > 35} />
      </div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes" className="h-10 w-56 bg-card" />
      <Card>
        {!data ? <Empty>Loading…</Empty> : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <button key={r.menu_item_id} onClick={() => setOpen(r)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-muted/50">
                <div className="min-w-0 flex-1"><div className="font-medium">{r.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.category} · {r.lines.length ? r.lines.map((l) => l.stock_item).join(", ") : "No recipe yet"}</div></div>
                <div className="text-right font-mono text-sm tabular"><div>{r.lines.length ? <>{fmt(r.cost)} <span className="text-muted-foreground">/ {fmt(r.price)}</span></> : <span className="text-muted-foreground">{fmt(r.price)}</span>}</div>
                  {r.lines.length > 0 && <div className={cn("text-xs", r.food_cost_pct > 35 ? "text-destructive" : "text-muted-foreground")}>{r.food_cost_pct}% food cost</div>}</div>
              </button>
            ))}
          </div>
        )}
      </Card>
      {open && stock && <RecipeDialog recipe={open} stock={stock.items} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function RecipeDialog({ recipe, stock, onClose, onSaved }: { recipe: Recipe; stock: Stock[]; onClose: () => void; onSaved: () => void }) {
  const { fmt } = usePos();
  const byId = useMemo(() => new Map(stock.map((s) => [s.id, s])), [stock]);
  const toRow = (l: RLine) => ({ ...l, qty: String(l.qty) });
  const [lines, setLines] = useState(() => [...recipe.lines, ...recipe.option_lines].map(toRow));
  const options = recipe.modifiers.flatMap((g) => g.options.map((o) => ({ group: g.group, option: o })));
  const blank = (opt?: { group: string; option: string }) => {
    const s0 = stock[0];
    return { stock_item_id: s0?.id ?? "", qty: "", unit: s0 ? (kindOf(s0.unit) === "weight" ? "g" : kindOf(s0.unit) === "volume" ? "ml" : "pc") : "g", modifier_group: opt?.group ?? "", modifier_option: opt?.option ?? "" };
  };
  const upd = (i: number, p: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const costOf = (l: (typeof lines)[number]) => {
    const s = byId.get(l.stock_item_id);
    if (!s || !Number(l.qty)) return 0;
    const f: Record<string, number> = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592, ml: 1, l: 1000, "fl oz": 29.5735, pc: 1, dozen: 12 };
    return (Number(l.qty) * f[l.unit]) / f[s.unit] * s.cost;
  };
  const base = lines.filter((l) => !l.modifier_option);
  const cost = base.reduce((a, l) => a + costOf(l), 0);
  async function save() {
    const body = { lines: lines.filter((l) => l.stock_item_id && Number(l.qty) > 0).map((l) => ({ ...l, qty: Number(l.qty) })) };
    if (await run(api(`/inventory/recipes/${recipe.menu_item_id}`, { method: "PUT", body }), `Recipe saved for ${recipe.name}`)) onSaved();
  }
  const row = (l: (typeof lines)[number], i: number) => {
    const s = byId.get(l.stock_item_id);
    return (
      <div key={i} className="grid grid-cols-[1fr_5.5rem_5rem_auto] items-center gap-2">
        <select value={l.stock_item_id} onChange={(e) => { const ns = byId.get(e.target.value); upd(i, { stock_item_id: e.target.value, unit: ns && !sameKind(ns.unit).includes(l.unit) ? sameKind(ns.unit)[0] : l.unit }); }} className="h-10 min-w-0 rounded-lg border border-input bg-card px-2 text-sm">
          {stock.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <Input type="number" min={0} step="0.001" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} placeholder="Qty" className="h-10 font-mono" />
        <select value={l.unit} onChange={(e) => upd(i, { unit: e.target.value })} className="h-10 rounded-lg border border-input bg-card px-2 text-sm">
          {(s ? sameKind(s.unit) : ALL_UNITS).map((u) => <option key={u}>{u}</option>)}
        </select>
        <button type="button" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Trash2 className="size-4" /></button>
      </div>
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{recipe.name}</DialogTitle>
          <DialogDescription>What one serving uses. Sold at {fmt(recipe.price)} · costs {fmt(cost)} · {recipe.price ? ((cost / recipe.price) * 100).toFixed(1) : "0"}% food cost</DialogDescription></DialogHeader>
        {!stock.length ? <Empty>Add stock items first, in the Stock tab.</Empty> : (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <div className="text-sm font-medium">Every serving</div>
              {lines.map((l, i) => (!l.modifier_option ? row(l, i) : null))}
              <Btn className="w-fit" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="size-4" />Add ingredient</Btn>
            </div>
            {!!options.length && (
              <div className="grid gap-2">
                <div className="text-sm font-medium">Only when a choice is picked</div>
                {lines.map((l, i) => (l.modifier_option ? (
                  <div key={i} className="grid gap-1.5 rounded-xl bg-muted/50 p-2.5">
                    <select value={`${l.modifier_group}|${l.modifier_option}`} onChange={(e) => { const [g, o] = e.target.value.split("|"); upd(i, { modifier_group: g, modifier_option: o }); }} className="h-9 rounded-lg border border-input bg-card px-2 text-sm">
                      {options.map((o) => <option key={`${o.group}|${o.option}`} value={`${o.group}|${o.option}`}>{o.group}: {o.option}</option>)}
                    </select>
                    {row(l, i)}
                  </div>
                ) : null))}
                <Btn className="w-fit" onClick={() => setLines((ls) => [...ls, blank(options[0])])}><Plus className="size-4" />Add ingredient for a choice</Btn>
              </div>
            )}
            <Primary onClick={save} className="h-11 justify-center">Save recipe</Primary>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Purchase orders ---------- */

function OrdersTab() {
  const { fmt } = usePos();
  const { data, reload } = usePoll<PO[]>("/inventory/purchase-orders", 30000, "inventory");
  const { data: stock } = usePoll<StockList>("/inventory/items", 0, "inventory");
  const { data: suppliers } = usePoll<Supplier[]>("/inventory/suppliers", 0, "inventory");
  const [edit, setEdit] = useState<PO | "new" | null>(null);
  const [recv, setRecv] = useState<PO | null>(null);
  async function billFromPo(po: PO) {
    await run(api(`/inventory/purchase-orders/${po.id}/bill`, { method: "POST" }), `Bill entered for PO #${po.number}. Add the supplier's bill number under Bills.`);
  }
  async function status(po: PO, st: "sent" | "cancelled") {
    if (st === "cancelled" && !confirm(`Cancel purchase order #${po.number}?`)) return;
    if (await run(api(`/inventory/purchase-orders/${po.id}/status`, { body: { status: st } }), st === "sent" ? "Marked as sent" : "Cancelled")) reload();
  }
  return (
    <>
      <div className="flex"><Primary className="ml-auto" onClick={() => setEdit("new")} disabled={!stock?.items.length}><PackagePlus className="size-4" />New purchase order</Primary></div>
      <Card>
        {!data ? <Empty>Loading…</Empty> : !data.length ? <Empty>No purchase orders yet. Create one to order stock from a supplier, then receive it when it arrives.</Empty> : (
          <div className="divide-y divide-border">
            {data.map((po) => (
              <div key={po.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">#{po.number} · {po.supplier || "No supplier"}<span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold capitalize", PO_TONE[po.status])}>{po.status}</span></div>
                  <div className="truncate text-xs text-muted-foreground">{po.lines.map((l) => `${n3(l.qty)} ${l.unit} ${l.stock_item}`).join(", ")}{po.expected_on ? ` · due ${new Date(po.expected_on + "T00:00").toLocaleDateString()}` : ""}</div>
                </div>
                <div className="font-mono text-sm tabular">{fmt(po.total)}</div>
                {po.status === "received" && po.supplier_id && <Btn onClick={() => billFromPo(po)}>Enter bill</Btn>}
                {(po.status === "draft" || po.status === "sent") && (
                  <div className="flex gap-1.5">
                    {po.status === "draft" && <Btn onClick={() => status(po, "sent")}>Mark sent</Btn>}
                    <Btn onClick={() => setRecv(po)} className="bg-foreground text-background">Receive</Btn>
                    <Btn onClick={() => setEdit(po)}>Edit</Btn>
                    <Btn onClick={() => status(po, "cancelled")}>Cancel</Btn>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {edit && stock && <PODialog po={edit === "new" ? null : edit} stock={stock.items} suppliers={suppliers ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {recv && <ReceiveDialog po={recv} onClose={() => setRecv(null)} onSaved={() => { setRecv(null); reload(); }} />}
    </>
  );
}

function PODialog({ po, stock, suppliers, onClose, onSaved }: { po: PO | null; stock: Stock[]; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const { fmt } = usePos();
  const active = stock.filter((s) => s.active);
  const byId = new Map(stock.map((s) => [s.id, s]));
  const [supplier, setSupplier] = useState(po?.supplier_id ?? "");
  const [expected, setExpected] = useState(po?.expected_on ?? "");
  const [note, setNote] = useState(po?.note ?? "");
  const [lines, setLines] = useState(() => po?.lines.map((l) => ({ stock_item_id: l.stock_item_id, qty: String(l.qty), cost: String(l.cost) })) ?? []);
  const upd = (i: number, p: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const add = (s: Stock, qty = "") => setLines((ls) => [...ls, { stock_item_id: s.id, qty, cost: String(s.cost || "") }]);
  function addLow() {
    const have = new Set(lines.map((l) => l.stock_item_id));
    const low = active.filter((s) => s.low && !have.has(s.id) && (!supplier || !s.supplier_id || s.supplier_id === supplier));
    if (!low.length) return toast.info("No other low-stock items" + (supplier ? " for this supplier" : ""));
    low.forEach((s) => add(s, String(Math.max(0, Math.round((s.par_level * 2 - s.on_hand) * 1000) / 1000) || 1)));
  }
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);
  async function save() {
    const body = { supplier_id: supplier || null, expected_on: expected || null, note, lines: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty), cost: Number(l.cost) || 0 })) };
    if (!body.lines.length) return toast.error("Add at least one item");
    if (await run(po ? api(`/inventory/purchase-orders/${po.id}`, { method: "PUT", body }) : api("/inventory/purchase-orders", { body }), po ? "Purchase order saved" : "Purchase order created")) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{po ? `Purchase order #${po.number}` : "New purchase order"}</DialogTitle><DialogDescription>Total {fmt(total)}</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier"><select value={supplier} onChange={(e) => setSupplier(e.target.value)} className={sel}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Expected on"><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className="h-11" /></Field>
          </div>
          <div className="grid gap-2">
            {lines.map((l, i) => {
              const s = byId.get(l.stock_item_id);
              return (
                <div key={i} className="grid grid-cols-[1fr_6rem_6.5rem_auto] items-center gap-2">
                  <select value={l.stock_item_id} onChange={(e) => upd(i, { stock_item_id: e.target.value })} className="h-10 min-w-0 rounded-lg border border-input bg-card px-2 text-sm">
                    {active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <div className="relative"><Input type="number" min={0} step="0.001" value={l.qty} onChange={(e) => upd(i, { qty: e.target.value })} placeholder="Qty" className="h-10 pr-9 font-mono" /><span className="pointer-events-none absolute right-2 top-2.5 text-xs text-muted-foreground">{s?.unit}</span></div>
                  <Input type="number" min={0} step="0.01" value={l.cost} onChange={(e) => upd(i, { cost: e.target.value })} placeholder={`Cost/${s?.unit ?? ""}`} className="h-10 font-mono" />
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Trash2 className="size-4" /></button>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <Btn onClick={() => active[0] && add(active[0])}><Plus className="size-4" />Add item</Btn>
              <Btn onClick={addLow}><AlertTriangle className="size-4" />Add low-stock items</Btn>
            </div>
          </div>
          <Field label="Note"><Input maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="h-11" /></Field>
          <Primary onClick={save} className="h-11 justify-center">{po ? "Save" : "Create purchase order"}</Primary>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ po, onClose, onSaved }: { po: PO; onClose: () => void; onSaved: () => void }) {
  const { fmt } = usePos();
  const [rows, setRows] = useState(() => po.lines.map((l) => ({ line_id: l.id, qty: String(l.qty), cost: String(l.cost) })));
  const upd = (i: number, p: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const total = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.cost) || 0), 0);
  async function save() {
    const body = { lines: rows.map((r) => ({ line_id: r.line_id, qty: Number(r.qty) || 0, cost: Number(r.cost) || 0 })) };
    if (await run(api(`/inventory/purchase-orders/${po.id}/receive`, { body }), `Purchase order #${po.number} received`)) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Receive #{po.number}{po.supplier ? ` · ${po.supplier}` : ""}</DialogTitle>
          <DialogDescription>Change any quantity or price that doesn&apos;t match what arrived. Delivery value {fmt(total)}.</DialogDescription></DialogHeader>
        <div className="grid gap-2">
          <div className="grid grid-cols-[1fr_6.5rem_6.5rem] gap-2 text-xs text-muted-foreground"><span>Item</span><span>Arrived</span><span>Cost per unit</span></div>
          {po.lines.map((l, i) => (
            <div key={l.id} className="grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-2">
              <span className="min-w-0 truncate text-sm">{l.stock_item}<span className="block text-xs text-muted-foreground">ordered {n3(l.qty)} {l.unit}</span></span>
              <Input type="number" min={0} step="0.001" value={rows[i].qty} onChange={(e) => upd(i, { qty: e.target.value })} className="h-10 font-mono" />
              <Input type="number" min={0} step="0.01" value={rows[i].cost} onChange={(e) => upd(i, { cost: e.target.value })} className="h-10 font-mono" />
            </div>
          ))}
          <Primary onClick={save} className="mt-2 h-11 justify-center">Receive into stock</Primary>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Suppliers ---------- */

function SuppliersTab() {
  const { data, reload } = usePoll<Supplier[]>("/inventory/suppliers", 0, "inventory");
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);
  return (
    <>
      <div className="flex"><Primary className="ml-auto" onClick={() => setEdit("new")}><Plus className="size-4" />Add supplier</Primary></div>
      <Card>
        {!data ? <Empty>Loading…</Empty> : !data.length ? <Empty>No suppliers yet.</Empty> : (
          <div className="divide-y divide-border">
            {data.map((s) => (
              <button key={s.id} onClick={() => setEdit(s)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50", !s.active && "opacity-50")}>
                <div className="min-w-0 flex-1"><div className="font-medium">{s.name}</div><div className="truncate text-xs text-muted-foreground">{[s.phone, s.email, s.notes].filter(Boolean).join(" · ") || "No contact details"}</div></div>
              </button>
            ))}
          </div>
        )}
      </Card>
      {edit && <SupplierDialog s={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function SupplierDialog({ s, onClose, onSaved }: { s: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: s?.name ?? "", phone: s?.phone ?? "", email: s?.email ?? "", notes: s?.notes ?? "", active: s?.active ?? true, payment_terms_days: s?.payment_terms_days ?? 15, gstin: s?.gstin ?? "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await run(s ? api(`/inventory/suppliers/${s.id}`, { method: "PUT", body: f }) : api("/inventory/suppliers", { body: f }), s ? "Supplier saved" : "Supplier added")) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{s ? s.name : "Add supplier"}</DialogTitle><DialogDescription>Who you buy stock from.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <Field label="Name"><Input required maxLength={160} value={f.name} onChange={(e) => set({ name: e.target.value })} className="h-11" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone"><Input type="tel" maxLength={40} value={f.phone} onChange={(e) => set({ phone: e.target.value })} className="h-11" /></Field>
            <Field label="Email"><Input type="email" maxLength={200} value={f.email} onChange={(e) => set({ email: e.target.value })} className="h-11" /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pay within (days)" hint="Bills are due this long after their date"><Input type="number" min={0} max={365} value={f.payment_terms_days} onChange={(e) => set({ payment_terms_days: Number(e.target.value) || 0 })} className="h-11 font-mono" /></Field>
            <Field label="GSTIN / tax ID"><Input maxLength={15} value={f.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} className="h-11 font-mono" /></Field>
          </div>
          <Field label="Notes"><Input maxLength={2000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. delivers Tue and Fri, order by 6 pm" className="h-11" /></Field>
          {s && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} className="size-4 accent-foreground" />Still buying from them</label>}
          <Primary type="submit" className="h-11 justify-center">{s ? "Save" : "Add supplier"}</Primary>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Stock count ---------- */

function CountTab() {
  const { fmt } = usePos();
  const { data, reload } = usePoll<StockList>("/inventory/items", 0);
  const { data: past, reload: reloadPast } = usePoll<Count[]>("/inventory/counts", 0);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Count | null>(null);
  const items = (data?.items ?? []).filter((i) => i.active);
  const entered = items.filter((i) => counted[i.id] !== undefined && counted[i.id] !== "");
  const varianceValue = entered.reduce((a, i) => a + (Number(counted[i.id]) - i.on_hand) * i.cost, 0);
  async function submit() {
    if (!entered.length) return toast.error("Enter at least one counted quantity");
    if (!confirm(`Save the count for ${entered.length} item${entered.length === 1 ? "" : "s"}? Stock on hand will be set to what you counted.`)) return;
    setBusy(true);
    const r = await run(api<Count>("/inventory/counts", { body: { note, lines: entered.map((i) => ({ stock_item_id: i.id, counted: Number(counted[i.id]) })) } }), "Stock count saved");
    setBusy(false);
    if (r) { setCounted({}); setNote(""); reload(); reloadPast(); }
  }
  return (
    <>
      <Card>
        {!data ? <Empty>Loading…</Empty> : !items.length ? <Empty>No stock items to count.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                {["Item", "Expected", "Counted", "Difference", "Value"].map((h, i) => <th key={h} className={cn("px-4 py-3 font-medium", i === 0 ? "text-left" : "text-right")}>{h}</th>)}
              </tr></thead>
              <tbody>
                {items.map((i) => {
                  const has = counted[i.id] !== undefined && counted[i.id] !== "";
                  const diff = has ? Number(counted[i.id]) - i.on_hand : 0;
                  return (
                    <tr key={i.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5"><div className="font-medium">{i.name}</div><div className="text-xs text-muted-foreground">{i.category}</div></td>
                      <td className="px-4 py-2.5 text-right font-mono tabular text-muted-foreground">{n3(i.on_hand)} {i.unit}</td>
                      <td className="px-4 py-2.5 text-right"><div className="ml-auto flex w-36 items-center gap-1.5"><Input type="number" min={0} step="0.001" value={counted[i.id] ?? ""} onChange={(e) => setCounted((c) => ({ ...c, [i.id]: e.target.value }))} className="h-9 font-mono" /><span className="w-8 text-left text-xs text-muted-foreground">{i.unit}</span></div></td>
                      <td className={cn("px-4 py-2.5 text-right font-mono tabular", has && diff < 0 && "text-destructive", has && diff > 0 && "text-[oklch(0.45_0.12_150)]")}>{has ? `${diff > 0 ? "+" : ""}${n3(diff)}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular">{has ? fmt(diff * i.cost) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note, e.g. Sunday close" className="h-10 w-64 bg-card" />
        <span className="text-sm text-muted-foreground">{entered.length} counted · difference {fmt(varianceValue)}</span>
        <Primary className="ml-auto" onClick={submit} disabled={busy || !entered.length}>Save count</Primary>
      </div>
      {!!past?.length && (
        <Card>
          <div className="px-4 pt-4 font-semibold">Past counts</div>
          <div className="divide-y divide-border">
            {past.map((c) => (
              <button key={c.id} onClick={() => setOpen(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{new Date(c.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{c.note ? ` · ${c.note}` : ""}</div><div className="text-xs text-muted-foreground">{c.lines.length} items · {c.user}</div></div>
                <div className={cn("font-mono text-sm tabular", c.variance_value < 0 && "text-destructive")}>{fmt(c.variance_value)}</div>
              </button>
            ))}
          </div>
        </Card>
      )}
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader><DialogTitle>Stock count</DialogTitle><DialogDescription>{new Date(open.created_at).toLocaleString()} · {open.user} · difference {fmt(open.variance_value)}</DialogDescription></DialogHeader>
            <div className="divide-y divide-border text-sm">
              {open.lines.map((l) => (
                <div key={l.name} className="flex justify-between gap-3 py-2"><span>{l.name}</span><span className="font-mono tabular">{n3(l.expected)} → {n3(l.counted)} {l.unit} <span className={cn(l.variance < 0 && "text-destructive")}>({l.variance > 0 ? "+" : ""}{n3(l.variance)} · {fmt(l.value)})</span></span></div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/* ---------- Reports ---------- */

function ReportTab() {
  const { fmt } = usePos();
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const days = { "7d": 7, "30d": 30, "90d": 90 }[range];
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const d = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const { data } = usePoll<Report>(`/inventory/report?start=${d(start)}&end=${d(end)}`, 60000, ["inventory", "orders"]);
  return (
    <>
      <Seg value={range} onChange={setRange} options={[["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]]} />
      {!data ? <Card><Empty>Loading…</Empty></Card> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Food cost" value={`${data.food_cost_pct}%`} sub={`${fmt(data.cost_of_sales)} of ${fmt(data.net_sales)} net sales`} warn={data.food_cost_pct > 35} />
            <Tile label="Waste" value={fmt(data.waste_value)} sub={data.net_sales ? `${((data.waste_value / data.net_sales) * 100).toFixed(1)}% of net sales` : undefined} />
            <Tile label="Received" value={fmt(data.received_value)} sub="Deliveries in this period" />
            <Tile label="Count differences" value={fmt(data.count_variance_value)} sub={`Stock value now ${fmt(data.stock_value)}`} warn={data.count_variance_value < 0} />
          </div>
          <p className="text-xs text-muted-foreground">Food cost uses recipes: only dishes with a recipe count toward it.</p>
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Card className="p-5">
              <div className="mb-3 font-semibold">Usage by item</div>
              {!data.items.length ? <Empty>No stock movements in this period.</Empty> : (
                <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm">
                  <thead><tr className="border-b border-border text-xs text-muted-foreground">{["Item", "Used in sales", "Wasted", "Received"].map((h, i) => <th key={h} className={cn("pb-2 font-medium", i ? "text-right" : "text-left")}>{h}</th>)}</tr></thead>
                  <tbody>{data.items.map((r) => (
                    <tr key={r.stock_item_id} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 font-medium">{r.name}</td>
                      <td className="py-2.5 text-right font-mono tabular">{n3(r.used)} {r.unit}<div className="text-xs text-muted-foreground">{fmt(r.used_value)}</div></td>
                      <td className="py-2.5 text-right font-mono tabular">{r.waste ? <>{n3(r.waste)} {r.unit}<div className="text-xs text-muted-foreground">{fmt(r.waste_value)}</div></> : "—"}</td>
                      <td className="py-2.5 text-right font-mono tabular">{r.received ? <>{n3(r.received)} {r.unit}<div className="text-xs text-muted-foreground">{fmt(r.received_value)}</div></> : "—"}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
            <Card className="p-5">
              <div className="mb-3 font-semibold">Waste by reason</div>
              {!data.waste_reasons.length ? <Empty>No waste recorded.</Empty> : data.waste_reasons.map((w) => (
                <div key={w.reason} className="flex justify-between py-1.5 text-sm"><span className="text-muted-foreground">{w.reason} ({w.count})</span><span className="font-mono tabular">{fmt(w.value)}</span></div>
              ))}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Preparations (made in-house) ---------- */

interface Prep {
  is_prep: boolean; yield: number; unit: string; batch_cost: number; unit_cost: number;
  lines: { stock_item_id: string; stock_item: string; qty: number; unit: string; cost: number; on_hand: number; stock_unit: string }[];
}

function PrepDialog({ item, stock, manage, onClose, onSaved }: { item: Stock; stock: Stock[]; manage: boolean; onClose: () => void; onSaved: () => void }) {
  const { fmt } = usePos();
  const { data, setData } = usePoll<Prep>(`/inventory/items/${item.id}/prep`, 0);
  const [editing, setEditing] = useState(false);
  const [yieldQty, setYield] = useState("");
  const [lines, setLines] = useState<{ stock_item_id: string; qty: string; unit: string }[]>([]);
  const [made, setMade] = useState("");
  const others = stock.filter((s) => s.id !== item.id && s.active);
  const startEdit = (p: Prep) => {
    setYield(p.yield ? String(p.yield) : "");
    setLines(p.lines.length ? p.lines.map((l) => ({ stock_item_id: l.stock_item_id, qty: String(l.qty), unit: l.unit })) : [{ stock_item_id: "", qty: "", unit: "g" }]);
    setEditing(true);
  };
  const showEditor = editing || (data && !data.is_prep && manage);
  useEffect(() => {
    if (data && !data.is_prep && manage) { setYield(""); setLines([{ stock_item_id: "", qty: "", unit: "g" }]); setEditing(true); }
  }, [data, manage]);

  async function save() {
    const body = { is_prep: true, yield_qty: Number(yieldQty) || 0, lines: lines.filter((l) => l.stock_item_id && Number(l.qty) > 0).map((l) => ({ ...l, qty: Number(l.qty) })) };
    const r = await run(api<Prep>(`/inventory/items/${item.id}/prep`, { method: "PUT", body }), `${item.name} is made in-house`);
    if (r) { setData(r); setEditing(false); onSaved(); }
  }
  async function stop() {
    const r = await run(api<Prep>(`/inventory/items/${item.id}/prep`, { method: "PUT", body: { is_prep: false } }), `${item.name} is bought in again`);
    if (r) { onSaved(); onClose(); }
  }
  async function make() {
    const r = await run(api<{ batch_cost: number; warning: string }>(`/inventory/items/${item.id}/produce`, { body: { qty: Number(made) } }));
    if (!r) return;
    toast.success(`${n3(Number(made))} ${item.unit} of ${item.name} added · ingredients ${fmt(r.batch_cost)}`);
    if (r.warning) toast.warning(r.warning);
    onSaved(); onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{item.name}</DialogTitle>
          <DialogDescription>A preparation made in your kitchen (gravy base, dough, sauce). Making a batch takes its ingredients off stock and adds it at their cost, so dishes that use it get the right food cost.</DialogDescription>
        </DialogHeader>
        {!data ? <Empty>Loading…</Empty> : showEditor ? (
          <div className="space-y-4">
            <Field label={`One batch makes (${item.unit})`}><Input type="number" min={0} step="0.001" value={yieldQty} onChange={(e) => setYield(e.target.value)} className="h-10 w-40 font-mono" /></Field>
            <div className="space-y-2">
              <Label>Ingredients of one batch</Label>
              {lines.map((l, k) => {
                const s = others.find((x) => x.id === l.stock_item_id);
                return (
                  <div key={k} className="flex gap-2">
                    <select value={l.stock_item_id} onChange={(e) => { const u = others.find((x) => x.id === e.target.value)?.unit ?? "g"; setLines(lines.map((x, j) => (j === k ? { ...x, stock_item_id: e.target.value, unit: u } : x))); }} className={cn(sel, "h-10 flex-1")}>
                      <option value="">Pick stock item</option>
                      {others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <Input type="number" min={0} step="0.001" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} className="h-10 w-24 font-mono" />
                    <select value={l.unit} onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, unit: e.target.value } : x)))} className={cn(sel, "h-10 w-20")}>
                      {(s ? sameKind(s.unit) : ALL_UNITS).map((u) => <option key={u}>{u}</option>)}
                    </select>
                    <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== k))} className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted" aria-label="Remove"><Trash2 className="size-4" /></button>
                  </div>
                );
              })}
              <Btn onClick={() => setLines([...lines, { stock_item_id: "", qty: "", unit: "g" }])}><Plus className="size-4" />Ingredient</Btn>
            </div>
            <div className="flex gap-2">
              {data.is_prep && <Btn onClick={() => setEditing(false)} className="h-11 px-4">Cancel</Btn>}
              <Primary onClick={save} className="h-11 flex-1 justify-center">Save batch recipe</Primary>
            </div>
          </div>
        ) : !data.is_prep ? <p className="text-sm text-muted-foreground">Not a preparation. Ask a manager to set up its batch recipe.</p> : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-muted/60 p-4 text-sm">
              <div className="flex justify-between font-medium"><span>One batch makes {n3(data.yield)} {data.unit}</span><span className="font-mono">{fmt(data.batch_cost)} · {fmt(data.unit_cost)}/{data.unit}</span></div>
              <div className="mt-2 space-y-1">{data.lines.map((l) => (
                <div key={l.stock_item_id} className="flex justify-between text-muted-foreground"><span>{n3(l.qty)} {l.unit} {l.stock_item}</span><span className="font-mono">{fmt(l.cost)}</span></div>
              ))}</div>
              {manage && <div className="mt-3 flex gap-3"><button onClick={() => startEdit(data)} className="text-sm font-medium hover:underline">Change recipe</button><button onClick={stop} className="text-sm text-muted-foreground hover:underline">Stop making it here</button></div>}
            </div>
            <div className="flex items-end gap-2">
              <Field label={`Made just now (${item.unit})`}><Input type="number" min={0} step="0.001" value={made} onChange={(e) => setMade(e.target.value)} placeholder={String(data.yield)} className="h-11 w-40 font-mono" /></Field>
              <Primary onClick={make} disabled={!(Number(made) > 0)} className="h-11"><PackagePlus className="size-4" />Add to stock</Primary>
            </div>
            {Number(made) > 0 && data.yield > 0 && <p className="text-xs text-muted-foreground">Uses {data.lines.map((l) => `${n3(l.qty * Number(made) / data.yield)} ${l.unit} ${l.stock_item}`).join(", ")}.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Bills & payables ---------- */

interface Bill {
  id: string; supplier_id: string; supplier: string; po_id: string | null; bill_no: string; bill_date: string; due_date: string;
  amount: number; tax: number; paid: number; due: number; status: "unpaid" | "partial" | "paid"; days_late: number; note: string;
  payments: { id: string; amount: number; method: string; reference: string; paid_on: string; user: string }[];
}
interface Payables {
  due: number; overdue: number; due_this_week: number; paid_this_month: number; buckets: { key: string; label: string }[];
  suppliers: ({ supplier_id: string; supplier: string; bills: number; due: number; credit: number } & Record<string, number | string>)[];
}
const PAY_METHODS: [string, string][] = [["bank", "Bank transfer"], ["upi", "UPI"], ["cash", "Cash"], ["cheque", "Cheque"], ["card", "Card"], ["credit", "Supplier credit"]];
const dateStr = (d: string) => new Date(d + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" });
const isoToday = () => new Date().toISOString().slice(0, 10);

function BillsTab() {
  const { fmt } = usePos();
  const [status, setStatus] = useState<"open" | "paid">("open");
  const { data: pay, reload: reloadPay } = usePoll<Payables>("/inventory/payables", 60000, "inventory");
  const { data: bills, reload } = usePoll<Bill[]>(`/inventory/bills?status=${status}`, 60000, "inventory");
  const { data: suppliers } = usePoll<Supplier[]>("/inventory/suppliers", 0, "inventory");
  const [edit, setEdit] = useState<Bill | "new" | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const [credit, setCredit] = useState(false);
  const done = () => { reload(); reloadPay(); };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="You owe" value={fmt(pay?.due ?? 0)} sub="Unpaid bills" />
        <Tile label="Overdue" value={fmt(pay?.overdue ?? 0)} sub="Past their due date" warn={!!pay?.overdue} />
        <Tile label="Due in 7 days" value={fmt(pay?.due_this_week ?? 0)} />
        <Tile label="Paid this month" value={fmt(pay?.paid_this_month ?? 0)} />
      </div>
      {!!pay?.suppliers.length && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                {["Supplier", ...pay.buckets.map((b) => b.label), "Total", "Credit"].map((h, i) => <th key={h} className={cn("px-4 py-3 font-medium", i === 0 ? "text-left" : "text-right")}>{h}</th>)}
              </tr></thead>
              <tbody>{pay.suppliers.map((r) => (
                <tr key={r.supplier_id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{r.supplier}<span className="block text-xs font-normal text-muted-foreground">{r.bills} open bill{r.bills === 1 ? "" : "s"}</span></td>
                  {pay.buckets.map((b) => <td key={b.key} className={cn("px-4 py-2.5 text-right font-mono tabular", b.key !== "current" && Number(r[b.key]) > 0 && "text-destructive")}>{Number(r[b.key]) ? fmt(Number(r[b.key])) : "—"}</td>)}
                  <td className="px-4 py-2.5 text-right font-mono font-semibold tabular">{fmt(r.due)}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular text-[oklch(0.45_0.12_150)]">{r.credit ? fmt(r.credit) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={status} onChange={setStatus} options={[["open", "To pay"], ["paid", "Paid"]]} />
        <Btn onClick={() => setCredit(true)} className="ml-auto h-10" disabled={!suppliers?.length}>Supplier credit</Btn>
        <Primary onClick={() => setEdit("new")} disabled={!suppliers?.length}><Plus className="size-4" />Enter a bill</Primary>
      </div>
      <Card>
        {!bills ? <Empty>Loading…</Empty> : !bills.length ? <Empty>{status === "open" ? "Nothing to pay. Enter supplier bills here, or from a received purchase order." : "No paid bills yet."}</Empty> : (
          <div className="divide-y divide-border">
            {bills.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button onClick={() => setEdit(b)} className="min-w-0 flex-1 text-left">
                  <div className="flex flex-wrap items-center gap-2 font-medium">{b.supplier} · {b.bill_no || "no bill number"}
                    {b.status === "partial" && <span className="rounded-md bg-sky/15 px-1.5 text-[11px] font-semibold text-sky">Part paid</span>}
                    {b.days_late > 0 && <span className="rounded-md bg-destructive/10 px-1.5 text-[11px] font-semibold text-destructive">{b.days_late} days late</span>}</div>
                  <div className="text-xs text-muted-foreground">Billed {dateStr(b.bill_date)} · due {dateStr(b.due_date)}{b.tax ? ` · tax ${fmt(b.tax)}` : ""}{b.payments.length ? ` · paid ${b.payments.map((p) => `${fmt(p.amount)} ${p.method}`).join(", ")}` : ""}</div>
                </button>
                <div className="text-right font-mono text-sm tabular">{fmt(b.status === "paid" ? b.amount : b.due)}{b.status === "partial" && <span className="block text-xs text-muted-foreground">of {fmt(b.amount)}</span>}</div>
                {b.status !== "paid" && <Btn onClick={() => setPaying(b)} className="bg-foreground text-background">Pay</Btn>}
              </div>
            ))}
          </div>
        )}
      </Card>
      {edit && suppliers && <BillDialog bill={edit === "new" ? null : edit} suppliers={suppliers} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); done(); }} />}
      {paying && <PayBillDialog bill={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); done(); }} />}
      {credit && suppliers && <CreditDialog suppliers={suppliers} onClose={() => setCredit(false)} onSaved={() => { setCredit(false); done(); }} />}
    </>
  );
}

function BillDialog({ bill, suppliers, onClose, onSaved }: { bill: Bill | null; suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    supplier_id: bill?.supplier_id ?? suppliers.find((s) => s.active)?.id ?? "", bill_no: bill?.bill_no ?? "", bill_date: bill?.bill_date ?? isoToday(),
    due_date: bill?.due_date ?? "", amount: bill ? String(bill.amount) : "", tax: bill?.tax ? String(bill.tax) : "", note: bill?.note ?? "",
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const terms = suppliers.find((s) => s.id === f.supplier_id)?.payment_terms_days ?? 0;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, po_id: bill?.po_id ?? null, due_date: f.due_date || null, amount: Number(f.amount), tax: Number(f.tax) || 0 };
    if (await run(bill ? api(`/inventory/bills/${bill.id}`, { method: "PUT", body }) : api("/inventory/bills", { body }), bill ? "Bill saved" : "Bill entered")) onSaved();
  }
  async function remove() {
    if (bill && confirm("Delete this bill?") && await run(api(`/inventory/bills/${bill.id}`, { method: "DELETE" }), "Bill deleted")) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{bill ? "Bill" : "Enter a bill"}</DialogTitle><DialogDescription>A supplier&apos;s invoice: what you owe and by when.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <Field label="Supplier"><select required value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })} className={sel}>
            {suppliers.filter((s) => s.active || s.id === f.supplier_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Bill number"><Input value={f.bill_no} maxLength={60} onChange={(e) => set({ bill_no: e.target.value })} className="h-11" /></Field>
            <Field label="Bill date"><Input required type="date" value={f.bill_date} onChange={(e) => set({ bill_date: e.target.value })} className="h-11" /></Field>
            <Field label="Total with tax"><Input required type="number" min={0} step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className="h-11 font-mono" /></Field>
            <Field label="Of which tax"><Input type="number" min={0} step="0.01" value={f.tax} onChange={(e) => set({ tax: e.target.value })} placeholder="0" className="h-11 font-mono" /></Field>
          </div>
          <Field label="Due date" hint={f.due_date ? undefined : `Leave empty: ${terms} days after the bill date (the supplier's terms)`}><Input type="date" value={f.due_date} onChange={(e) => set({ due_date: e.target.value })} className="h-11" /></Field>
          <Field label="Note"><Input value={f.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} className="h-11" /></Field>
          <div className="flex gap-2">
            {bill && !bill.payments.length && <button type="button" onClick={remove} className="grid size-11 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive" aria-label="Delete bill"><Trash2 className="size-4" /></button>}
            <Primary type="submit" className="h-11 flex-1 justify-center">{bill ? "Save" : "Enter bill"}</Primary>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayBillDialog({ bill, onClose, onSaved }: { bill: Bill; onClose: () => void; onSaved: () => void }) {
  const { fmt } = usePos();
  const [f, setF] = useState({ amount: String(bill.due), method: "bank", reference: "", paid_on: isoToday() });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (await run(api(`/inventory/bills/${bill.id}/payments`, { body: { ...f, amount: Number(f.amount) } }), `${fmt(Number(f.amount))} paid to ${bill.supplier}`)) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Pay {bill.supplier}</DialogTitle><DialogDescription>Bill {bill.bill_no || "without a number"} · {fmt(bill.due)} left of {fmt(bill.amount)}</DialogDescription></DialogHeader>
        <form onSubmit={pay} className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount"><Input required type="number" min={0} step="0.01" max={bill.due} value={f.amount} onChange={(e) => set({ amount: e.target.value })} className="h-11 font-mono" /></Field>
            <Field label="Paid on"><Input type="date" value={f.paid_on} onChange={(e) => set({ paid_on: e.target.value })} className="h-11" /></Field>
          </div>
          <Field label="How"><select value={f.method} onChange={(e) => set({ method: e.target.value })} className={sel}>{PAY_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Reference"><Input value={f.reference} maxLength={80} onChange={(e) => set({ reference: e.target.value })} placeholder="UTR, cheque no." className="h-11" /></Field>
          <Primary type="submit" className="h-11 justify-center" disabled={!(Number(f.amount) > 0)}>Record payment</Primary>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreditDialog({ suppliers, onClose, onSaved }: { suppliers: Supplier[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ supplier_id: suppliers.find((s) => s.active)?.id ?? "", amount: "", reason: "" });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await run(api(`/inventory/suppliers/${f.supplier_id}/credits`, { body: { amount: Number(f.amount), reason: f.reason } }), "Credit recorded")) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Supplier credit</DialogTitle><DialogDescription>Money a supplier owes you back (returned goods, short supply). Use it later to pay their bills.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <Field label="Supplier"><select value={f.supplier_id} onChange={(e) => set({ supplier_id: e.target.value })} className={sel}>{suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Amount"><Input required type="number" min={0} step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className="h-11 font-mono" /></Field>
          <Field label="Reason"><Input required minLength={2} maxLength={200} value={f.reason} onChange={(e) => set({ reason: e.target.value })} placeholder="Returned 5 kg spoiled tomatoes" className="h-11" /></Field>
          <Primary type="submit" className="h-11 justify-center">Record credit</Primary>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Transfers between locations ---------- */

interface Transfer {
  id: string; number: number; status: "sent" | "received" | "cancelled"; direction: "in" | "out"; from: string; to: string; note: string;
  sent_by: string; received_by: string; sent_at: string; received_at: string | null; value: number;
  lines: { i: number; name: string; unit: string; qty: number; received: number | null; cost: number }[];
}
interface Transfers { locations: { id: string; name: string; inventory: boolean }[]; transfers: Transfer[] }
const X_TONE: Record<string, string> = { sent: "bg-sky/15 text-sky", received: "bg-leaf/15 text-[oklch(0.45_0.12_150)]", cancelled: "bg-muted text-muted-foreground" };

function TransfersTab() {
  const { fmt } = usePos();
  const { data, reload } = usePoll<Transfers>("/inventory/transfers", 30000, "inventory");
  const { data: stock } = usePoll<StockList>("/inventory/items", 0, "inventory");
  const [sending, setSending] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  async function cancel(x: Transfer) {
    if (confirm(`Call back transfer ${x.number}? The stock comes back here.`) && await run(api(`/inventory/transfers/${x.id}/cancel`, { method: "POST" }), "Transfer cancelled")) reload();
  }
  if (data && !data.locations.length) return <Card><Empty>Transfers move stock between your locations (a central kitchen to outlets, or outlet to outlet). Add a second location under Locations to use them.</Empty></Card>;
  return (
    <>
      <div className="flex"><Primary className="ml-auto" onClick={() => setSending(true)} disabled={!data?.locations.length || !stock?.items.length}><Plus className="size-4" />Send stock</Primary></div>
      <Card>
        {!data ? <Empty>Loading…</Empty> : !data.transfers.length ? <Empty>No transfers yet.</Empty> : (
          <div className="divide-y divide-border">
            {data.transfers.map((x) => (
              <div key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    #{x.number} · {x.direction === "out" ? `To ${x.to}` : `From ${x.from}`}
                    <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold capitalize", X_TONE[x.status])}>{x.status === "sent" ? (x.direction === "in" ? "Arriving" : "On the way") : x.status}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {x.lines.map((l) => `${n3(l.qty)} ${l.unit} ${l.name}${l.received != null && l.received < l.qty ? ` (got ${n3(l.received)})` : ""}`).join(", ")}
                    {` · sent ${new Date(x.sent_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })} by ${x.sent_by}`}{x.note ? ` · ${x.note}` : ""}
                  </div>
                </div>
                <div className="font-mono text-sm tabular">{fmt(x.value)}</div>
                {x.status === "sent" && x.direction === "in" && <Btn onClick={() => setReceiving(x)} className="bg-foreground text-background">Receive</Btn>}
                {x.status === "sent" && x.direction === "out" && <Btn onClick={() => cancel(x)}>Call back</Btn>}
              </div>
            ))}
          </div>
        )}
      </Card>
      {sending && data && stock && <SendDialog sites={data.locations} stock={stock.items} onClose={() => setSending(false)} onSaved={() => { setSending(false); reload(); }} />}
      {receiving && <ReceiveTransferDialog x={receiving} onClose={() => setReceiving(null)} onSaved={() => { setReceiving(null); reload(); }} />}
    </>
  );
}

function SendDialog({ sites, stock, onClose, onSaved }: { sites: Transfers["locations"]; stock: Stock[]; onClose: () => void; onSaved: () => void }) {
  const ok = sites.filter((s) => s.inventory);
  const [to, setTo] = useState(ok[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<{ stock_item_id: string; qty: string }[]>([{ stock_item_id: "", qty: "" }]);
  const avail = stock.filter((s) => s.active && s.on_hand > 0);
  async function send() {
    const body = { to_tenant_id: to, note, lines: lines.filter((l) => l.stock_item_id && Number(l.qty) > 0).map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty) })) };
    if (await run(api("/inventory/transfers", { body }), "Stock sent")) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Send stock</DialogTitle><DialogDescription>It comes off your stock now and goes on theirs when they receive it, at your average cost.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <Field label="To"><select value={to} onChange={(e) => setTo(e.target.value)} className={sel}>
            {sites.map((s) => <option key={s.id} value={s.id} disabled={!s.inventory}>{s.name}{s.inventory ? "" : " (inventory off)"}</option>)}</select></Field>
          <div className="space-y-2">
            <Label>Items</Label>
            {lines.map((l, k) => {
              const s = avail.find((x) => x.id === l.stock_item_id);
              return (
                <div key={k} className="flex gap-2">
                  <select value={l.stock_item_id} onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, stock_item_id: e.target.value } : x)))} className={cn(sel, "h-10 flex-1")}>
                    <option value="">Pick stock item</option>
                    {avail.map((x) => <option key={x.id} value={x.id}>{x.name} · {n3(x.on_hand)} {x.unit}</option>)}
                  </select>
                  <Input type="number" min={0} step="0.001" max={s?.on_hand} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, qty: e.target.value } : x)))} placeholder={s?.unit ?? "qty"} className="h-10 w-28 font-mono" />
                  <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== k))} className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted" aria-label="Remove"><Trash2 className="size-4" /></button>
                </div>
              );
            })}
            <Btn onClick={() => setLines([...lines, { stock_item_id: "", qty: "" }])}><Plus className="size-4" />Item</Btn>
          </div>
          <Field label="Note"><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Sent with the 4 pm van" className="h-11" /></Field>
          <Primary onClick={send} disabled={!to || !lines.some((l) => l.stock_item_id && Number(l.qty) > 0)} className="h-11 justify-center">Send</Primary>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveTransferDialog({ x, onClose, onSaved }: { x: Transfer; onClose: () => void; onSaved: () => void }) {
  const [got, setGot] = useState(x.lines.map((l) => String(l.qty)));
  async function receive() {
    if (await run(api(`/inventory/transfers/${x.id}/receive`, { body: { received: got.map((v) => Number(v) || 0) } }), `Transfer ${x.number} received`)) onSaved();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Receive transfer {x.number}</DialogTitle><DialogDescription>From {x.from}. Change any quantity that arrived short; the sender sees the difference in their activity log.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          {x.lines.map((l, k) => (
            <div key={l.i} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm">{l.name}<span className="text-xs text-muted-foreground"> · sent {n3(l.qty)} {l.unit}</span></span>
              <Input type="number" min={0} max={l.qty} step="0.001" value={got[k]} onChange={(e) => setGot(got.map((v, j) => (j === k ? e.target.value : v)))} className="h-10 w-28 font-mono" />
              <span className="w-8 text-sm text-muted-foreground">{l.unit}</span>
            </div>
          ))}
        </div>
        <Primary onClick={receive} className="h-11 justify-center">Add to stock</Primary>
      </DialogContent>
    </Dialog>
  );
}
