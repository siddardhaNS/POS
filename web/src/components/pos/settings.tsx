"use client";

import { useEffect, useState } from "react";
import { Armchair, KeyRound, Printer } from "lucide-react";
import { ChangePasswordDialog } from "@/components/change-password";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, hasModule, type Tenant } from "@/lib/api";
import { cn } from "@/lib/utils";
import { printReceipt } from "./print";
import { PrintersPanel } from "./printers";
import { Seg, run, usePos } from "./shared";
import type { Order, TaxRates } from "./types";


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
  const { go, s } = usePos();
  const [pwOpen, setPwOpen] = useState(false);
  const [tab, setTab] = useState<"restaurant" | "tax" | "loyalty" | "receipts" | "printers" | "kiosk">("restaurant");
  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-5 md:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <div className="overflow-x-auto">
          <Seg value={tab} onChange={setTab} options={[["restaurant", "Restaurant"], ["tax", "Taxes & tips"], ["loyalty", "Loyalty"], ["receipts", "Receipts"], ...(hasModule(s.tenant, "printing") ? [["printers", "Printers"] as ["printers", string]] : []), ...(hasModule(s.tenant, "kiosk") ? [["kiosk", "Kiosk"] as ["kiosk", string]] : [])]} />
        </div>
        <button onClick={() => go("floorplan")} className="flex items-center gap-1.5 rounded-xl bg-card px-3.5 py-2 text-sm font-medium ring-1 ring-border">
          <Armchair className="size-4" />Tables are in Floor plan
        </button>
        {s.user.role === "owner" && (
          <button onClick={() => setPwOpen(true)} className="flex items-center gap-1.5 rounded-xl bg-card px-3.5 py-2 text-sm font-medium ring-1 ring-border">
            <KeyRound className="size-4" />Change owner password
          </button>
        )}
        <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      </div>
      {tab === "printers" && hasModule(s.tenant, "printing") ? <PrintersPanel /> : tab === "kiosk" && hasModule(s.tenant, "kiosk") ? <KioskPanel /> : <TenantForm tab={tab === "printers" || tab === "kiosk" ? "receipts" : tab} />}
    </div>
  );
}

