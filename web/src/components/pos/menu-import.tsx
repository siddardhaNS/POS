"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Camera, Download, FileSpreadsheet, Loader2, ScanText, Trash2, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { API_URL, api, upload } from "@/lib/api";
import { cn } from "@/lib/utils";
import { VegDot, usePos } from "./shared";

interface Row { name: string; price: number; category: string; is_veg: boolean; station: string; available: boolean; keep?: boolean }
interface Preview { rows: Row[]; warnings: string[] }

export function MenuImport({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const { s } = usePos();
  const [tab, setTab] = useState<"ocr" | "csv">("ocr");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<"merge" | "append">("merge");
  const ocrRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  function reset() { setRows(null); setWarnings([]); setBusy(false); }

  async function parse(files: FileList | null, kind: "ocr" | "csv") {
    if (!files?.length) return;
    setBusy(true);
    try {
      const p = kind === "csv"
        ? await upload<Preview>("/menu/import/csv", [files[0]], "file")
        : await upload<Preview>("/menu/import/ocr", Array.from(files), "files");
      setRows(p.rows.map((r) => ({ ...r, keep: true })));
      setWarnings(p.warnings);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      [ocrRef, camRef, csvRef].forEach((r) => r.current && (r.current.value = ""));
    }
  }

  async function commit() {
    const keep = rows?.filter((r) => r.keep && r.name.trim()) ?? [];
    if (!keep.length) return;
    setBusy(true);
    try {
      const r = await api<{ created: number; updated: number; categories_created: number }>("/menu/import/commit", {
        body: { mode, rows: keep.map(({ keep: _k, ...x }) => x) }, // eslint-disable-line @typescript-eslint/no-unused-vars
      });
      toast.success(`${r.created} added${r.updated ? `, ${r.updated} updated` : ""}${r.categories_created ? ` · ${r.categories_created} new categories` : ""}`);
      reset();
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  const edit = (i: number, p: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const kept = rows?.filter((r) => r.keep).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Import menu</DialogTitle>
          <DialogDescription>Scan a printed menu or upload a spreadsheet. You&apos;ll review every item before anything is saved.</DialogDescription>
        </DialogHeader>

        {!rows ? (
          <>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
              {([["ocr", "Scan menu (OCR)", ScanText], ["csv", "CSV file", FileSpreadsheet]] as const).map(([k, l, Icon]) => (
                <button key={k} onClick={() => setTab(k)}
                  className={cn("flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium", tab === k ? "bg-card shadow-sm" : "text-muted-foreground")}>
                  <Icon className="size-4" />{l}
                </button>
              ))}
            </div>

            {busy ? (
              <div className="grid h-56 place-items-center rounded-2xl border border-dashed border-border text-center">
                <div>
                  <Loader2 className="mx-auto size-8 animate-spin text-saffron-deep" />
                  <p className="mt-3 font-medium">{tab === "ocr" ? "Reading your menu…" : "Reading CSV…"}</p>
                  {tab === "ocr" && <p className="mt-1 text-sm text-muted-foreground">This usually takes 20 to 60 seconds per page.</p>}
                </div>
              </div>
            ) : tab === "ocr" ? (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                <ScanText className="mx-auto size-10 text-saffron-deep" />
                <p className="mt-3 font-medium">Upload photos or a PDF of your menu</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Up to 8 pages. We pick up dish names, {s.tenant?.currency} prices, sections and veg / non-veg marks, including Half/Full portions.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <button onClick={() => ocrRef.current?.click()} className="flex h-11 items-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background">
                    <Upload className="size-4" />Choose files
                  </button>
                  <button onClick={() => camRef.current?.click()} className="flex h-11 items-center gap-2 rounded-xl bg-card px-5 font-semibold ring-1 ring-border">
                    <Camera className="size-4" />Take photo
                  </button>
                </div>
                <input ref={ocrRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => parse(e.target.files, "ocr")} />
                <input ref={camRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => parse(e.target.files, "ocr")} />
                <p className="mt-5 text-xs text-muted-foreground">Tip: shoot straight on in good light, one page per photo.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                <FileSpreadsheet className="mx-auto size-10 text-leaf" />
                <p className="mt-3 font-medium">Upload a CSV exported from Excel, Google Sheets or your old POS</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Columns: <span className="font-mono text-xs">name, price, category, veg, station, available</span>. Only name and price are required, and common header names are recognised.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <button onClick={() => csvRef.current?.click()} className="flex h-11 items-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background">
                    <Upload className="size-4" />Choose CSV
                  </button>
                  <a href={`${API_URL}/menu/import/template.csv`} className="flex h-11 items-center gap-2 rounded-xl bg-card px-5 font-semibold ring-1 ring-border">
                    <Download className="size-4" />Template
                  </a>
                </div>
                <input ref={csvRef} type="file" hidden accept=".csv,text/csv,.txt" onChange={(e) => parse(e.target.files, "csv")} />
              </div>
            )}
          </>
        ) : (
          <>
            {warnings.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-xl bg-accent px-4 py-3 text-sm text-accent-foreground">
                {warnings.map((w, i) => <div key={i} className="flex gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{w}</div>)}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="w-8 px-3 py-2"><input type="checkbox" checked={kept === rows.length} onChange={(e) => setRows(rows.map((r) => ({ ...r, keep: e.target.checked })))} /></th>
                    <th className="px-2 py-2">Item</th><th className="px-2 py-2">Category</th><th className="w-28 px-2 py-2">Price</th><th className="w-20 px-2 py-2">Type</th><th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={cn("border-b border-border/60 last:border-0", !r.keep && "opacity-40")}>
                      <td className="px-3"><input type="checkbox" checked={!!r.keep} onChange={(e) => edit(i, { keep: e.target.checked })} /></td>
                      <td className="px-1 py-1"><input value={r.name} onChange={(e) => edit(i, { name: e.target.value })} className="w-full rounded-md bg-transparent px-1.5 py-1.5 outline-none focus:bg-muted" /></td>
                      <td className="px-1"><input value={r.category} onChange={(e) => edit(i, { category: e.target.value })} className="w-full rounded-md bg-transparent px-1.5 py-1.5 text-muted-foreground outline-none focus:bg-muted" /></td>
                      <td className="px-1"><input type="number" step="0.01" min={0} value={r.price} onChange={(e) => edit(i, { price: Number(e.target.value) })}
                        className={cn("w-full rounded-md bg-transparent px-1.5 py-1.5 font-mono outline-none focus:bg-muted", !r.price && "text-destructive")} /></td>
                      <td className="px-1">
                        <button onClick={() => edit(i, { is_veg: !r.is_veg })} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs hover:bg-muted">
                          <VegDot veg={r.is_veg} />{r.is_veg ? "Veg" : "Non-veg"}
                        </button>
                      </td>
                      <td><button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={mode === "merge"} onChange={(e) => setMode(e.target.checked ? "merge" : "append")} />
                Update existing items with the same name
              </label>
              <button onClick={reset} disabled={busy} className="ml-auto h-11 rounded-xl px-4 text-sm font-medium text-muted-foreground hover:text-foreground">Start over</button>
              <button onClick={commit} disabled={busy || !kept} className="flex h-11 items-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background disabled:opacity-40">
                {busy && <Loader2 className="size-4 animate-spin" />}Import {kept} item{kept === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
