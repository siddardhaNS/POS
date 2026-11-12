"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, Building2, Check, Clock, LogOut, Mail, MapPin, Phone, Play, Search, Store, X } from "lucide-react";
import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, session } from "@/lib/api";
import { cn } from "@/lib/utils";

interface TenantRow {
  id: string; name: string; slug: string; market: "IN" | "US"; status: string;
  contact_name: string; email: string; phone: string; city: string; cuisine: string;
  outlets: number; service_style: string; message: string; review_note: string; users: number;
  created_at: string; reviewed_at: string | null; trial_ends_at: string | null;
}
interface Stats { by_status: Record<string, number>; live_by_market: Record<string, number>; paid_orders: number }

const FILTERS = [
  { k: "pending", l: "Awaiting review" },
  { k: "trial", l: "On trial" },
  { k: "active", l: "Active" },
  { k: "rejected", l: "Rejected" },
  { k: "suspended", l: "Suspended" },
  { k: "", l: "All" },
];

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-accent text-accent-foreground",
  trial: "bg-[oklch(0.94_0.05_250)] text-[oklch(0.42_0.12_250)]",
  active: "bg-[oklch(0.94_0.05_150)] text-[oklch(0.42_0.12_150)]",
  rejected: "bg-destructive/10 text-destructive",
  suspended: "bg-muted text-muted-foreground",
};

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
const ago = (s: string) => {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState("pending");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [sel, setSel] = useState<TenantRow | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = session.get();
    if (!s || s.user.role !== "platform_admin") router.replace("/login");
    else setReady(true);
  }, [router]);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      if (q) params.set("q", q);
      const [r, st] = await Promise.all([
        api<TenantRow[]>(`/admin/tenants?${params}`),
        api<Stats>("/admin/stats"),
      ]);
      setRows(r);
      setStats(st);
    } catch (e) {
      toast.error((e as Error).message);
      if (!session.get()) router.replace("/login");
    }
  }, [filter, q, router]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [ready, load, q]);

  async function act(action: "approve" | "reject" | "status", status?: string) {
    if (!sel) return;
    setBusy(true);
    try {
      const updated = await api<TenantRow>(`/admin/tenants/${sel.id}/${action}`, {
        body: action === "status" ? { status } : { note },
      });
      const msg = {
        approve: `${sel.name} approved. 14-day trial started and menu provisioned.`,
        reject: `${sel.name} rejected`,
        status: `${sel.name} is now ${status}`,
      }[action];
      toast.success(msg);
      setSel({ ...sel, ...updated });
      setNote("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tiles = useMemo(() => [
    { k: "pending", l: "Awaiting review", icon: Clock, accent: true },
    { k: "trial", l: "On free trial", icon: Play },
    { k: "active", l: "Paying restaurants", icon: Store },
    { k: "rejected", l: "Rejected", icon: X },
  ], []);

  if (!ready) return null;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col bg-[#1d1c1a] p-5 text-white md:flex">
        <Logo dark href="/admin" />
        <div className="mt-2 pl-[46px] text-xs text-white/40">Platform console</div>
        <div className="mt-8 font-mono text-[10.5px] tracking-[0.08em] text-white/40">RESTAURANTS</div>
        <nav className="mt-2 space-y-0.5">
          {FILTERS.map((f) => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13.5px] transition",
                filter === f.k ? "bg-white/12 text-white" : "text-white/55 hover:text-white")}>
              {f.l}
              {f.k && stats && <span className="font-mono text-xs text-white/40">{stats.by_status[f.k] ?? 0}</span>}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-white/[0.06] p-3 text-xs text-white/50">
          <div className="flex justify-between"><span>Live · INR</span><span className="font-mono text-white">{stats?.live_by_market.IN ?? 0}</span></div>
          <div className="mt-1.5 flex justify-between"><span>Live · USD</span><span className="font-mono text-white">{stats?.live_by_market.US ?? 0}</span></div>
          <div className="mt-1.5 flex justify-between"><span>Paid orders</span><span className="font-mono text-white">{stats?.paid_orders ?? 0}</span></div>
        </div>
        <button onClick={() => { session.clear(); router.push("/login"); }}
          className="mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-white/55 hover:text-white">
          <LogOut className="size-4" />Sign out
        </button>
      </aside>

      <main className="min-w-0 flex-1 px-5 py-8 md:px-10">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Restaurants</h1>
            <p className="mt-1 text-sm text-muted-foreground">Review free-trial applications and manage every tenant on Tiffin.</p>
          </div>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, city" className="h-10 bg-card pl-9" />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(({ k, l, icon: Icon, accent }) => (
            <button key={k} onClick={() => setFilter(k)}
              className={cn("rounded-2xl border bg-card p-5 text-left transition hover:border-foreground/20",
                filter === k ? "border-foreground/30 ring-1 ring-foreground/10" : "border-border")}>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                {l}<Icon className={cn("size-4", accent && "text-saffron-deep")} />
              </div>
              <div className="mt-3 font-mono text-3xl font-semibold tabular">{stats?.by_status[k] ?? "–"}</div>
            </button>
          ))}
        </div>

        {/* Mobile filter chips */}
        <div className="mt-5 flex gap-2 overflow-x-auto md:hidden">
          {FILTERS.map((f) => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-sm", filter === f.k ? "bg-foreground text-background" : "bg-card text-muted-foreground ring-1 ring-border")}>
              {f.l}
            </button>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="hidden grid-cols-[2fr_1.2fr_0.8fr_1fr_0.9fr] gap-4 border-b border-border px-5 py-3 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground md:grid">
            <span>Restaurant</span><span>Contact</span><span>Currency</span><span>Applied</span><span>Status</span>
          </div>
          {rows.length === 0 && (
            <div className="px-5 py-16 text-center text-sm text-muted-foreground">
              <Building2 className="mx-auto mb-3 size-8 opacity-40" />No restaurants here.
            </div>
          )}
          {rows.map((t) => (
            <button key={t.id} onClick={() => { setSel(t); setNote(t.review_note); }}
              className="grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b border-border/60 px-5 py-4 text-left transition last:border-0 hover:bg-muted/50 md:grid-cols-[2fr_1.2fr_0.8fr_1fr_0.9fr] md:items-center">
              <div className="min-w-0">
                <div className="truncate font-medium">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">{t.city}{t.cuisine && ` · ${t.cuisine}`} · {t.outlets} outlet{t.outlets > 1 ? "s" : ""}</div>
              </div>
              <div className="hidden min-w-0 md:block">
                <div className="truncate text-sm">{t.contact_name}</div>
                <div className="truncate text-xs text-muted-foreground">{t.email}</div>
              </div>
              <div className="hidden text-sm md:block">{t.market === "IN" ? "₹ INR" : "$ USD"}</div>
              <div className="hidden text-sm text-muted-foreground md:block">{ago(t.created_at)}</div>
              <div className="row-span-2 self-center md:row-span-1"><StatusPill s={t.status} /></div>
            </button>
          ))}
        </div>
      </main>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {sel && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <DialogTitle className="text-xl">{sel.name}</DialogTitle>
                  <StatusPill s={sel.status} />
                </div>
                <DialogDescription>
                  {sel.market === "IN" ? "₹ INR" : "$ USD"} · {sel.service_style} · applied {fmtDate(sel.created_at)}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 rounded-xl bg-muted/60 p-4 text-sm sm:grid-cols-2">
                <Info icon={Building2} v={`${sel.contact_name}`} />
                <Info icon={Mail} v={sel.email} />
                <Info icon={Phone} v={sel.phone || "—"} />
                <Info icon={MapPin} v={`${sel.city || "—"} · ${sel.outlets} outlet${sel.outlets > 1 ? "s" : ""}`} />
              </div>
              {sel.message && (
                <div className="text-sm">
                  <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Their note</div>
                  <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{sel.message}</p>
                </div>
              )}
              {(sel.trial_ends_at || sel.reviewed_at) && (
                <div className="flex gap-6 text-sm text-muted-foreground">
                  {sel.reviewed_at && <span>Reviewed {fmtDate(sel.reviewed_at)}</span>}
                  {sel.trial_ends_at && <span>Trial ends {fmtDate(sel.trial_ends_at)}</span>}
                  <span>{sel.users} user{sel.users === 1 ? "" : "s"}</span>
                </div>
              )}

              {(sel.status === "pending" || sel.status === "rejected") && (
                <div className="space-y-3 border-t border-border pt-4">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    placeholder="Internal review note (optional), e.g. verified GSTIN, called owner" />
                  <div className="flex gap-2">
                    {sel.status === "pending" && (
                      <Button variant="outline" disabled={busy} onClick={() => act("reject")} className="h-10 flex-1 text-destructive hover:text-destructive">
                        <X className="size-4" />Reject
                      </Button>
                    )}
                    <Button disabled={busy} onClick={() => act("approve")} className="h-10 flex-1 bg-leaf text-white hover:bg-leaf/90">
                      <Check className="size-4" />Approve &amp; start trial
                    </Button>
                  </div>
                </div>
              )}
              {["trial", "active", "suspended"].includes(sel.status) && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  {sel.status !== "active" && (
                    <Button disabled={busy} onClick={() => act("status", "active")} className="h-10 flex-1">
                      <Store className="size-4" />Mark as paying
                    </Button>
                  )}
                  {sel.status === "suspended" ? (
                    <Button variant="outline" disabled={busy} onClick={() => act("status", "trial")} className="h-10 flex-1">
                      <Play className="size-4" />Reinstate trial
                    </Button>
                  ) : (
                    <Button variant="outline" disabled={busy} onClick={() => act("status", "suspended")} className="h-10 flex-1 text-destructive hover:text-destructive">
                      <Ban className="size-4" />Suspend
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusPill({ s }: { s: string }) {
  const label = { pending: "Pending", trial: "Trial", active: "Active", rejected: "Rejected", suspended: "Suspended" }[s] ?? s;
  return <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[s])}>{label}</span>;
}

function Info({ icon: Icon, v }: { icon: React.ComponentType<{ className?: string }>; v: string }) {
  return <div className="flex min-w-0 items-center gap-2"><Icon className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{v}</span></div>;
}
