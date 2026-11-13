"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRightLeft, Ban, Banknote, Check, ChefHat, CircleCheck, CreditCard, Gift, Merge, Minus, MoreHorizontal, Percent,
  Plus, Printer, QrCode, Search, Smartphone, Trash2, Users, Wallet,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, can } from "@/lib/api";
import { cn } from "@/lib/utils";
import { printKot } from "./print";
import { openDrawer, printOrder } from "./print-host";
import { Empty, Live, METHOD_LABEL, Seg, VegDot, orderTitle, payMethods, round2, run, usePoll, usePos } from "./shared";
import type { Category, KotPrint, Line, MenuItem, Order, TableRow } from "./types";

export type { Category, MenuItem, Order } from "./types";

const COMP_REASONS = ["Kitchen error", "Guest complaint", "Long wait", "Staff meal", "Manager comp"];
const DISCOUNT_REASONS = ["Loyal guest", "Staff meal", "Service recovery", "Promotion", "Manager special"];
const VOID_REASONS = ["Guest left", "Entered by mistake", "Test order", "Duplicate check"];

function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(o)}
          className={cn("rounded-full px-3 py-1.5 text-sm ring-1 ring-border transition", value === o ? "bg-foreground text-background ring-foreground" : "bg-card")}>{o}</button>
      ))}
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max = 99 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex w-fit items-center gap-3 rounded-2xl bg-card p-1.5 ring-1 ring-border">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="grid size-10 place-items-center rounded-xl bg-muted"><Minus className="size-4" /></button>
      <span className="w-8 text-center font-mono text-lg font-semibold">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} className="grid size-10 place-items-center rounded-xl bg-muted"><Plus className="size-4" /></button>
    </div>
  );
}

const big = "h-12 w-full rounded-xl font-semibold transition disabled:opacity-40";

