"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Printer, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, can, type Tenant } from "@/lib/api";
import { cn } from "@/lib/utils";
import { printReceipt } from "./print";
import { Seg, run, usePoll, usePos } from "./shared";
import type { Order } from "./types";

interface TableDef { id: string; name: string; seats: number; section: string; sort: number }

const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "Australia/Sydney", "UTC"];

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-6 rounded-2xl bg-card p-4 text-left ring-1 ring-border">
      <span><span className="block font-medium">{label}</span><span className="text-sm text-muted-foreground">{hint}</span></span>
      <span className={cn("relative h-7 w-12 shrink-0 rounded-full transition", on ? "bg-leaf" : "bg-[#d6d2ca]")}>
        <span className={cn("absolute top-1 size-5 rounded-full bg-white shadow transition-all", on ? "left-6" : "left-1")} />
      </span>
    </button>
  );
}

export function SettingsScreen() {
  const { s } = usePos();
  const owner = can(s.user, "settings");
  const [tab, setTab] = useState<"restaurant" | "tax" | "receipts" | "tables">(owner ? "restaurant" : "tables");
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      {owner && (
        <div className="overflow-x-auto">
          <Seg value={tab} onChange={setTab} options={[["restaurant", "Restaurant"], ["tax", "Taxes & tips"], ["receipts", "Receipts & printing"], ["tables", "Tables"]]} />
        </div>
      )}
      {tab === "tables" ? <TablesEditor /> : <TenantForm tab={tab} />}
    </div>
  );
}

function TenantForm({ tab }: { tab: "restaurant" | "tax" | "receipts" }) {
  const { s, fmt, setTenant } = usePos();
  const [t, setT] = useState<Tenant>(s.tenant!);
  const [rate, setRate] = useState(String(Math.round((s.tenant?.tax_rate ?? 0) * 100000) / 1000));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Tenant>) => setT((x) => ({ ...x, ...p }));

  useEffect(() => { api<Tenant>("/settings").then((x) => { setT(x); setTenant(x); }).catch(() => {}); }, [setTenant]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await run(api<Tenant>("/settings", {
      method: "PATCH",
      body: {
        name: t.name, phone: t.phone, address: t.address, city: t.city, tax_id: t.tax_id, timezone: t.timezone,
        tax_label: t.tax_label, tax_rate: (Number(rate) || 0) / 100, tips_enabled: t.tips_enabled,
        receipt_footer: t.receipt_footer, auto_print_kot: t.auto_print_kot, auto_print_receipt: t.auto_print_receipt,
      },
    }), "Settings saved");
    setBusy(false);
    if (r) { setT(r); setTenant(r); }
  }

  const sample: Order = {
    id: "sample", number: 1042, table_id: null, table: "T12", channel: "dine_in", status: "paid", customer_name: "", customer_phone: "", guests: 2,
    subtotal: 40, tax: 40 * (Number(rate) || 0) / 100, tip: 0, total: 40 * (1 + (Number(rate) || 0) / 100), due: 40 * (1 + (Number(rate) || 0) / 100),
    discount: { kind: "", value: 0, amount: 0, reason: "" }, paid: 40 * (1 + (Number(rate) || 0) / 100), refunded: 0, balance: 0, payment_method: "card", void_reason: "",
    opened_at: new Date().toISOString(), closed_at: new Date().toISOString(),
    items: [{ id: "a", menu_item_id: null, name: "Sample dish", unit_price: 20, qty: 2, note: "", modifiers: [], comp_reason: "", line_total: 40, sent: true, done: true, paid: true, course: 1, seat: 0, station: "" }],
    payments: [{ id: "p", kind: "payment", method: "card", amount: 40 * (1 + (Number(rate) || 0) / 100), tip: 0, tendered: 0, change: 0, reason: "", line_ids: [], created_at: new Date().toISOString() }],
  };

  return (
    <form onSubmit={save} className="grid max-w-2xl gap-5">
      {tab === "restaurant" && (
        <>
          <Field label="Restaurant name"><Input required minLength={2} value={t.name} onChange={(e) => set({ name: e.target.value })} className="h-11" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone"><Input value={t.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} className="h-11" /></Field>
            <Field label="City"><Input value={t.city ?? ""} onChange={(e) => set({ city: e.target.value })} className="h-11" /></Field>
          </div>
          <Field label="Address" hint="Printed at the top of receipts"><Textarea rows={2} value={t.address ?? ""} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label="Time zone" hint="Used for reports and the day's order history">
            <select value={t.timezone} onChange={(e) => set({ timezone: e.target.value })}
              className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm">
              {[...new Set([t.timezone ?? "UTC", ...ZONES])].map((z) => <option key={z}>{z}</option>)}
            </select>
          </Field>
        </>
      )}
      {tab === "tax" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tax rate (%)"><Input type="number" min={0} max={50} step="0.001" value={rate} onChange={(e) => setRate(e.target.value)} className="h-11 font-mono" /></Field>
            <Field label="Tax label on receipts"><Input value={t.tax_label} onChange={(e) => set({ tax_label: e.target.value })} className="h-11" /></Field>
          </div>
          <Field label="Tax / registration number" hint="Printed on receipts if set"><Input value={t.tax_id ?? ""} onChange={(e) => set({ tax_id: e.target.value })} className="h-11" /></Field>
          <Toggle on={!!t.tips_enabled} onChange={(v) => set({ tips_enabled: v })} label="Ask for tips" hint="Show tip options when taking payment, and a tip line on printed bills." />
        </>
      )}
      {tab === "receipts" && (
        <>
          <Field label="Receipt footer"><Textarea rows={2} maxLength={400} value={t.receipt_footer ?? ""} onChange={(e) => set({ receipt_footer: e.target.value })} /></Field>
          <Toggle on={!!t.auto_print_kot} onChange={(v) => set({ auto_print_kot: v })} label="Print kitchen tickets" hint="Print a ticket every time items are sent to the kitchen." />
          <Toggle on={!!t.auto_print_receipt} onChange={(v) => set({ auto_print_receipt: v })} label="Print receipts automatically" hint="Print the receipt as soon as a check is fully paid." />
          <button type="button" onClick={() => printReceipt(sample, t, fmt)} className="flex h-11 w-fit items-center gap-2 rounded-xl bg-card px-4 text-sm font-semibold ring-1 ring-border">
            <Printer className="size-4" />Print a test receipt
          </button>
          <p className="text-sm text-muted-foreground">Tiffin prints through the browser to your default printer. For 80 mm receipt printers, set the paper size in the print dialog once and turn off headers and footers.</p>
        </>
      )}
      <button type="submit" disabled={busy} className="h-12 w-full max-w-xs rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">Save changes</button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

