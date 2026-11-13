"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, money, type Session, type Tenant } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Screen = "floor" | "order" | "orders" | "cash" | "online" | "kds" | "dash" | "menu" | "staff" | "settings" | "audit" | "floorplan" | "inventory" | "timesheets" | "locations";

export interface PosCtx {
  s: Session;
  fmt: (v: number) => string;
  go: (screen: Screen, opts?: { orderId?: string; pay?: boolean }) => void;
  payNow: boolean;
  orderId: string | null;
  setTenant: (t: Tenant, user?: Session["user"]) => void;
}

export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", card: "Card", upi: "UPI", tap: "Tap to pay", online: "Paid online", other: "Other", split: "Split", comp: "Comp",
};

/** Tender types offered at the register for this restaurant. */
export const payMethods = (t: Tenant | null | undefined) =>
  t?.currency === "INR" ? ["upi", "card", "cash", "other"] : ["tap", "card", "cash", "other"];

export const round2 = (v: number) => Math.round(v * 100) / 100;

export const STATUS_TONE: Record<string, string> = {
  open: "bg-sky/15 text-sky", new: "bg-sky/15 text-sky", paid: "bg-leaf/15 text-[oklch(0.45_0.12_150)]",
  refunded: "bg-saffron/20 text-saffron-deep", void: "bg-muted text-muted-foreground", rejected: "bg-muted text-muted-foreground",
};

export function orderTitle(o: { table: string | null; channel: string; number: number; customer_name?: string }) {
  if (o.table) return `Table ${o.table.replace(/^T/, "")}`;
  if (o.channel === "takeaway") return `Takeaway #${o.number}${o.customer_name ? " · " + o.customer_name : ""}`;
  return `Order #${o.number}`;
}

export const Pos = createContext<PosCtx | null>(null);
export const usePos = () => {
  const c = useContext(Pos);
  if (!c) throw new Error("usePos outside provider");
  return c;
};

export const useFmt = (s: Session) => useCallback((v: number) => money(v, s.tenant), [s.tenant]);

/* ---------- Live updates ---------- */

export type Topic = "floor" | "orders" | "online" | "kds" | "cash" | "menu" | "audit" | "print" | "inventory" | "timeclock" | "requests";
export type Revs = Partial<Record<Topic, number>>;
export const Live = createContext<Revs>({});

/** Poll the tiny /live change feed every ~2s while the tab is visible. */
export function useLiveFeed(enabled: boolean) {
  const [revs, setRevs] = useState<Revs>({});
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await api<Revs>("/live");
          if (!stop) setRevs((cur) => (JSON.stringify(cur) === JSON.stringify(r) ? cur : r));
        } catch { /* offline or locked: keep last revs */ }
      }
      if (!stop) timer = setTimeout(tick, 2000);
    };
    tick();
    const wake = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", wake);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, [enabled]);
  return revs;
}

/** Short two-note chime for new orders / tickets (Web Audio, no asset needed). */
export function chime() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.32);
    });
    setTimeout(() => ctx.close(), 900);
  } catch { /* audio blocked until the first tap; ignore */ }
}

/**
 * Fetch an endpoint while the screen is mounted. With a topic it refetches as soon as that topic changes
 * on the live feed, and `ms` is only a slow safety net.
 */
export function usePoll<T>(path: string | null, ms = 5000, topic?: Topic | Topic[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const revs = useContext(Live);
  const key = topic ? (Array.isArray(topic) ? topic : [topic]).map((t) => revs[t] ?? 0).join(".") : "";
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    alive.current = true;
    load();
    const every = topic && ms ? Math.max(ms, 30_000) : ms;
    if (!every) return () => { alive.current = false; };
    const t = setInterval(load, every);
    return () => { alive.current = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ms]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (key) load();
  }, [key, load]);
  return { data, error, reload: load, setData };
}

export async function run<T>(p: Promise<T>, ok?: string): Promise<T | null> {
  try {
    const r = await p;
    if (ok) toast.success(ok);
    return r;
  } catch (e) {
    toast.error((e as Error).message);
    return null;
  }
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function Seg<T extends string>({ value, options, onChange, dark }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; dark?: boolean;
}) {
  return (
    <div className={cn("inline-flex rounded-xl p-1", dark ? "bg-white/[0.08]" : "bg-[#ebe8e1]")}>
      {options.map(([k, l]) => (
        <button key={k} onClick={() => onChange(k)}
          className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition",
            value === k ? (dark ? "bg-[#f2f0ea] text-[#151513]" : "bg-card text-foreground shadow-sm") : (dark ? "text-[#b8b4aa]" : "text-muted-foreground"))}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function VegDot({ veg }: { veg: boolean }) {
  return (
    <span className={cn("grid size-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px]", veg ? "border-leaf" : "border-chili")}>
      <span className={cn("size-1.5 rounded-full", veg ? "bg-leaf" : "bg-chili")} />
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full min-h-48 place-items-center px-6 text-center text-sm text-muted-foreground">{children}</div>;
}
