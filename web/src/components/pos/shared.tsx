"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, money, type Session, type Tenant } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Screen = "floor" | "order" | "orders" | "cash" | "online" | "kds" | "dash" | "menu" | "staff" | "settings";

export interface PosCtx {
  s: Session;
  fmt: (v: number) => string;
  go: (screen: Screen, opts?: { orderId?: string; pay?: boolean }) => void;
  payNow: boolean;
  orderId: string | null;
  setTenant: (t: Tenant) => void;
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

/** Fetch + poll an endpoint while the screen is mounted (live floor / KDS / online queue). */
export function usePoll<T>(path: string | null, ms = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
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
    if (!ms) return () => { alive.current = false; };
    const t = setInterval(load, ms);
    return () => { alive.current = false; clearInterval(t); };
  }, [load, ms]);
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