export function OrderScreen() {
  const { s, fmt, go, orderId, payNow } = usePos();
  const { data: menu } = usePoll<Category[]>("/menu", 0, "menu");
  const [order, setOrder] = useState<Order | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [paying, setPaying] = useState(payNow);
  const [custom, setCustom] = useState<MenuItem | null>(null);
  const [line, setLine] = useState<Line | null>(null);
  const [dialog, setDialog] = useState<null | "discount" | "move" | "merge" | "guests" | "void" | "send">(null);
  const [more, setMore] = useState(false);
  const [course, setCourse] = useState(1);
  const [seat, setSeat] = useState(0);
  const ordersRev = useContext(Live).orders;

  useEffect(() => {
    if (!orderId) return;
    api<Order>(`/orders/${orderId}`).then(setOrder).catch((e) => toast.error(e.message));
  }, [orderId, ordersRev]); // refetch when another device changes checks

  useEffect(() => { if (menu && !cat) setCat(menu.find((c) => c.name === "Mains")?.id ?? menu[0]?.id ?? null); }, [menu, cat]);

  const items = useMemo(() => {
    if (!menu) return [];
    if (q) return menu.flatMap((c) => c.items).filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
    return menu.find((c) => c.id === cat)?.items ?? [];
  }, [menu, cat, q]);

  if (!orderId) return <Empty>Pick a table on the floor, or start a takeaway order.</Empty>;
  if (!order) return <Empty>Loading check…</Empty>;

  const open = order.status === "open";
  const qtyOf = (id: string) => order.items.filter((l) => l.menu_item_id === id).reduce((a, l) => a + l.qty, 0);
  const unsent = order.items.filter((l) => !l.sent).reduce((a, l) => a + l.qty, 0);
  const courses = [...new Set(order.items.map((l) => l.course))].sort();
  const seatCount = Math.max(order.guests || 0, 4, ...order.items.map((l) => l.seat));
  const canPay = can(s.user, "pay");
  const canDiscount = can(s.user, "discount");
  const title = orderTitle(order);

  async function add(m: MenuItem, extra?: { modifier_ids: string[]; qty: number; note: string }) {
    if (!m.available) return toast.error(`${m.name} is out of stock`);
    if (!extra && m.modifiers.length) return setCustom(m);
    const o = await run(api<Order>(`/orders/${order!.id}/items`, { body: { menu_item_id: m.id, course, seat, ...extra } }));
    if (o) { setOrder(o); setCustom(null); }
  }
  async function printCheck(o: Order, kind: "bill" | "receipt") {
    try {
      const p = await printOrder(o, s.tenant, fmt, kind); // null = printed through the browser dialog
      if (p) toast.success(`${kind === "bill" ? "Bill" : "Receipt"} sent to ${p} · ${title}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function sendKot(c?: number, lineIds?: string[]) {
    if (!unsent) return;
    const body = lineIds ? { line_ids: lineIds } : c ? { course: c } : null;
    const r = await run(api<KotPrint & { order: Order }>(`/orders/${order!.id}/kot`, body ? { body } : { method: "POST" }));
    if (!r) return;
    setOrder(r.order);
    setDialog(null);
    toast.success(`KOT ${r.kot_number} ${c ? `· course ${c} fired` : `· ${r.items.reduce((a, i) => a + i.qty, 0)} items sent`} · ${title}`);
    if (s.tenant?.auto_print_kot && !r.kitchen_printers) printKot(r, title);
  }

  if (paying && canPay && open) return <PayPanel order={order} title={title} onBack={() => setPaying(false)} onUpdate={setOrder} onDone={() => go("floor")} />;

  const actions = [
    { k: "guests", l: "Guests & customer", icon: Users, show: true },
    { k: "move", l: order.table ? "Move to table" : "Seat at a table", icon: ArrowRightLeft, show: true },
    { k: "merge", l: "Merge another check", icon: Merge, show: true },
    { k: "discount", l: "Discount", icon: Percent, show: canDiscount },
    { k: "print", l: "Print bill", icon: Printer, show: order.items.length > 0 },
    { k: "void", l: "Void check", icon: Ban, show: canPay && !order.paid },
  ] as const;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[1fr_420px]">
      {/* Menu */}
      <section className="flex min-h-0 flex-col gap-4 overflow-hidden p-5 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => go("floor")} className="flex items-center gap-1.5 rounded-xl bg-card px-3 py-2 text-sm font-medium ring-1 ring-border">
            <ArrowLeft className="size-4" />Floor
          </button>
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes" className="h-10 rounded-xl bg-card pl-9" />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {menu?.map((c) => (
            <button key={c.id} onClick={() => { setCat(c.id); setQ(""); }}
              className={cn("shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium transition",
                cat === c.id && !q ? "bg-foreground text-background" : "bg-card text-[#5d5a53] ring-1 ring-border")}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto pb-4 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((m) => {
            const n = qtyOf(m.id);
            return (
              <button key={m.id} onClick={() => open && add(m)} disabled={!m.available || !open}
                className={cn("relative flex min-h-28 flex-col rounded-2xl border bg-card p-4 text-left transition active:scale-[0.98]",
                  n ? "border-foreground" : "border-border hover:border-foreground/30", !m.available && "opacity-45")}>
                <div className="flex items-start gap-2"><VegDot veg={m.is_veg} /><span className="text-[14.5px] font-medium leading-snug">{m.name}</span></div>
                <div className="mt-auto flex items-end justify-between pt-3">
                  <span className="font-mono text-sm text-muted-foreground">
                    {m.available ? fmt(m.price) : "86'd"}
                    {m.modifiers.length > 0 && m.available && <span className="ml-1.5 font-sans text-[11px] text-saffron-deep">+ options</span>}
                  </span>
                  {n > 0 && <span className="grid size-7 place-items-center rounded-full bg-foreground font-mono text-xs font-semibold text-background">{n}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Ticket */}
      <aside className="flex min-h-0 flex-col border-t border-border bg-card lg:border-l lg:border-t-0">
        <div className="relative flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <button onClick={() => open && setDialog("guests")} className="min-w-0 text-left">
            <div className="truncate text-lg font-semibold">{title}</div>
            <div className="truncate text-xs text-muted-foreground">
              Check #{order.number} · {order.items.reduce((a, l) => a + l.qty, 0)} items
              {order.guests ? ` · ${order.guests} guests` : ""}{order.customer_phone ? ` · ${order.customer_phone}` : ""}
            </div>
          </button>
          {open && (
            <button onClick={() => setMore((v) => !v)} className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted" aria-label="Check actions">
              <MoreHorizontal className="size-5" />
            </button>
          )}
          {more && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMore(false)} />
              <div className="absolute right-4 top-16 z-40 w-56 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-xl">
                {actions.filter((a) => a.show).map(({ k, l, icon: Icon }) => (
                  <button key={k} onClick={() => {
                    setMore(false);
                    if (k === "print") void printCheck(order, "bill");
                    else setDialog(k);
                  }} className={cn("flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-muted", k === "void" && "text-destructive")}>
                    <Icon className="size-4" />{l}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {open && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-2.5 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Course</span>
              {[1, 2, 3].map((c) => (
                <button key={c} onClick={() => setCourse(c)} className={cn("grid size-7 place-items-center rounded-lg font-mono font-semibold", course === c ? "bg-foreground text-background" : "bg-muted")}>{c}</button>
              ))}
            </div>
            <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
              <span className="text-muted-foreground">Seat</span>
              <button onClick={() => setSeat(0)} className={cn("h-7 rounded-lg px-2 font-semibold", seat === 0 ? "bg-foreground text-background" : "bg-muted")}>All</button>
              {Array.from({ length: seatCount }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setSeat(n)} className={cn("grid size-7 shrink-0 place-items-center rounded-lg font-mono font-semibold", seat === n ? "bg-foreground text-background" : "bg-muted")}>{n}</button>
              ))}
            </div>
          </div>
        )}
        <div className="min-h-32 flex-1 overflow-y-auto px-5">
          {order.items.length === 0 ? (
            <Empty>Tap dishes on the left to add them to this check. New items go to course {course}{seat ? `, seat ${seat}` : ""}.</Empty>
          ) : (
            courses.map((c) => {
              const lines = order.items.filter((l) => l.course === c);
              const waiting = lines.filter((l) => !l.sent).reduce((a, l) => a + l.qty, 0);
              const fired = lines.some((l) => l.sent);
              return (
                <div key={c}>
                  {courses.length > 1 && (
                    <div className="flex items-center justify-between pb-1 pt-3">
                      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Course {c}{fired && !waiting ? " · fired" : waiting && !fired ? " · held" : ""}</span>
                      {open && waiting > 0 && (
                        <button onClick={() => sendKot(c)} className="flex items-center gap-1 rounded-lg bg-saffron/20 px-2.5 py-1 text-xs font-semibold text-saffron-deep">
                          <ChefHat className="size-3.5" />Fire course {c} · {waiting}
                        </button>
                      )}
                    </div>
                  )}
                  {lines.map((l) => (
              <button key={l.id} onClick={() => open && setLine(l)} className={cn("flex w-full items-start gap-3 border-b border-border/60 py-3 text-left", l.sent && "opacity-70")}>
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted font-mono text-xs font-semibold">{l.qty}</span>
                <div className="min-w-0 flex-1">
                  <div className={cn("text-[14.5px] font-medium", l.comp_reason && "line-through decoration-muted-foreground/60")}>
                    {l.name}{l.seat > 0 && <span className="ml-1.5 rounded bg-muted px-1 font-mono text-[11px] font-semibold text-muted-foreground">S{l.seat}</span>}{l.source === "guest" && <span className="ml-1.5 rounded bg-sky/15 px-1.5 text-[11px] font-semibold text-sky" title="Ordered by the guest from the table QR code">Guest</span>}
                  </div>
                  {l.modifiers.length > 0 && <div className="text-xs text-saffron-deep">{l.modifiers.map((m) => m.name).join(" · ")}</div>}
                  {l.note && <div className="text-xs italic text-muted-foreground">“{l.note}”</div>}
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px]">
                    <span className={l.sent ? "text-muted-foreground" : "font-medium text-sky"}>{l.sent ? "In kitchen" : "Not sent"}</span>
                    {l.comp_reason && <span className="rounded bg-saffron/20 px-1.5 font-medium text-saffron-deep">Comp · {l.comp_reason}</span>}
                    {l.paid && <span className="rounded bg-leaf/15 px-1.5 font-medium text-[oklch(0.45_0.12_150)]">Paid</span>}
                  </div>
                </div>
                <span className="w-20 text-right font-mono text-sm tabular">{l.comp_reason ? "—" : fmt(l.line_total)}</span>
              </button>
                  ))}
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-1.5 border-t border-border px-5 py-4 text-sm">
          <Row l="Subtotal" v={fmt(order.subtotal)} />
          {order.discount.amount > 0 && <Row l={`Discount · ${order.discount.kind === "percent" ? `${order.discount.value}%` : "fixed"} · ${order.discount.reason}`} v={`−${fmt(order.discount.amount)}`} accent />}
          <Row l={s.tenant?.tax_label || "Tax"} v={fmt(order.tax)} />
          {order.paid > 0 && <Row l="Paid so far" v={`−${fmt(order.paid)}`} />}
          <div className="flex items-baseline justify-between pt-1.5">
            <span className="font-semibold">{order.paid > 0 ? "Balance due" : "Total"}</span>
            <span className="font-mono text-2xl font-semibold tabular">{fmt(order.balance)}</span>
          </div>
        </div>
        {open ? (
          <div className="grid grid-cols-2 gap-2.5 px-5 pb-5">
            <button onClick={() => (order.items.filter((l) => !l.sent).length > 1 ? setDialog("send") : sendKot())} disabled={!unsent}
              className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-muted font-semibold transition disabled:opacity-35">
              <ChefHat className="size-5" />{unsent ? `Send KOT · ${unsent}` : "Nothing to send"}
            </button>
            <button disabled={!order.items.length}
              onClick={() => (canPay ? setPaying(true) : void printCheck(order, "bill"))}
              className="h-14 rounded-2xl bg-foreground font-semibold text-background transition disabled:opacity-35">
              {canPay ? `Pay ${fmt(order.balance)}` : "Print bill"}
            </button>
          </div>
        ) : (
          <div className="px-5 pb-5 text-center text-sm text-muted-foreground">This check is {order.status}.</div>
        )}
      </aside>

      {custom && <ModifierDialog item={custom} onClose={() => setCustom(null)} onAdd={(x) => add(custom, x)} />}
      {line && <LineDialog order={order} line={line} seats={seatCount} canDiscount={canDiscount} onClose={() => setLine(null)} onUpdate={(o) => { setOrder(o); setLine(null); }} />}
      {dialog === "discount" && <DiscountDialog order={order} onClose={() => setDialog(null)} onUpdate={(o) => { setOrder(o); setDialog(null); }} />}
      {dialog === "guests" && <GuestsDialog order={order} onClose={() => setDialog(null)} onUpdate={(o) => { setOrder(o); setDialog(null); }} />}
      {(dialog === "move" || dialog === "merge") && (
        <TablePicker mode={dialog} order={order} onClose={() => setDialog(null)} onUpdate={(o) => { setOrder(o); setDialog(null); }} />
      )}
      {dialog === "send" && <SendDialog order={order} onClose={() => setDialog(null)} onSend={(ids) => sendKot(undefined, ids)} />}
      {dialog === "void" && <VoidDialog order={order} title={title} onClose={() => setDialog(null)} onDone={() => go("floor")} />}
    </div>
  );
}

function Row({ l, v, accent }: { l: string; v: string; accent?: boolean }) {
  return <div className={cn("flex justify-between gap-3", accent ? "text-saffron-deep" : "text-muted-foreground")}><span className="truncate">{l}</span><span className="font-mono">{v}</span></div>;
}

/* ---------- Modifiers ---------- */

function ModifierDialog({ item, onClose, onAdd }: { item: MenuItem; onClose: () => void; onAdd: (x: { modifier_ids: string[]; qty: number; note: string }) => void }) {
  const { fmt } = usePos();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  function toggle(gid: string, oid: string) {
    const g = item.modifiers.find((x) => x.id === gid)!;
    const next = new Set(picked);
    if (g.max === 1) {
      g.options.forEach((o) => next.delete(o.id));
      if (!picked.has(oid)) next.add(oid);
    } else if (next.has(oid)) next.delete(oid);
    else if (!g.max || g.options.filter((o) => next.has(o.id)).length < g.max) next.add(oid);
    else return toast.error(`Pick up to ${g.max} for ${g.name.toLowerCase()}`);
    setPicked(next);
  }

  const missing = item.modifiers.filter((g) => g.options.filter((o) => picked.has(o.id)).length < g.min);
  const unit = item.price + item.modifiers.flatMap((g) => g.options).filter((o) => picked.has(o.id)).reduce((a, o) => a + o.price, 0);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">{item.name}</DialogTitle>
          <DialogDescription>{fmt(item.price)} · choose options</DialogDescription>
        </DialogHeader>
        {item.modifiers.map((g) => {
          const n = g.options.filter((o) => picked.has(o.id)).length;
          return (
            <div key={g.id}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-medium">{g.name}</span>
                <span className={cn("text-xs", n < g.min ? "font-semibold text-saffron-deep" : "text-muted-foreground")}>
                  {g.min ? (g.max === 1 ? "Required" : `Pick at least ${g.min}`) : g.max ? `Optional · up to ${g.max}` : "Optional"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.options.map((o) => (
                  <button key={o.id} type="button" onClick={() => toggle(g.id, o.id)}
                    className={cn("flex min-h-14 flex-col items-start justify-center rounded-xl px-3 py-2 text-left ring-1 ring-border transition",
                      picked.has(o.id) ? "bg-foreground text-background ring-foreground" : "bg-card")}>
                    <span className="text-sm font-medium">{o.name}</span>
                    {o.price > 0 && <span className="font-mono text-xs opacity-70">+{fmt(o.price)}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="space-y-2">
          <Label>Note for the kitchen</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. no onion, sauce on the side" maxLength={200} className="h-10" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Stepper value={qty} onChange={setQty} min={1} />
          <button disabled={missing.length > 0} onClick={() => onAdd({ modifier_ids: [...picked], qty, note })}
            className="h-12 flex-1 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">
            {missing.length ? `Choose ${missing[0].name.toLowerCase()}` : `Add · ${fmt(unit * qty)}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Line actions ---------- */

function LineDialog({ order, line, seats, canDiscount, onClose, onUpdate }: {
  order: Order; line: Line; seats: number; canDiscount: boolean; onClose: () => void; onUpdate: (o: Order) => void;
}) {
  const { fmt } = usePos();
  const [qty, setQty] = useState(line.qty);
  const [note, setNote] = useState(line.note);
  const [seat, setSeat] = useState(line.seat);
  const [course, setCourse] = useState(line.course);
  const [reason, setReason] = useState("");

  async function save() {
    const body: Record<string, unknown> = {};
    if (qty !== line.qty) body.qty = qty;
    if (!line.sent && note !== line.note) body.note = note;
    if (seat !== line.seat) body.seat = seat;
    if (!line.sent && course !== line.course) body.course = course;
    if (!Object.keys(body).length) return onClose();
    const o = await run(api<Order>(`/orders/${order.id}/items/${line.id}`, { method: "PATCH", body }));
    if (o) onUpdate(o);
  }
  async function remove() {
    const o = await run(api<Order>(`/orders/${order.id}/items/${line.id}`, { method: "PATCH", body: { qty: 0 } }), `${line.name} removed`);
    if (o) onUpdate(o);
  }
  async function comp(r: string) {
    const o = await run(api<Order>(`/orders/${order.id}/items/${line.id}/comp`, { body: { reason: r } }), r ? `${line.name} comped` : "Comp removed");
    if (o) onUpdate(o);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{line.name}</DialogTitle>
          <DialogDescription>
            {fmt(line.unit_price)} each{line.modifiers.length ? ` · ${line.modifiers.map((m) => m.name).join(", ")}` : ""}{line.sent ? " · already in the kitchen" : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between"><Label>Quantity</Label><Stepper value={qty} onChange={setQty} min={1} /></div>
        <div className="space-y-2">
          <Label>Seat</Label>
          <div className="flex flex-wrap gap-1.5">
            {[0, ...Array.from({ length: seats + 1 }, (_, i) => i + 1)].map((n) => (
              <button key={n} type="button" onClick={() => setSeat(n)}
                className={cn("h-9 min-w-9 rounded-lg px-2 font-mono text-sm font-semibold ring-1 ring-border", seat === n ? "bg-foreground text-background ring-foreground" : "bg-card")}>{n || "Table"}</button>
            ))}
          </div>
        </div>
        {!line.sent && (
          <div className="flex items-center justify-between">
            <Label>Course</Label>
            <div className="flex gap-1.5">
              {[1, 2, 3, 4].map((c) => (
                <button key={c} type="button" onClick={() => setCourse(c)}
                  className={cn("size-9 rounded-lg font-mono font-semibold ring-1 ring-border", course === c ? "bg-foreground text-background ring-foreground" : "bg-card")}>{c}</button>
              ))}
            </div>
          </div>
        )}
        {!line.sent && (
          <div className="space-y-2">
            <Label>Note for the kitchen</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. no onion" maxLength={200} className="h-10" />
          </div>
        )}
        {canDiscount && (
          <div className="space-y-2 rounded-2xl bg-muted/60 p-4">
            <div className="flex items-center gap-2 font-medium"><Gift className="size-4" />Comp this item</div>
            {line.comp_reason ? (
              <div className="flex items-center justify-between text-sm">
                <span>Comped · {line.comp_reason}</span>
                <button onClick={() => comp("")} className="rounded-lg bg-card px-3 py-1.5 font-medium ring-1 ring-border">Remove comp</button>
              </div>
            ) : (
              <>
                <Chips options={COMP_REASONS} value={reason} onChange={setReason} />
                <button disabled={!reason} onClick={() => comp(reason)} className="mt-1 h-10 w-full rounded-xl bg-card text-sm font-semibold ring-1 ring-border disabled:opacity-40">
                  Comp {fmt(line.unit_price * line.qty)}
                </button>
              </>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={remove} className="grid size-12 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive" aria-label="Remove item"><Trash2 className="size-4" /></button>
          <button onClick={save} className={cn(big, "bg-foreground text-background")}>Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Discount ---------- */

function DiscountDialog({ order, onClose, onUpdate }: { order: Order; onClose: () => void; onUpdate: (o: Order) => void }) {
  const { fmt } = usePos();
  const [kind, setKind] = useState<"percent" | "amount">(order.discount.kind === "amount" ? "amount" : "percent");
  const [value, setValue] = useState(order.discount.kind ? String(order.discount.value) : "10");
  const [reason, setReason] = useState(order.discount.reason);
  const v = Number(value) || 0;
  const preview = kind === "percent" ? order.subtotal * v / 100 : Math.min(v, order.subtotal);

  async function apply(k: "" | "percent" | "amount") {
    const o = await run(api<Order>(`/orders/${order.id}/discount`, { body: { kind: k, value: k ? v : 0, reason: k ? reason : "" } }),
      k ? "Discount applied" : "Discount removed");
    if (o) onUpdate(o);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Discount the check</DialogTitle>
          <DialogDescription>Applied before tax on a subtotal of {fmt(order.subtotal)}.</DialogDescription>
        </DialogHeader>
        <Seg value={kind} onChange={setKind} options={[["percent", "Percent"], ["amount", "Fixed amount"]]} />
        {kind === "percent" && (
          <div className="flex flex-wrap gap-2">
            {[5, 10, 15, 20, 25, 50].map((p) => (
              <button key={p} type="button" onClick={() => setValue(String(p))}
                className={cn("h-11 min-w-14 rounded-xl px-3 font-semibold ring-1 ring-border", v === p ? "bg-foreground text-background" : "bg-card")}>{p}%</button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <Label>{kind === "percent" ? "Percent off" : "Amount off"}</Label>
          <Input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className="h-11 font-mono text-lg" />
        </div>
        <div className="space-y-2"><Label>Reason</Label><Chips options={DISCOUNT_REASONS} value={reason} onChange={setReason} /></div>
        <div className="flex gap-2">
          {order.discount.kind && <button onClick={() => apply("")} className={cn(big, "w-auto bg-muted px-4")}>Remove</button>}
          <button disabled={!reason || v <= 0} onClick={() => apply(kind)} className={cn(big, "bg-foreground text-background")}>Apply −{fmt(preview)}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Guests & customer ---------- */

function GuestsDialog({ order, onClose, onUpdate }: { order: Order; onClose: () => void; onUpdate: (o: Order) => void }) {
  const [guests, setGuests] = useState(order.guests);
  const [name, setName] = useState(order.customer_name);
  const [phone, setPhone] = useState(order.customer_phone);
  async function save() {
    const o = await run(api<Order>(`/orders/${order.id}`, { method: "PATCH", body: { guests, customer_name: name, customer_phone: phone } }));
    if (o) onUpdate(o);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader><DialogTitle className="text-xl">Guests & customer</DialogTitle></DialogHeader>
        <div className="flex items-center justify-between"><Label>Guests</Label><Stepper value={guests} onChange={setGuests} /></div>
        <div className="space-y-2"><Label>Customer name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="h-10" maxLength={120} /></div>
        <div className="space-y-2"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="h-10" maxLength={40} /></div>
        <button onClick={save} className={cn(big, "bg-foreground text-background")}>Save</button>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Move / merge ---------- */

function TablePicker({ mode, order, onClose, onUpdate }: { mode: "move" | "merge"; order: Order; onClose: () => void; onUpdate: (o: Order) => void }) {
  const { fmt } = usePos();
  const { data: tables } = usePoll<TableRow[]>("/tables", 0, "floor");
  const { data: counter } = usePoll<Order[]>(mode === "merge" ? "/orders/open?channel=takeaway" : null, 0);
  const free = (tables ?? []).filter((t) => t.state === "free" && !t.order_id);
  const others = [
    ...(tables ?? []).filter((t) => t.order_id && t.order_id !== order.id).map((t) => ({ id: t.order_id!, label: t.name, sub: `${t.items} items · ${fmt(t.total)}` })),
    ...(counter ?? []).filter((o) => o.id !== order.id).map((o) => ({ id: o.id, label: orderTitle(o), sub: `${o.items.length} lines · ${fmt(o.due)}` })),
  ];

  async function pick(id: string) {
    const o = mode === "move"
      ? await run(api<Order>(`/orders/${order.id}/move`, { body: { table_id: id } }), "Check moved")
      : await run(api<Order>(`/orders/${order.id}/merge`, { body: { source_order_id: id } }), "Checks merged");
    if (o) onUpdate(o);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">{mode === "move" ? "Move to a free table" : "Merge a check into this one"}</DialogTitle>
          <DialogDescription>{mode === "move" ? "The whole check moves, including items already in the kitchen." : "Every item from the check you pick moves onto this check."}</DialogDescription>
        </DialogHeader>
        {mode === "move" ? (
          free.length ? (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {free.map((t) => (
                <button key={t.id} onClick={() => pick(t.id)} className="flex h-20 flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed border-[#c9c5bc] bg-card hover:border-foreground">
                  <span className="text-lg font-semibold">{t.name}</span><span className="text-xs text-muted-foreground">{t.seats} seats</span>
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No free tables right now.</p>
        ) : others.length ? (
          <div className="space-y-2">
            {others.map((o) => (
              <button key={o.id} onClick={() => pick(o.id)} className="flex w-full items-center justify-between rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border hover:ring-foreground">
                <span className="font-semibold">{o.label}</span><span className="text-sm text-muted-foreground">{o.sub}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No other open checks.</p>}
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Send to kitchen ---------- */

function SendDialog({ order, onClose, onSend }: { order: Order; onClose: () => void; onSend: (ids: string[]) => void }) {
  const lines = order.items.filter((l) => !l.sent);
  const [picked, setPicked] = useState<Set<string>>(new Set(lines.map((l) => l.id)));
  const courses = [...new Set(lines.map((l) => l.course))].sort();
  const count = lines.filter((l) => picked.has(l.id)).reduce((a, l) => a + l.qty, 0);
  const flip = (ids: string[], on: boolean) => setPicked((p) => { const n = new Set(p); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Send to kitchen</DialogTitle>
          <DialogDescription>Untick anything you want to hold back. It stays on the check as not sent.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 text-sm">
          <button onClick={() => flip(lines.map((l) => l.id), true)} className="rounded-lg bg-muted px-3 py-1.5 font-medium">Select all</button>
          <button onClick={() => flip(lines.map((l) => l.id), false)} className="rounded-lg bg-muted px-3 py-1.5 font-medium">Clear</button>
        </div>
        {courses.map((c) => {
          const group = lines.filter((l) => l.course === c);
          const all = group.every((l) => picked.has(l.id));
          return (
            <div key={c} className="space-y-1.5">
              {courses.length > 1 && (
                <button onClick={() => flip(group.map((l) => l.id), !all)} className="flex w-full items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  Course {c}<span className="normal-case tracking-normal">{all ? "Untick course" : "Tick course"}</span>
                </button>
              )}
              {group.map((l) => {
                const on = picked.has(l.id);
                return (
                  <button key={l.id} onClick={() => flip([l.id], !on)}
                    className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition", on ? "bg-card ring-foreground" : "bg-muted/40 ring-border opacity-60")}>
                    <span className={cn("grid size-5 shrink-0 place-items-center rounded-md border", on ? "border-foreground bg-foreground text-background" : "border-border")}>{on && <Check className="size-3.5" />}</span>
                    <span className="font-mono text-sm font-semibold">{l.qty}×</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{l.name}{l.seat > 0 && <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">S{l.seat}</span>}</span>
                      {(l.modifiers.length > 0 || l.note) && <span className="block truncate text-xs text-muted-foreground">{[...l.modifiers.map((m) => m.name), l.note && `“${l.note}”`].filter(Boolean).join(" · ")}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        <button disabled={!count} onClick={() => onSend(lines.filter((l) => picked.has(l.id)).map((l) => l.id))}
          className={cn(big, "flex items-center justify-center gap-2 bg-foreground text-background")}>
          <ChefHat className="size-5" />{count ? `Send ${count} item${count === 1 ? "" : "s"}` : "Pick items to send"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Void ---------- */

function VoidDialog({ order, title, onClose, onDone }: { order: Order; title: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  async function voidIt() {
    if (await run(api(`/orders/${order.id}/void`, { body: { reason } }), `${title} voided`)) onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Void {title}?</DialogTitle>
          <DialogDescription>The check closes with no payment. Items already fired need a manager.</DialogDescription>
        </DialogHeader>
        <Chips options={VOID_REASONS} value={reason} onChange={setReason} />
        <button disabled={!reason} onClick={voidIt} className={cn(big, "bg-destructive text-white")}>Void check</button>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Payments ---------- */

const METHOD_ICON: Record<string, React.ComponentType<{ className?: string }>> = { cash: Banknote, card: CreditCard, upi: QrCode, tap: Smartphone, other: Wallet };

function quickCash(total: number, currency?: string) {
  const steps = currency === "INR" ? [10, 50, 100, 500] : [1, 5, 10, 20];
  const out = new Set<number>();
  for (const st of steps) {
    const v = Math.ceil(total / st) * st;
    if (v > total + 0.001) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

function PayPanel({ order, title, onBack, onUpdate, onDone }: {
  order: Order; title: string; onBack: () => void; onUpdate: (o: Order) => void; onDone: () => void;
}) {
  const { s, fmt } = usePos();
  const tipsOn = !!s.tenant?.tips_enabled;
  const methods = payMethods(s.tenant);
  const [mode, setMode] = useState<"full" | "equal" | "seat" | "items" | "custom">("full");
  const [paySeat, setPaySeat] = useState<number | null>(null);
  const [parts, setParts] = useState(2);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState(methods[0]);
  const [tipPct, setTipPct] = useState(0);
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Order | null>(null);

  const unpaid = order.items.filter((l) => !l.paid && !l.comp_reason);
  const seatsUsed = order.items.some((l) => l.seat > 0) ? [...new Set(order.items.map((l) => l.seat))].sort((a, b) => a - b) : [];
  const ratio = order.subtotal ? order.due / order.subtotal : 1;
  let amount = order.balance;
  if (mode === "equal") {
    amount = Math.min(order.balance, round2(order.due / parts));
    if (order.balance - amount < 0.05) amount = order.balance;
  } else if (mode === "items" || mode === "seat") {
    const allSel = unpaid.length > 0 && unpaid.every((l) => sel.has(l.id));
    amount = allSel ? order.balance : Math.min(order.balance, round2(unpaid.filter((l) => sel.has(l.id)).reduce((a, l) => a + l.line_total, 0) * ratio));
  } else if (mode === "custom") {
    amount = round2(Number(custom) || 0);
  }
  const tip = tipsOn ? round2(amount * tipPct) : 0;
  const charge = round2(amount + tip);
  const cash = Number(tendered) || 0;
  const change = method === "cash" && cash ? round2(cash - charge) : 0;
  const invalid = amount <= 0 || amount > order.balance + 0.005 || (method === "cash" && cash > 0 && cash < charge);

  async function complete() {
    setBusy(true);
    const r = await run(api<Order>(`/orders/${order.id}/payments`, {
      body: { method, amount, tip, tendered: method === "cash" ? cash : 0, line_ids: mode === "items" || mode === "seat" ? [...sel] : [] },
    }));
    setBusy(false);
    if (!r) return;
    setTendered(""); setCustom(""); setSel(new Set()); setTipPct(0);
    if (r.status === "paid") {
      setDone(r);
      if (s.tenant?.auto_print_receipt) void run(printOrder(r, s.tenant, fmt, "receipt", { drawer: method === "cash" }));
      else if (method === "cash") void openDrawer(s.tenant);
    } else {
      if (method === "cash") void openDrawer(s.tenant);
      onUpdate(r);
      toast.success(`${fmt(charge)} by ${METHOD_LABEL[method]} · ${fmt(r.balance)} left`);
    }
  }

  if (done) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="w-full max-w-md text-center">
          <CircleCheck className="mx-auto size-16 text-leaf" strokeWidth={1.5} />
          <div className="mt-4 text-3xl font-semibold">{title} paid</div>
          <div className="mt-1 text-muted-foreground">{fmt(done.due + done.tip)} · {METHOD_LABEL[done.payment_method] ?? done.payment_method}</div>
          {!!done.change && (
            <div className="mt-6 rounded-3xl bg-saffron/15 p-6">
              <div className="text-sm text-saffron-deep">Change due</div>
              <div className="font-mono text-5xl font-semibold">{fmt(done.change)}</div>
            </div>
          )}
          <div className="mt-8 grid grid-cols-2 gap-3">
            <button onClick={() => void run(printOrder(done, s.tenant, fmt)).then((p) => p && toast.success(`Receipt sent to ${p}`))} className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-card font-semibold ring-1 ring-border">
              <Printer className="size-5" />Receipt
            </button>
            <button onClick={onDone} className="h-14 rounded-2xl bg-foreground font-semibold text-background">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 overflow-y-auto lg:grid-cols-[1fr_420px]">
      <section className="flex flex-col gap-6 p-6 md:p-8">
        <button onClick={onBack} className="flex w-fit items-center gap-1.5 rounded-xl bg-card px-3 py-2 text-sm font-medium ring-1 ring-border">
          <ArrowLeft className="size-4" />Back to check
        </button>
        <div>
          <div className="text-sm text-muted-foreground">{order.paid ? "Balance due" : "Amount due"} · {title}</div>
          <div className="mt-1 font-mono text-5xl font-semibold tracking-tight tabular md:text-6xl">{fmt(order.balance)}</div>
          {order.paid > 0 && <div className="mt-1 text-sm text-muted-foreground">{fmt(order.paid)} of {fmt(order.due)} paid</div>}
        </div>

        <div>
          <div className="mb-2.5 text-sm font-medium">How is this being paid?</div>
          <div className="overflow-x-auto">
            <Seg value={mode} onChange={(m) => { setMode(m); setSel(new Set()); setPaySeat(null); }}
              options={[["full", "Full balance"], ["equal", "Split evenly"], ...(seatsUsed.length ? [["seat", "By seat"] as ["seat", string]] : []), ["items", "By item"], ["custom", "Custom"]]} />
          </div>
          <div className="mt-4">
            {mode === "equal" && (
              <div className="flex flex-wrap items-center gap-4">
                <Stepper value={parts} onChange={setParts} min={2} max={20} />
                <span className="text-sm text-muted-foreground">{parts} guests · {fmt(round2(order.due / parts))} each</span>
              </div>
            )}
            {mode === "seat" && (
              <div className="flex flex-wrap gap-2">
                {seatsUsed.map((n) => {
                  const lines = unpaid.filter((l) => l.seat === n);
                  return (
                    <button key={n} disabled={!lines.length} onClick={() => { setPaySeat(n); setSel(new Set(lines.map((l) => l.id))); }}
                      className={cn("flex h-16 min-w-24 flex-col items-center justify-center rounded-2xl px-4 ring-1 ring-border disabled:opacity-35",
                        paySeat === n ? "bg-foreground text-background ring-foreground" : "bg-card")}>
                      <span className="font-semibold">{n ? `Seat ${n}` : "Shared"}</span>
                      <span className="font-mono text-xs opacity-70">{lines.length ? fmt(round2(lines.reduce((a, l) => a + l.line_total, 0) * ratio)) : "paid"}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {mode === "items" && (
              unpaid.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {unpaid.map((l) => (
                    <button key={l.id} onClick={() => { const n = new Set(sel); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); setSel(n); }}
                      className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-border", sel.has(l.id) ? "bg-foreground text-background ring-foreground" : "bg-card")}>
                      <span className={cn("grid size-5 place-items-center rounded-md border", sel.has(l.id) ? "border-background bg-background text-foreground" : "border-border")}>{sel.has(l.id) && <Check className="size-3.5" />}</span>
                      <span className="flex-1 truncate text-sm">{l.qty} × {l.name}</span>
                      <span className="font-mono text-sm">{fmt(l.line_total * ratio)}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">Every item is already paid for. Use Full balance.</p>
            )}
            {mode === "custom" && (
              <Input type="number" min={0} step="0.01" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={order.balance.toFixed(2)} className="h-12 max-w-56 font-mono text-lg" />
            )}
          </div>
        </div>

        {tipsOn && (
          <div>
            <div className="mb-2.5 text-sm font-medium">Tip</div>
            <div className="grid grid-cols-4 gap-2.5">
              {[0, 0.15, 0.18, 0.2].map((p) => (
                <button key={p} onClick={() => setTipPct(p)}
                  className={cn("h-14 rounded-2xl text-[15px] font-semibold ring-1 ring-border", tipPct === p ? "bg-foreground text-background" : "bg-card")}>
                  {p ? `${Math.round(p * 100)}%` : "No tip"}
                  {p > 0 && amount > 0 && <span className="block font-mono text-[11px] font-normal opacity-70">{fmt(round2(amount * p))}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-2.5 text-sm font-medium">Payment method</div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {methods.map((k) => {
              const Icon = METHOD_ICON[k] ?? Wallet;
              return (
                <button key={k} onClick={() => setMethod(k)}
                  className={cn("flex h-20 flex-col items-center justify-center gap-1.5 rounded-2xl font-semibold ring-1 ring-border", method === k ? "bg-foreground text-background" : "bg-card")}>
                  <Icon className="size-5" />{METHOD_LABEL[k]}
                </button>
              );
            })}
          </div>
          {method === "cash" && (
            <div className="mt-4 space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
              <div className="text-sm font-medium">Cash received</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setTendered(charge.toFixed(2))} className="h-11 rounded-xl bg-muted px-4 font-semibold">Exact</button>
                {quickCash(charge, s.tenant?.currency).map((v) => (
                  <button key={v} onClick={() => setTendered(String(v))} className="h-11 rounded-xl bg-muted px-4 font-mono font-semibold">{fmt(v)}</button>
                ))}
                <Input type="number" min={0} step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="Other" className="h-11 w-32 font-mono" />
              </div>
              {cash > 0 && (
                <div className={cn("flex items-baseline justify-between", change < 0 && "text-destructive")}>
                  <span className="font-medium">{change < 0 ? "Not enough cash" : "Change"}</span>
                  <span className="font-mono text-2xl font-semibold">{fmt(Math.abs(change))}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="flex flex-col border-t border-border bg-card p-6 lg:border-l lg:border-t-0">
        <div className="text-lg font-semibold">Check #{order.number}</div>
        <div className="mt-3 flex-1 space-y-2 overflow-y-auto text-sm">
          {order.items.map((l) => (
            <div key={l.id} className={cn("flex justify-between gap-3", l.paid && "text-muted-foreground line-through")}>
              <span>{l.qty} × {l.name}{l.modifiers.length ? <span className="block text-xs text-muted-foreground">{l.modifiers.map((m) => m.name).join(" · ")}</span> : null}</span>
              <span className="font-mono">{l.comp_reason ? "comp" : fmt(l.line_total)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-1.5 border-t border-dashed border-border pt-4 text-sm">
          <Row l="Subtotal" v={fmt(order.subtotal)} />
          {order.discount.amount > 0 && <Row l={`Discount · ${order.discount.reason}`} v={`−${fmt(order.discount.amount)}`} accent />}
          <Row l={s.tenant?.tax_label || "Tax"} v={fmt(order.tax)} />
          {order.payments.filter((p) => p.kind === "payment").map((p) => (
            <Row key={p.id} l={`Paid · ${METHOD_LABEL[p.method] ?? p.method}${p.tip ? ` (+${fmt(p.tip)} tip)` : ""}`} v={`−${fmt(p.amount)}`} />
          ))}
          <div className="flex justify-between pt-1 text-base font-semibold"><span>This payment</span><span className="font-mono">{fmt(charge)}</span></div>
          {tip > 0 && <div className="text-right text-xs text-muted-foreground">includes {fmt(tip)} tip</div>}
        </div>
        <button onClick={complete} disabled={busy || invalid}
          className="mt-5 h-16 rounded-2xl bg-leaf text-lg font-semibold text-white transition hover:bg-leaf/90 disabled:opacity-40">
          {amount >= order.balance - 0.005 ? `Charge ${fmt(charge)} & close` : `Charge ${fmt(charge)}`}
        </button>
      </aside>
    </div>
  );
}
