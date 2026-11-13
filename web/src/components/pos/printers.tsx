"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cable, Copy, KeyRound, Plus, Printer as PrinterIcon, RotateCcw, Usb, Wifi, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_URL, api } from "@/lib/api";
import {
  type Printer, deviceReceiptPrinter, pairPrinter, pairings, setDeviceReceiptPrinter, supportsSerial, supportsUsb, unpair,
} from "@/lib/printers";
import { cn } from "@/lib/utils";
import { Empty, run, usePoll } from "./shared";

interface Job { id: string; printer_id: string; printer: string; title: string; status: string; error: string; created_at: string }
interface Bridge { has_key: boolean; online: boolean; last_seen_at: string | null }

const CONNECTION: Record<Printer["connection"], string> = {
  usb: "USB on a POS device", serial: "Serial / Bluetooth on a POS device", network: "Network (IP address)", windows: "Shared Windows printer",
};
const viaBridge = (p: Printer) => p.connection === "network" || p.connection === "windows";

/** Re-render when this device's pairings or receipt printer change. */
function useDeviceState() {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    window.addEventListener("tiffin:printers", f);
    return () => window.removeEventListener("tiffin:printers", f);
  }, []);
  return { paired: pairings(), receipt: deviceReceiptPrinter() };
}

export function PrintersPanel() {
  const { data: printers, reload } = usePoll<Printer[]>("/printers", 15000, "print");
  const { data: failed, reload: reloadJobs } = usePoll<Job[]>("/print/jobs?status=failed", 15000, "print");
  const { data: bridge, reload: reloadBridge } = usePoll<Bridge>("/print/bridge", 15000, "print");
  const { data: stations } = usePoll<string[]>("/kds/stations", 0);
  const dev = useDeviceState();
  const [edit, setEdit] = useState<Printer | "new" | null>(null);
  const [key, setKey] = useState<string | null>(null);

  const receipts = (printers ?? []).filter((p) => p.role === "receipt" && p.enabled);
  const mine = dev.receipt && receipts.some((p) => p.id === dev.receipt) ? dev.receipt : "";

  async function test(p: Printer) {
    if (await run(api(`/printers/${p.id}/test`, { method: "POST" }))) toast.success(`Test page sent to ${p.name}`);
  }
  async function connect(p: Printer) {
    try {
      const label = await pairPrinter(p);
      toast.success(`${p.name} connected to this device (${label})`);
      if (p.role === "receipt" && !dev.receipt) setDeviceReceiptPrinter(p.id);
    } catch (e) {
      const msg = (e as Error).message;
      if (!/no device selected|cancel/i.test(msg)) toast.error(msg);
    }
  }
  async function newKey() {
    if (bridge?.has_key && !confirm("Create a new key? The print bridge using the old key will stop until you update it.")) return;
    const r = await run(api<{ key: string }>("/print/bridge/key", { method: "POST" }));
    if (r) { setKey(r.key); reloadBridge(); }
  }
  async function retry(j: Job, printerId?: string) {
    if (await run(api(`/print/jobs/${j.id}/retry`, { body: printerId ? { printer_id: printerId } : {} }), "Sent again")) reloadJobs();
  }
  async function dismiss(j: Job) {
    if (await run(api(`/print/jobs/${j.id}`, { method: "DELETE" }))) reloadJobs();
  }

  return (
    <div className="grid max-w-3xl gap-5">
      <div className="rounded-2xl bg-card p-4 text-sm leading-relaxed text-muted-foreground ring-1 ring-border">
        <div className="mb-1 font-medium text-foreground">How printing works with several printers</div>
        Kitchen tickets are split by station: each kitchen printer prints only the stations you pick for it, and a kitchen
        printer with no stations picked prints everything else. Each counter chooses its own receipt printer below.
        USB and serial printers print from the POS device they&apos;re plugged into (Chrome or Edge); network and shared
        printers print through the print bridge on any shop computer. With no printers set up, Tiffin uses the browser&apos;s print dialog.
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold">Printers</h3>
        <button onClick={() => setEdit("new")} className="ml-auto flex h-10 items-center gap-1.5 rounded-xl bg-foreground px-4 text-sm font-semibold text-background">
          <Plus className="size-4" />Add printer
        </button>
      </div>

      {printers && !printers.length && <div className="rounded-2xl bg-card ring-1 ring-border"><Empty>No printers yet. Add your receipt printer and one printer per kitchen station.</Empty></div>}

      <div className="grid gap-3">
        {(printers ?? []).map((p) => {
          const paired = !!dev.paired[p.id];
          const status = !p.enabled ? { t: "Turned off", c: "bg-muted-foreground" }
            : viaBridge(p) ? (p.online ? { t: "Online through the print bridge", c: "bg-leaf" } : { t: "Waiting for the print bridge", c: "bg-saffron" })
            : paired ? { t: "Connected to this device", c: "bg-leaf" }
            : p.online ? { t: "Connected to another device", c: "bg-leaf" } : { t: "Not connected to a device yet", c: "bg-saffron" };
          return (
            <div key={p.id} className="rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-muted">
                  {viaBridge(p) ? <Wifi className="size-5" /> : p.connection === "usb" ? <Usb className="size-5" /> : <Cable className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">{p.role === "receipt" ? "Receipts" : "Kitchen"}</span>
                    {p.role === "receipt" && mine === p.id && <span className="rounded-md bg-leaf/15 px-2 py-0.5 text-xs font-medium text-[oklch(0.45_0.12_150)]">This device</span>}
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {p.role === "kitchen" ? (p.stations.length ? p.stations.join(", ") : "All other stations") : p.cash_drawer ? "Opens the cash drawer" : "Bills and receipts"}
                    {" · "}{CONNECTION[p.connection]}{p.address ? ` · ${p.address}` : ""} · {p.width === 32 ? "58 mm" : "80 mm"}{p.copies > 1 ? ` · ${p.copies} copies` : ""}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("size-2 rounded-full", status.c)} />{status.t}</div>
                  {p.last_error && <div className="mt-1.5 text-xs text-destructive">Last error: {p.last_error}</div>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Small onClick={() => test(p)}><PrinterIcon className="size-3.5" />Test print</Small>
                <Small onClick={() => setEdit(p)}>Edit</Small>
                {!viaBridge(p) && (paired
                  ? <Small onClick={() => { unpair(p.id); toast.success(`${p.name} disconnected from this device`); }}>Disconnect from this device</Small>
                  : <Small onClick={() => connect(p)} disabled={p.connection === "usb" ? !supportsUsb() : !supportsSerial()}>Connect to this device</Small>)}
                {p.role === "receipt" && p.enabled && mine !== p.id && <Small onClick={() => setDeviceReceiptPrinter(p.id)}>Use for this device&apos;s receipts</Small>}
              </div>
            </div>
          );
        })}
      </div>
      {!supportsUsb() && (printers ?? []).some((p) => !viaBridge(p)) && (
        <p className="text-xs text-muted-foreground">This browser can&apos;t connect to USB or serial printers. Use Chrome or Edge on the device the printer is plugged into.</p>
      )}

      {!!failed?.length && (
        <div className="grid gap-2">
          <h3 className="text-base font-semibold">Didn&apos;t print</h3>
          {failed.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-3.5 ring-1 ring-border">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{j.title}</div>
                <div className="truncate text-xs text-muted-foreground">{j.printer} · {new Date(j.created_at).toLocaleTimeString([], { timeStyle: "short" })} · {j.error}</div>
              </div>
              <Small onClick={() => retry(j)}><RotateCcw className="size-3.5" />Retry</Small>
              <select value="" onChange={(e) => e.target.value && retry(j, e.target.value)} className="h-9 rounded-lg border border-input bg-card px-2 text-sm">
                <option value="">Send to…</option>
                {(printers ?? []).filter((p) => p.enabled && p.id !== j.printer_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={() => dismiss(j)} title="Dismiss" className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl bg-card p-4 ring-1 ring-border">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Print bridge</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", bridge?.online ? "bg-leaf" : "bg-muted-foreground")} />
            {bridge?.online ? "Running" : bridge?.has_key ? "Not running" : "Not set up"}
          </span>
          <Small className="ml-auto" onClick={newKey}><KeyRound className="size-3.5" />{bridge?.has_key ? "New key" : "Create key"}</Small>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Needed for network and shared printers. Run it on any computer at the restaurant that stays on during service.
        </p>
        {key && (
          <div className="mt-3 rounded-xl bg-muted p-3">
            <div className="text-xs font-medium">Your bridge key (shown once, keep it private)</div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-sm">{key}</code>
              <Small onClick={() => { navigator.clipboard?.writeText(key); toast.success("Key copied"); }}><Copy className="size-3.5" />Copy</Small>
            </div>
          </div>
        )}
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Install Node.js 18 or newer on the shop computer.</li>
          <li>Download <code className="font-mono">tiffin-print-bridge.mjs</code> from the print-bridge folder of the Tiffin repository.</li>
          <li>Run it with your key: <code className="break-all font-mono text-xs">TIFFIN_URL={absApi()} TIFFIN_PRINT_KEY=&lt;key&gt; node tiffin-print-bridge.mjs</code></li>
          <li>For a Windows USB printer: share it with the &quot;Generic / Text Only&quot; driver and add it here as a shared printer, e.g. <code className="font-mono">\\localhost\POS80</code>.</li>
        </ol>
      </div>

      {edit && <PrinterDialog printer={edit === "new" ? null : edit} stations={stations ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function absApi() {
  if (typeof window === "undefined") return API_URL;
  return API_URL.startsWith("http") ? API_URL : window.location.origin + API_URL;
}

function Small({ children, className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...p} className={cn("flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-sm font-medium disabled:opacity-40", className)}>
      {children}
    </button>
  );
}

function PrinterDialog({ printer, stations, onClose, onSaved }: {
  printer: Printer | null; stations: string[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState(() => ({
    name: printer?.name ?? "", role: printer?.role ?? "receipt", stations: printer?.stations ?? [],
    connection: printer?.connection ?? "network", address: printer?.address ?? "", width: printer?.width ?? 48,
    copies: printer?.copies ?? 1, cash_drawer: printer?.cash_drawer ?? false, enabled: printer?.enabled ?? true,
  }));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const toggleStation = (s: string) => set({ stations: f.stations.includes(s) ? f.stations.filter((x) => x !== s) : [...f.stations, s] });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await run(printer ? api(`/printers/${printer.id}`, { method: "PATCH", body: f }) : api("/printers", { body: f }), printer ? "Printer saved" : "Printer added");
    setBusy(false);
    if (r) onSaved();
  }
  async function remove() {
    if (!printer || !confirm(`Remove ${printer.name}? Its waiting print jobs are removed too.`)) return;
    if (await run(api(`/printers/${printer.id}`, { method: "DELETE" }), "Printer removed")) { unpair(printer.id); onSaved(); }
  }

  const sel = "h-11 w-full rounded-lg border border-input bg-card px-3 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{printer ? `Edit ${printer.name}` : "Add printer"}</DialogTitle>
          <DialogDescription>Thermal receipt printers that understand ESC/POS (almost all of them).</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <div className="space-y-2"><Label htmlFor="pr-name">Name</Label>
            <Input id="pr-name" required maxLength={80} value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Counter, Bar, Tandoor" className="h-11" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Prints</Label>
              <select value={f.role} onChange={(e) => set({ role: e.target.value as Printer["role"] })} className={sel}>
                <option value="receipt">Bills and receipts</option><option value="kitchen">Kitchen tickets</option>
              </select></div>
            <div className="space-y-2"><Label>Paper</Label>
              <select value={f.width} onChange={(e) => set({ width: Number(e.target.value) as Printer["width"] })} className={sel}>
                <option value={48}>80 mm</option><option value={42}>80 mm (smaller font)</option><option value={32}>58 mm</option>
              </select></div>
          </div>
          {f.role === "kitchen" && (
            <div className="space-y-2">
              <Label>Stations</Label>
              <div className="flex flex-wrap gap-2">
                {stations.map((s) => (
                  <button type="button" key={s} onClick={() => toggleStation(s)}
                    className={cn("h-9 rounded-lg px-3 text-sm font-medium ring-1", f.stations.includes(s) ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>{s}</button>
                ))}
                {!stations.length && <span className="text-sm text-muted-foreground">Stations come from your menu items.</span>}
              </div>
              <p className="text-xs text-muted-foreground">Pick none to print every station that has no printer of its own.</p>
            </div>
          )}
          <div className="space-y-2"><Label>Connected by</Label>
            <select value={f.connection} onChange={(e) => set({ connection: e.target.value as Printer["connection"] })} className={sel}>
              {(Object.keys(CONNECTION) as Printer["connection"][]).map((c) => <option key={c} value={c}>{CONNECTION[c]}</option>)}
            </select></div>
          {(f.connection === "network" || f.connection === "windows") && (
            <div className="space-y-2"><Label htmlFor="pr-addr">{f.connection === "network" ? "IP address" : "Shared printer path"}</Label>
              <Input id="pr-addr" required value={f.address} onChange={(e) => set({ address: e.target.value })} className="h-11 font-mono"
                placeholder={f.connection === "network" ? "192.168.1.50 (port 9100 if not given)" : "\\\\localhost\\POS80"} />
              <p className="text-xs text-muted-foreground">Printed through the print bridge.</p></div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label>Copies</Label>
              <select value={f.copies} onChange={(e) => set({ copies: Number(e.target.value) })} className={sel}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select></div>
            <div className="flex flex-col justify-end gap-2.5 pb-1">
              {f.role === "receipt" && <Check on={f.cash_drawer} onChange={(v) => set({ cash_drawer: v })} label="Cash drawer is plugged into it" />}
              <Check on={f.enabled} onChange={(v) => set({ enabled: v })} label="Turned on" />
            </div>
          </div>
          <div className="flex gap-2">
            {printer && <button type="button" onClick={remove} className="h-11 rounded-xl px-4 text-sm font-semibold text-destructive">Remove</button>}
            <button type="submit" disabled={busy} className="ml-auto h-11 rounded-xl bg-foreground px-6 font-semibold text-background disabled:opacity-40">{printer ? "Save" : "Add printer"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Check({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-foreground" />{label}
    </label>
  );
}