function TablesEditor() {
  const { data: tables, reload, setData } = usePoll<TableDef[]>("/floor/tables", 0);
  const [form, setForm] = useState({ name: "", seats: 4, section: "Main" });
  const sections = [...new Set((tables ?? []).map((t) => t.section))];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await run(api("/floor/tables", { body: form }), `${form.name} added`)) { setForm({ ...form, name: "" }); reload(); }
  }
  async function patch(t: TableDef, body: Partial<TableDef>) {
    setData((d) => d && d.map((x) => (x.id === t.id ? { ...x, ...body } : x)));
    if (!(await run(api(`/floor/tables/${t.id}`, { method: "PATCH", body })))) reload();
  }
  async function remove(t: TableDef) {
    if (await run(api(`/floor/tables/${t.id}`, { method: "DELETE" }), `${t.name} removed`)) reload();
  }
  async function swap(i: number, j: number) {
    if (!tables || j < 0 || j >= tables.length) return;
    const a = tables[i], b = tables[j];
    await Promise.all([api(`/floor/tables/${a.id}`, { method: "PATCH", body: { sort: b.sort === a.sort ? j : b.sort } }),
      api(`/floor/tables/${b.id}`, { method: "PATCH", body: { sort: b.sort === a.sort ? i : a.sort } })]).catch(() => {});
    reload();
  }

  return (
    <div className="grid max-w-3xl gap-5">
      <form onSubmit={add} className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[1fr_110px_1fr_auto] sm:items-end">
        <Field label="Table name"><Input required maxLength={20} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. T13 or Bar 2" className="h-10" /></Field>
        <Field label="Seats"><Input type="number" min={1} max={40} value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) || 1 })} className="h-10" /></Field>
        <Field label="Section">
          <Input list="sections" required maxLength={40} value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} className="h-10" />
          <datalist id="sections">{sections.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <button type="submit" className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background"><Plus className="size-4" />Add</button>
      </form>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {tables?.map((t, i) => (
          <div key={t.id} className="grid grid-cols-[1fr_80px_1fr_auto] items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
            <Input defaultValue={t.name} maxLength={20} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && patch(t, { name: e.target.value.trim() })} className="h-9 font-semibold" />
            <Input type="number" min={1} max={40} defaultValue={t.seats} onBlur={(e) => Number(e.target.value) !== t.seats && patch(t, { seats: Number(e.target.value) || 1 })} className="h-9" />
            <Input defaultValue={t.section} list="sections" maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value !== t.section && patch(t, { section: e.target.value.trim() })} className="h-9" />
            <div className="flex gap-1">
              <button onClick={() => swap(i, i - 1)} disabled={i === 0} className="grid size-9 place-items-center rounded-lg bg-muted disabled:opacity-30" aria-label="Move up"><ArrowUp className="size-4" /></button>
              <button onClick={() => swap(i, i + 1)} disabled={i === tables.length - 1} className="grid size-9 place-items-center rounded-lg bg-muted disabled:opacity-30" aria-label="Move down"><ArrowDown className="size-4" /></button>
              <button onClick={() => remove(t)} className="grid size-9 place-items-center rounded-lg bg-destructive/10 text-destructive" aria-label={`Remove ${t.name}`}><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Tables with an open check can&apos;t be removed. Sections group tables on the floor.</p>
    </div>
  );
}