function TenantForm({ tab }: { tab: "restaurant" | "tax" | "loyalty" | "receipts" }) {
  const { s, fmt, setTenant } = usePos();
  const [t, setT] = useState<Tenant>(s.tenant!);
  const [rate, setRate] = useState(String(Math.round((s.tenant?.tax_rate ?? 0) * 100000) / 1000));
  const [busy, setBusy] = useState(false);
  const [classes, setClasses] = useState<TaxRates | null>(null);
  const set = (p: Partial<Tenant>) => setT((x) => ({ ...x, ...p }));
  const hasClasses = !!classes?.rates.length;
  useEffect(() => { if (tab === "tax") api<TaxRates>("/tax-rates").then(setClasses).catch(() => {}); }, [tab]);

  useEffect(() => { api<Tenant>("/settings").then((x) => { setT(x); setTenant(x); }).catch(() => {}); }, [setTenant]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await run(api<Tenant>("/settings", {
      method: "PATCH",
      body: {
        name: t.name, phone: t.phone, address: t.address, city: t.city, tax_id: t.tax_id, timezone: t.timezone,
        ...(hasClasses ? {} : { tax_label: t.tax_label, tax_rate: (Number(rate) || 0) / 100 }), tips_enabled: t.tips_enabled,
        invoice_prefix: t.invoice_prefix ?? "",
        loyalty_enabled: !!t.loyalty_enabled, loyalty_earn_per: t.loyalty_earn_per || 1, loyalty_point_value: t.loyalty_point_value ?? 0,
        loyalty_min_redeem: t.loyalty_min_redeem ?? 0, delivery_fee: t.delivery_fee ?? 0,
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
          <Field label={`Delivery fee (${t.currency})`} hint="Added to new in-house deliveries; can be changed on each order">
            <Input type="number" min={0} step="0.01" value={t.delivery_fee ?? 0} onChange={(e) => set({ delivery_fee: Number(e.target.value) })} className="h-11 max-w-40 font-mono" /></Field>
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
          {classes && <TaxClasses data={classes} onChange={(c) => { setClasses(c); api<Tenant>("/settings").then((x) => { setT((cur) => ({ ...cur, tax_rate: x.tax_rate, tax_label: x.tax_label, default_tax_id: x.default_tax_id })); setTenant(x); }).catch(() => {}); }} />}
          {!hasClasses && <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tax rate (%)"><Input type="number" min={0} max={50} step="0.001" value={rate} onChange={(e) => setRate(e.target.value)} className="h-11 font-mono" /></Field>
            <Field label="Tax label on receipts"><Input value={t.tax_label} onChange={(e) => set({ tax_label: e.target.value })} className="h-11" /></Field>
          </div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={s.tenant?.market === "IN" ? "GSTIN" : "Tax / registration number"} hint={s.tenant?.market === "IN" ? "Printed on invoices; with it, paid checks print as a Tax Invoice" : "Printed on receipts if set"}>
              <Input value={t.tax_id ?? ""} onChange={(e) => set({ tax_id: e.target.value })} className="h-11 font-mono" /></Field>
            <Field label="Invoice number prefix" hint={`Paid checks get the next number of the financial year, e.g. ${[(t.invoice_prefix ?? "").toUpperCase(), s.tenant?.market === "IN" ? "2026-27" : "2026", "00001"].filter(Boolean).join("/")}`}>
              <Input value={t.invoice_prefix ?? ""} maxLength={12} placeholder="Optional, e.g. BLR" onChange={(e) => set({ invoice_prefix: e.target.value.replace(/[^A-Za-z0-9-]/g, "") })} className="h-11 font-mono" /></Field>
          </div>
          <Toggle on={!!t.tips_enabled} onChange={(v) => set({ tips_enabled: v })} label="Ask for tips" hint="Show tip options when taking payment, and a tip line on printed bills." />
        </>
      )}
      {tab === "loyalty" && (
        <>
          <Toggle on={!!t.loyalty_enabled} onChange={(v) => set({ loyalty_enabled: v })} label="Loyalty points"
            hint="Guests with their phone on the check earn points on what they pay, and can pay with points next time." />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`Spend per point (${s.tenant?.currency})`} hint={`1 point for every ${fmt(t.loyalty_earn_per || 1)} paid`}>
              <Input type="number" min={0.01} step="0.01" value={t.loyalty_earn_per ?? ""} onChange={(e) => set({ loyalty_earn_per: Number(e.target.value) })} className="h-11 font-mono" /></Field>
            <Field label="Value of a point" hint={`100 points = ${fmt((t.loyalty_point_value ?? 0) * 100)}`}>
              <Input type="number" min={0} step="0.01" value={t.loyalty_point_value ?? ""} onChange={(e) => set({ loyalty_point_value: Number(e.target.value) })} className="h-11 font-mono" /></Field>
            <Field label="Use from (points)" hint="Smallest balance that can be spent">
              <Input type="number" min={0} value={t.loyalty_min_redeem ?? ""} onChange={(e) => set({ loyalty_min_redeem: Number(e.target.value) })} className="h-11 font-mono" /></Field>
          </div>
          {!!t.loyalty_earn_per && !!t.loyalty_point_value && (
            <p className="text-sm text-muted-foreground">Guests get back {((t.loyalty_point_value / t.loyalty_earn_per) * 100).toFixed(2).replace(/.?0+$/, "")}% of what they spend as points. Points aren&apos;t earned on the part paid with points, and refunds take back a matching share.</p>
          )}
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
          <p className="text-sm text-muted-foreground">Set up thermal printers in the Printers tab to print without a dialog. Without them, Tiffin prints through the browser: for 80 mm paper, set the paper size in the print dialog once and turn off headers and footers.</p>
        </>
      )}
      <button type="submit" disabled={busy} className="h-12 w-full max-w-xs rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">Save changes</button>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>;
}

/* ---------- Tax classes ---------- */

type DraftRate = { id?: string; name: string; pct: string; split: boolean };

function TaxClasses({ data, onChange }: { data: TaxRates; onChange: (d: TaxRates) => void }) {
  const { s } = usePos();
  const gst = s.tenant?.market === "IN";
  const [draft, setDraft] = useState<DraftRate | null>(null);

  async function save() {
    if (!draft) return;
    const rate = (Number(draft.pct) || 0) / 100;
    const body = {
      name: draft.name.trim() || (gst ? `GST ${draft.pct}%` : `Tax ${draft.pct}%`), rate,
      components: draft.split && rate ? [{ name: "CGST", rate: rate / 2 }, { name: "SGST", rate: rate / 2 }] : [],
    };
    const r = draft.id ? await run(api<TaxRates>(`/tax-rates/${draft.id}`, { method: "PUT", body }), "Tax class saved")
      : await run(api<TaxRates>("/tax-rates", { body }), `${body.name} added`);
    if (r) { onChange(r); setDraft(null); }
  }
  async function makeDefault(id: string) {
    const r = await run(api<TaxRates>("/tax-rates-default", { method: "PUT", body: { id } }), "Default tax class changed");
    if (r) onChange(r);
  }
  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete ${name}? Dishes in it go back to their category's or the default class.`)) return;
    const r = await run(api<TaxRates>(`/tax-rates/${id}`, { method: "DELETE" }), `${name} deleted`);
    if (r) onChange(r);
  }

  return (
    <div className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-border">
      <div>
        <div className="font-semibold">Tax classes</div>
        <p className="text-sm text-muted-foreground">
          {data.rates.length ? "Put dishes or whole categories in a class from the Menu screen. Everything else uses the default." :
            `Every dish is taxed at ${(data.fallback.rate * 100).toFixed(3).replace(/\.?0+$/, "")}% (${data.fallback.name}). Add classes when some dishes are taxed differently${gst ? ", e.g. GST 18% on packaged drinks" : ""}.`}
        </p>
      </div>
      {data.rates.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-medium">{r.name}
              {data.default_id === r.id && <span className="rounded bg-foreground px-1.5 text-[11px] font-semibold text-background">Default</span>}</div>
            <div className="text-xs text-muted-foreground">
              {r.components.length ? r.components.map((c) => `${c.name} ${+(c.rate * 100).toFixed(3)}%`).join(" + ") : `${+(r.rate * 100).toFixed(3)}%`}
              {r.items ? ` · ${r.items} dish${r.items === 1 ? "" : "es"}` : ""}
            </div>
          </div>
          {data.default_id !== r.id && <button type="button" onClick={() => makeDefault(r.id)} className="text-sm font-medium hover:underline">Make default</button>}
          <button type="button" onClick={() => setDraft({ id: r.id, name: r.name, pct: String(+(r.rate * 100).toFixed(3)), split: r.components.length > 1 })} className="text-sm font-medium hover:underline">Edit</button>
          {data.default_id !== r.id && <button type="button" onClick={() => remove(r.id, r.name)} className="text-sm text-destructive hover:underline">Delete</button>}
        </div>
      ))}
      {draft ? (
        <div className="grid gap-3 rounded-xl p-4 ring-1 ring-foreground sm:grid-cols-[1fr_110px]">
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={gst ? "GST 18%" : "Sales tax"} maxLength={60} className="h-10"
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
          <Input type="number" min={0} max={50} step="0.001" value={draft.pct} onChange={(e) => setDraft({ ...draft, pct: e.target.value })} placeholder="%" className="h-10 font-mono"
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />
          {gst && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={draft.split} onChange={(e) => setDraft({ ...draft, split: e.target.checked })} className="size-4" />
              Split into CGST + SGST halves on the bill (sales within your state)
            </label>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" onClick={save} className="h-10 rounded-lg bg-foreground px-4 text-sm font-semibold text-background">Save class</button>
            <button type="button" onClick={() => setDraft(null)} className="h-10 rounded-lg bg-muted px-4 text-sm font-medium">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setDraft({ name: "", pct: data.rates.length ? "" : String(+(data.fallback.rate * 100).toFixed(3)), split: gst })}
          className="h-10 rounded-xl border-[1.5px] border-dashed border-border px-4 text-sm font-medium">
          + {data.rates.length ? "Add tax class" : "Set up tax classes"}
        </button>
      )}
    </div>
  );
}

