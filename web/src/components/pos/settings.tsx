"use client";

import { useEffect, useState } from "react";
import { Armchair, Printer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type Tenant } from "@/lib/api";
import { cn } from "@/lib/utils";
import { printReceipt } from "./print";
import { Seg, run, usePos } from "./shared";
import type { Order } from "./types";


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
  const { go } = usePos();
  const [tab, setTab] = useState<"restaurant" | "tax" | "receipts">("restaurant");
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <div className="overflow-x-auto">
          <Seg value={tab} onChange={setTab} options={[["restaurant", "Restaurant"], ["tax", "Taxes & tips"], ["receipts", "Receipts & printing"]]} />
        </div>
        <button onClick={() => go("floorplan")} className="flex items-center gap-1.5 rounded-xl bg-card px-3.5 py-2 text-sm font-medium ring-1 ring-border">
          <Armchair className="size-4" />Tables are in Floor plan
        </button>
      </div>
      <TenantForm tab={tab} />
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
