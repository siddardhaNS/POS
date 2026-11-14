"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ErrorRow {
  id: string; tenant_id: string | null; restaurant: string; source: string; message: string; detail: string; method: string; path: string;
  status: number; user: string; user_agent: string; count: number; resolved: boolean; first_seen: string; last_seen: string;
}
interface ErrorList { errors: ErrorRow[]; by_restaurant: { tenant_id: string; restaurant: string; open: number; events: number }[] }

const SOURCES: [string, string][] = [["", "All"], ["api", "Server"], ["web", "Web"], ["mobile", "Mobile app"], ["desktop", "Counter app"]];
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function ErrorsPanel() {
  const [data, setData] = useState<ErrorList | null>(null);
  const [tenant, setTenant] = useState("");
  const [source, setSource] = useState("");
  const [resolved, setResolved] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<ErrorList>(`/admin/errors?tenant_id=${tenant}&source=${source}&resolved=${resolved}`));
    } catch (e) { toast.error((e as Error).message); }
  }, [tenant, source, resolved]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  async function mark(e: ErrorRow) {
    try {
      await api(`/admin/errors/${e.id}`, { method: "PATCH", body: { resolved: !e.resolved } });
      toast.success(e.resolved ? "Reopened" : "Marked fixed");
      load();
    } catch (err) { toast.error((err as Error).message); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Errors</h1>
          <p className="mt-1 text-sm text-muted-foreground">Server errors and app crashes, by restaurant. Repeats of the same problem are grouped with a count.</p>
        </div>
        <button onClick={load} className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-card px-3 text-sm font-medium ring-1 ring-border"><RefreshCw className="size-4" />Refresh</button>
      </div>

      {!!data?.by_restaurant.length && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setTenant("")} className={cn("rounded-xl px-3 py-2 text-left text-sm ring-1", !tenant ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>
            All restaurants</button>
          {data.by_restaurant.map((r) => (
            <button key={r.tenant_id} onClick={() => setTenant(r.tenant_id)}
              className={cn("rounded-xl px-3 py-2 text-left text-sm ring-1", tenant === r.tenant_id ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>
              <span className="font-medium">{r.restaurant}</span>
              <span className="ml-2 font-mono text-xs opacity-70">{r.open} open · {r.events}× this week</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {SOURCES.map(([k, l]) => (
          <button key={k} onClick={() => setSource(k)} className={cn("h-8 rounded-lg px-3 text-sm ring-1", source === k ? "bg-foreground text-background ring-foreground" : "bg-card ring-border")}>{l}</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} className="size-4" />Show fixed
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {!data ? <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div> : !data.errors.length ? (
          <div className="p-10 text-center text-sm text-muted-foreground">{resolved ? "Nothing marked fixed yet." : "No errors. All quiet."}</div>
        ) : data.errors.map((e) => (
          <div key={e.id} className="border-b border-border/60 last:border-0">
            <button onClick={() => setOpen(open === e.id ? null : e.id)} className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-muted/40">
              {open === e.id ? <ChevronDown className="mt-0.5 size-4 shrink-0" /> : <ChevronRight className="mt-0.5 size-4 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.message}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {e.restaurant} · {SOURCES.find(([k]) => k === e.source)?.[1] ?? e.source}{e.method ? ` · ${e.method}` : ""} {e.path}{e.user ? ` · ${e.user}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                <span className="block font-mono font-semibold text-foreground">{e.count}×</span>{ago(e.last_seen)}
              </span>
            </button>
            {open === e.id && (
              <div className="space-y-3 px-5 pb-4 pl-12">
                <div className="text-xs text-muted-foreground">First seen {new Date(e.first_seen).toLocaleString()} · last {new Date(e.last_seen).toLocaleString()}{e.user_agent ? ` · ${e.user_agent}` : ""}</div>
                {e.detail && <pre className="max-h-80 overflow-auto rounded-xl bg-[#1d1c1a] p-4 text-xs leading-relaxed text-white/85">{e.detail}</pre>}
                <button onClick={() => mark(e)} className="h-9 rounded-lg bg-foreground px-3 text-sm font-semibold text-background">{e.resolved ? "Reopen" : "Mark fixed"}</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