/* ---------- Kiosk ---------- */

function KioskPanel() {
  const [k, setK] = useState<{ token: string; auto_send: boolean } | null>(null);
  useEffect(() => { api<{ token: string; auto_send: boolean }>("/kiosk-settings").then(setK).catch(() => {}); }, []);
  if (!k) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const link = `${window.location.origin}/k/${k.token}`;
  async function save(body: { auto_send?: boolean; rotate?: boolean }, ok: string) {
    const r = await run(api<{ token: string; auto_send: boolean }>("/kiosk-settings", { method: "PUT", body }), ok);
    if (r) setK(r);
  }
  return (
    <div className="grid max-w-2xl gap-5">
      <div className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-border">
        <div className="font-semibold">Kiosk link</div>
        <p className="text-sm text-muted-foreground">Open this on the counter tablet in full screen. Guests order and pay at the till; each order shows up as a takeaway with a number to call.</p>
        <div className="break-all rounded-xl bg-muted px-3 py-2 font-mono text-sm">{link}</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(link); }} className="h-10 rounded-lg bg-muted px-4 text-sm font-semibold">Copy link</button>
          <a href={link} target="_blank" rel="noopener" className="flex h-10 items-center rounded-lg bg-foreground px-4 text-sm font-semibold text-background">Open kiosk</a>
          <button type="button" onClick={() => window.confirm("Replace the kiosk link? Screens using the old link stop working.") && save({ rotate: true }, "New kiosk link made")} className="h-10 rounded-lg px-4 text-sm text-destructive">Replace link</button>
        </div>
      </div>
      <Toggle on={k.auto_send} onChange={(v) => save({ auto_send: v }, v ? "Kiosk orders go straight to the kitchen" : "Kiosk orders wait for payment")}
        label="Send kiosk orders to the kitchen straight away" hint="Off: the cashier sends the order once it's paid. On: cooking starts as soon as the guest orders." />
      <p className="text-sm text-muted-foreground">Choose which dishes appear on the kiosk with &quot;Sold on&quot; in the Menu.</p>
    </div>
  );
}
