"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Bike, ChefHat, LayoutGrid, Lock, Menu as MenuIcon, ReceiptText, UtensilsCrossed, Users, X } from "lucide-react";
import { Dashboard, MenuAdmin, Staff } from "@/components/pos/backoffice";
import { Floor } from "@/components/pos/floor";
import { Kitchen, Online } from "@/components/pos/kitchen";
import { LockScreen } from "@/components/pos/lock-screen";
import { OrderScreen } from "@/components/pos/order";
import { Pos, type Screen, useFmt, usePoll } from "@/components/pos/shared";
import { can, session, type Session } from "@/lib/api";
import { cn } from "@/lib/utils";

const MODULES: { k: Screen; l: string; perm: string; group: "SERVICE" | "MANAGE"; icon: React.ComponentType<{ className?: string }> }[] = [
  { k: "floor", l: "Floor", perm: "floor", group: "SERVICE", icon: LayoutGrid },
  { k: "order", l: "Order", perm: "order", group: "SERVICE", icon: ReceiptText },
  { k: "online", l: "Online orders", perm: "online", group: "SERVICE", icon: Bike },
  { k: "kds", l: "Kitchen", perm: "kds", group: "SERVICE", icon: ChefHat },
  { k: "dash", l: "Reports", perm: "reports", group: "MANAGE", icon: BarChart3 },
  { k: "menu", l: "Menu", perm: "menu", group: "MANAGE", icon: UtensilsCrossed },
  { k: "staff", l: "Staff & roles", perm: "staff", group: "MANAGE", icon: Users },
];

export default function PosPage() {
  const router = useRouter();
  const [device, setDevice] = useState<Session | null>(null);
  const [s, setS] = useState<Session | null>(null);
  const [locked, setLocked] = useState(false);
  const [screen, setScreen] = useState<Screen>("floor");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [payNow, setPayNow] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const d = session.device();
    if (!d || !d.tenant) return router.replace("/login");
    setDevice(d);
    const cur = session.get();
    if (cur?.tenant?.id === d.tenant.id) setS(cur);
    else setLocked(true);
  }, [router]);

  const allowed = useMemo(() => (s ? MODULES.filter((m) => can(s.user, m.perm)) : []), [s]);

  useEffect(() => {
    if (s && !allowed.find((m) => m.k === screen)) setScreen(allowed[0]?.k ?? "floor");
  }, [s, allowed, screen]);

  const go = useCallback((sc: Screen, opts?: { orderId?: string; pay?: boolean }) => {
    setScreen(sc);
    if (opts?.orderId !== undefined) setOrderId(opts.orderId);
    setPayNow(!!opts?.pay);
    setNavOpen(false);
  }, []);

  if (!device) return null;
  if (locked || !s)
    return (
      <LockScreen
        device={device}
        onUnlock={(ns) => { session.set(ns); setS(ns); setLocked(false); }}
        onSignOut={() => { session.clear(); router.push("/login"); }}
      />
    );

  return <Shell s={s} screen={screen} go={go} orderId={orderId} payNow={payNow} allowed={allowed} navOpen={navOpen} setNavOpen={setNavOpen}
    onLock={() => { session.lock(); setS(null); setLocked(true); setOrderId(null); }} />;
}

