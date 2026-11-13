"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { BellRing, Printer, QrCode, ReceiptText, RefreshCw, ShoppingBag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, can, hasModule } from "@/lib/api";
import { cn } from "@/lib/utils";
import { esc, printHtml } from "./print";
import { Empty, run, useNow, usePoll, usePos } from "./shared";

/* ---------- Service requests from guests (Floor screen) ---------- */

export interface ServiceReq { id: string; table_id: string; table: string; order_id: string | null; kind: "order" | "waiter" | "bill"; label: string; note: string; created_at: string }

const ICON = { order: ShoppingBag, waiter: BellRing, bill: ReceiptText } as const;

export function GuestAlerts({ onOpenTable }: { onOpenTable: (tableId: string) => void }) {
  const { s } = usePos();
  const on = hasModule(s.tenant, "qr_ordering") && can(s.user, "floor");
  const { data, setData } = usePoll<ServiceReq[]>(on ? "/service-requests" : null, 30_000, "requests");
  const now = useNow(30_000);
  if (!on || !data?.length) return null;
  async function done(r: ServiceReq) {
    setData((d) => d && d.filter((x) => x.id !== r.id));
    await run(api(`/service-requests/${r.id}/done`, { method: "POST" }));
  }
  return (
    <section>
      <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-saffron-deep">From the tables · {data.length}</div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {data.map((r) => {
          const Icon = ICON[r.kind];
          const mins = Math.max(0, Math.round((now - new Date(r.created_at).getTime()) / 60000));
          return (
            <div key={r.id} className={cn("flex min-w-64 max-w-80 flex-col gap-2 rounded-2xl border px-4 py-3",
              r.kind === "order" ? "border-sky/40 bg-sky/10" : r.kind === "bill" ? "border-saffron/50 bg-saffron/10" : "border-chili/30 bg-chili/[0.06]")}>
              <div className="flex items-center gap-2">
                <Icon className="size-4" />
                <span className="font-semibold">Table {r.table.replace(/^T/, "")}</span>
                <span className="text-sm">{r.label}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{mins ? `${mins}m` : "now"}</span>
              </div>
              {r.note && <div className="line-clamp-2 text-xs text-muted-foreground">{r.note}</div>}
              <div className="flex gap-2">
                <button onClick={() => onOpenTable(r.table_id)} className="h-8 flex-1 rounded-lg bg-foreground text-xs font-semibold text-background">
                  {r.kind === "order" ? "Review & send" : r.kind === "bill" ? "Open check" : "Open table"}
                </button>
                <button onClick={() => done(r)} className="h-8 rounded-lg bg-card px-3 text-xs font-medium ring-1 ring-border">Done</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Table QR codes (Floor plan) ---------- */

interface Codes { auto_send: boolean; tables: { id: string; name: string; section: string; seats: number; token: string }[] }

const guestUrl = (token: string) => `${window.location.origin}/t/${token}`;

function useQrSvg(text: string) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((s) => { if (live) setSvg(s); }).catch(() => {});
    return () => { live = false; };
  }, [text]);
  return svg;
}

function QrTile({ name, token, onRotate }: { name: string; token: string; onRotate: () => void }) {
  const svg = useQrSvg(guestUrl(token));
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-3 ring-1 ring-border">
      <div className="size-32" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="font-semibold">Table {name.replace(/^T/, "")}</div>
      <div className="flex gap-1.5">
        <a href={guestUrl(token)} target="_blank" rel="noreferrer" className="rounded-lg bg-muted px-2.5 py-1 text-xs font-medium">Open</a>
        <button onClick={onRotate} className="flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1 text-xs font-medium" title="Make a new code; the old printed one stops working">
          <RefreshCw className="size-3" />New code
        </button>
      </div>
    </div>
  );
}

export function QrCodesButton() {
  const { s } = usePos();
  const [open, setOpen] = useState(false);
  if (!hasModule(s.tenant, "qr_ordering")) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex h-9 items-center gap-1.5 rounded-xl bg-card px-3 text-sm font-medium ring-1 ring-border">
        <QrCode className="size-4" />Table QR codes
      </button>
      {open && <QrCodesDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function QrCodesDialog({ onClose }: { onClose: () => void }) {
  const { s } = usePos();
  const { data, setData } = usePoll<Codes>("/floor/qr", 0);
  const [busy, setBusy] = useState(false);

  async function rotate(id: string, name: string) {
    if (!confirm(`Make a new code for ${name}? The code printed on the table now will stop working.`)) return;
    const r = await run(api<{ id: string; token: string }>(`/floor/tables/${id}/qr/rotate`, { method: "POST" }), `New code for ${name}`);
    if (r) setData((d) => d && { ...d, tables: d.tables.map((t) => (t.id === id ? { ...t, token: r.token } : t)) });
  }
  async function setAuto(v: boolean) {
    const r = await run(api("/floor/qr/settings", { method: "PUT", body: { auto_send: v } }), v ? "Guest orders now go straight to the kitchen" : "Staff confirm guest orders first");
    if (r) setData((d) => d && { ...d, auto_send: v });
  }
  async function printAll() {
    if (!data) return;
    setBusy(true);
    try {
      const cards = await Promise.all(data.tables.map(async (t) => {
        const svg = await QRCode.toString(guestUrl(t.token), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
        return `<div class="card"><div class="q">${svg}</div><div class="t">Table ${esc(t.name.replace(/^T/, ""))}</div><div class="s">Scan to see the menu and order</div><div class="r">${esc(s.tenant?.name ?? "")}</div></div>`;
      }));
      // A4/Letter sheet: override the receipt-sized page from printHtml with its own style block.
      printHtml(`<style>@page{size:auto;margin:10mm}body{width:auto!important;font-family:system-ui,sans-serif}
        .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}.card{border:1px dashed #999;border-radius:4mm;padding:6mm;text-align:center;break-inside:avoid}
        .q svg{width:45mm;height:45mm}.t{font-size:18pt;font-weight:700;margin-top:2mm}.s{font-size:9pt;color:#444}.r{font-size:8pt;color:#777;margin-top:1mm}</style>
        <div class="grid">${cards.join("")}</div>`, "Table QR codes");
    } catch {
      toast.error("Couldn't make the QR codes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Table QR codes</DialogTitle>
          <DialogDescription>Print a code for each table. Guests scan it to see the menu, order, call a server or ask for the bill.</DialogDescription>
        </DialogHeader>
        {!data ? <Empty>Loading…</Empty> : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={data.auto_send} disabled={!can(s.user, "settings")} onChange={(e) => setAuto(e.target.checked)} className="size-4 accent-foreground" />
                Send guest orders straight to the kitchen
              </label>
              <span className="text-xs text-muted-foreground">{data.auto_send ? "No staff check before cooking." : "Staff see each order and press Send (safer)."}</span>
              <button onClick={printAll} disabled={busy} className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-semibold text-background disabled:opacity-40">
                <Printer className="size-4" />{busy ? "Preparing…" : "Print all"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {data.tables.map((t) => <QrTile key={t.id} name={t.name} token={t.token} onRotate={() => rotate(t.id, t.name)} />)}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
