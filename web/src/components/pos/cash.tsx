"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Lock, Printer, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { type DrawerReport, printDrawer } from "./print";
import { Empty, METHOD_LABEL, run, usePoll, usePos } from "./shared";

interface Session extends DrawerReport {
  id: string;
  movements: { id: string; kind: "in" | "out"; amount: number; reason: string; by: string; created_at: string }[];
}
interface Drawer { session: Session | null; recent: Session[] }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export function CashScreen() {
  const { s, fmt } = usePos();
  const { data, setData } = usePoll<Drawer>("/cash", 20000, "cash");
  const [float, setFloat] = useState("");
  const [move, setMove] = useState<null | "in" | "out">(null);
  const [closing, setClosing] = useState(false);

  async function openDrawer(e: React.FormEvent) {
    e.preventDefault();
    const d = await run(api<Drawer>("/cash/open", { body: { opening_float: Number(float) || 0 } }), "Drawer open");
    if (d) { setData(d); setFloat(""); }
  }

  if (!data) return <Empty>Loading drawer…</Empty>;
  const cur = data.session;

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto p-5 md:p-7">
      {!cur ? (
        <form onSubmit={openDrawer} className="mx-auto mt-6 w-full max-w-md rounded-3xl border border-border bg-card p-7 text-center">
          <Wallet className="mx-auto size-10 text-saffron-deep" strokeWidth={1.5} />
          <div className="mt-3 text-2xl font-semibold">Open the cash drawer</div>
          <p className="mt-1 text-sm text-muted-foreground">Count the starting cash (float) and enter it to begin the shift.</p>
          <Input type="number" min={0} step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="Opening float"
            className="mt-6 h-14 text-center font-mono text-2xl" autoFocus />
          <button type="submit" className="mt-4 h-12 w-full rounded-xl bg-foreground font-semibold text-background">Open drawer</button>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="flex items-center gap-2 text-2xl font-semibold"><span className="size-2.5 animate-pulse rounded-full bg-leaf" />Drawer open</div>
              <div className="text-sm text-muted-foreground">Since {when(cur.opened_at)}{cur.opened_by ? ` · by ${cur.opened_by}` : ""}</div>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button onClick={() => setMove("in")} className="flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold ring-1 ring-border"><ArrowDownLeft className="size-4" />Paid in</button>
              <button onClick={() => setMove("out")} className="flex items-center gap-1.5 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold ring-1 ring-border"><ArrowUpRight className="size-4" />Paid out</button>
              <button onClick={() => setClosing(true)} className="flex items-center gap-1.5 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background"><Lock className="size-4" />Close drawer</button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat l="Expected in drawer" v={fmt(cur.expected_cash)} hi />
            <Stat l="Opening float" v={fmt(cur.opening_float)} />
            <Stat l="Cash sales + tips" v={fmt(cur.cash_sales + cur.cash_tips)} />
            <Stat l="Refunds · paid out" v={`−${fmt(cur.cash_refunds + cur.paid_out)}`} sub={cur.paid_in ? `+${fmt(cur.paid_in)} paid in` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="font-semibold">Sales this shift</div>
              <div className="mt-3 space-y-2 text-sm">
                {Object.keys(cur.by_method).length === 0 && <p className="text-muted-foreground">No payments yet this shift.</p>}
                {Object.entries(cur.by_method).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{METHOD_LABEL[k] ?? k} <span className="text-muted-foreground">· {v.count}</span></span>
                    <span className="font-mono">{fmt(v.sales + v.tips)}{v.refunds ? <span className="text-saffron-deep"> −{fmt(v.refunds)}</span> : null}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5">
              <div className="font-semibold">Paid in & out</div>
              <div className="mt-3 space-y-2 text-sm">
                {cur.movements.length === 0 && <p className="text-muted-foreground">Nothing yet. Use these for supplier cash, change runs or tips paid out.</p>}
                {cur.movements.map((m) => (
                  <div key={m.id} className="flex justify-between gap-3">
                    <span>{m.reason} <span className="text-muted-foreground">· {m.by} · {when(m.created_at)}</span></span>
                    <span className={cn("font-mono", m.kind === "out" && "text-saffron-deep")}>{m.kind === "out" ? "−" : "+"}{fmt(m.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <section>
        <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Recent shifts</div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          {data.recent.length === 0 && <Empty>Closed shifts will show here with their over / short.</Empty>}
          {data.recent.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border/60 px-5 py-3.5 last:border-0">
              <div className="min-w-0">
                <div className="truncate font-medium">{when(r.opened_at)} → {r.closed_at ? when(r.closed_at) : ""}</div>
                <div className="text-xs text-muted-foreground">Expected {fmt(r.expected_cash)} · counted {fmt(r.counted_cash ?? 0)}{r.closed_by ? ` · ${r.closed_by}` : ""}</div>
              </div>
              <span className={cn("rounded-md px-2 py-0.5 font-mono text-sm font-semibold",
                !r.difference ? "bg-leaf/15 text-[oklch(0.45_0.12_150)]" : r.difference < 0 ? "bg-destructive/10 text-destructive" : "bg-saffron/20 text-saffron-deep")}>
                {!r.difference ? "Even" : `${r.difference > 0 ? "+" : "−"}${fmt(Math.abs(r.difference))}`}
              </span>
              <button onClick={() => printDrawer(r, s.tenant, fmt)} className="grid size-9 place-items-center rounded-lg bg-muted" aria-label="Print shift report"><Printer className="size-4" /></button>
            </div>
          ))}
        </div>
      </section>

      {move && <MoveDialog kind={move} onClose={() => setMove(null)} onDone={(d) => { setData(d); setMove(null); }} />}
      {closing && cur && <CloseDialog cur={cur} onClose={() => setClosing(false)} onDone={(d) => { setData(d); setClosing(false); }} />}
    </div>
  );
}

function Stat({ l, v, sub, hi }: { l: string; v: string; sub?: string; hi?: boolean }) {
  return (
    <div className={cn("rounded-2xl border p-5", hi ? "border-transparent bg-foreground text-background" : "border-border bg-card")}>
      <div className={cn("text-sm", hi ? "text-background/60" : "text-muted-foreground")}>{l}</div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular md:text-3xl">{v}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MoveDialog({ kind, onClose, onDone }: { kind: "in" | "out"; onClose: () => void; onDone: (d: Drawer) => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const presets = kind === "in" ? ["Change top-up", "Owner deposit"] : ["Supplier payment", "Tips paid out", "Petty cash", "Bank drop"];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const d = await run(api<Drawer>("/cash/movements", { body: { kind, amount: Number(amount), reason } }), kind === "in" ? "Paid in recorded" : "Paid out recorded");
    if (d) onDone(d);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="text-xl">{kind === "in" ? "Cash paid in" : "Cash paid out"}</DialogTitle>
            <DialogDescription>{kind === "in" ? "Money added to the drawer that isn't a sale." : "Money taken out of the drawer that isn't a refund."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2"><Label>Amount</Label><Input type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 font-mono text-lg" autoFocus /></div>
          <div className="space-y-2">
            <Label>Reason</Label>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button key={p} type="button" onClick={() => setReason(p)} className={cn("rounded-full px-3 py-1.5 text-sm ring-1 ring-border", reason === p ? "bg-foreground text-background" : "bg-card")}>{p}</button>
              ))}
            </div>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type a reason" className="h-10" maxLength={200} />
          </div>
          <button type="submit" disabled={!(Number(amount) > 0) || reason.trim().length < 2} className="h-12 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">Save</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({ cur, onClose, onDone }: { cur: Session; onClose: () => void; onDone: (d: Drawer) => void }) {
  const { s, fmt } = usePos();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const diff = (Number(counted) || 0) - cur.expected_cash;
  async function close(e: React.FormEvent) {
    e.preventDefault();
    const d = await run(api<Drawer & { closed: Session }>("/cash/close", { body: { counted_cash: Number(counted) || 0, note } }), "Drawer closed");
    if (d) { printDrawer(d.closed, s.tenant, fmt); onDone(d); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={close} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="text-xl">Close the drawer</DialogTitle>
            <DialogDescription>Count every note and coin in the drawer. Expected: {fmt(cur.expected_cash)}.</DialogDescription>
          </DialogHeader>
          <Input type="number" min={0} step="0.01" required value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Counted cash"
            className="h-14 text-center font-mono text-2xl" autoFocus />
          {counted !== "" && (
            <div className={cn("flex items-baseline justify-between rounded-2xl px-4 py-3",
              Math.abs(diff) < 0.005 ? "bg-leaf/15" : diff < 0 ? "bg-destructive/10 text-destructive" : "bg-saffron/15 text-saffron-deep")}>
              <span className="font-medium">{Math.abs(diff) < 0.005 ? "Drawer is even" : diff < 0 ? "Short" : "Over"}</span>
              <span className="font-mono text-xl font-semibold">{fmt(Math.abs(diff))}</span>
            </div>
          )}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-10" maxLength={1000} />
          <button type="submit" disabled={counted === ""} className="h-12 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">Close & print report</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