function Shell({ s, screen, go, orderId, payNow, allowed, navOpen, setNavOpen, onLock }: {
  s: Session; screen: Screen; go: (sc: Screen, o?: { orderId?: string; pay?: boolean }) => void; orderId: string | null; payNow: boolean;
  allowed: typeof MODULES; navOpen: boolean; setNavOpen: (v: boolean) => void; onLock: () => void;
}) {
  const fmt = useFmt(s);
  const { data: online } = usePoll<{ status: string }[]>(can(s.user, "online") ? "/online" : null, 8000);
  const { data: kds } = usePoll<unknown[]>(can(s.user, "kds") ? "/kds" : null, 8000);
  const badges: Partial<Record<Screen, number>> = { online: online?.filter((o) => o.status === "new").length, kds: kds?.length };
  const act = MODULES.find((m) => m.k === screen)!;
  const ini = s.user.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  const trialDays = s.tenant?.trial_ends_at && s.tenant.status === "trial"
    ? Math.max(0, Math.ceil((new Date(s.tenant.trial_ends_at).getTime() - Date.now()) / 86400000)) : null;

  const nav = (
    <>
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <span className="grid size-[34px] place-items-center rounded-[10px] bg-saffron font-bold text-[#1d1c1a]">t</span>
        <div className="min-w-0">
          <div className="truncate font-semibold">{s.tenant?.name}</div>
          <div className="text-[11.5px] text-white/45">{s.tenant?.market === "US" ? "USD · $" : "INR · ₹"}</div>
        </div>
      </div>
      {(["SERVICE", "MANAGE"] as const).map((g) => {
        const items = allowed.filter((m) => m.group === g);
        if (!items.length) return null;
        return (
          <div key={g}>
            <div className="px-2.5 pb-1.5 pt-4 font-mono text-[10.5px] tracking-[0.06em] text-white/40">{g}</div>
            {items.map(({ k, l, icon: Icon }) => (
              <button key={k} onClick={() => go(k)}
                className={cn("flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[13.5px] transition",
                  screen === k ? "bg-white/12 text-white" : "text-white/55 hover:text-white")}>
                <Icon className="size-4" />{l}
                {!!badges[k] && <span className="ml-auto rounded-full bg-saffron px-1.5 font-mono text-[11px] font-semibold text-[#1d1c1a]">{badges[k]}</span>}
              </button>
            ))}
          </div>
        );
      })}
      <div className="flex-1" />
      {trialDays != null && (
        <div className="mb-2 rounded-xl bg-saffron/15 px-3 py-2.5 text-xs text-saffron">Free trial · {trialDays} day{trialDays === 1 ? "" : "s"} left</div>
      )}
      <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] p-2.5">
        <span className="grid size-[34px] place-items-center rounded-full bg-[#3a3834] text-xs font-semibold">{ini}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{s.user.name}</div>
          <div className="text-[11.5px] capitalize text-white/45">{s.user.role}</div>
        </div>
        <button onClick={onLock} title="Lock" className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"><Lock className="size-4" /></button>
      </div>
    </>
  );

  return (
    <Pos.Provider value={{ s, fmt, go, orderId, payNow }}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <aside className="hidden w-[232px] shrink-0 flex-col gap-1 bg-[#1d1c1a] px-3.5 py-[18px] text-white md:flex">{nav}</aside>
        {navOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setNavOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside onClick={(e) => e.stopPropagation()} className="absolute inset-y-0 left-0 flex w-64 flex-col gap-1 bg-[#1d1c1a] px-3.5 py-[18px] text-white">
              <button onClick={() => setNavOpen(false)} className="absolute right-3 top-4 text-white/60"><X className="size-5" /></button>
              {nav}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-[22px]">
            <button className="md:hidden" onClick={() => setNavOpen(true)}><MenuIcon className="size-5" /></button>
            <div className="text-[15px] font-semibold">{act.l}</div>
            <span className="text-xs text-muted-foreground">{act.group === "SERVICE" ? "Service" : "Back office"}</span>
            <div className="ml-auto flex items-center gap-3 text-[12.5px] text-[#5d5a53]">
              <span className="hidden sm:inline">{new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
              <span className="rounded-lg bg-accent px-2.5 py-1 font-semibold text-accent-foreground">{s.tenant?.currency}</span>
            </div>
          </header>
          <main className="relative min-h-0 flex-1">
            {screen === "floor" && <Floor />}
            {screen === "order" && <OrderScreen key={orderId ?? "none"} />}
            {screen === "online" && <Online />}
            {screen === "kds" && <Kitchen />}
            {screen === "dash" && <Dashboard />}
            {screen === "menu" && <MenuAdmin />}
            {screen === "staff" && <Staff />}
          </main>
        </div>
      </div>
    </Pos.Provider>
  );
}
