"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Menu as MenuIcon, X } from "lucide-react";
import { MenuAdmin, Staff } from "@/components/pos/backoffice";
import { ReportsScreen } from "@/components/pos/reports";
import { CashScreen } from "@/components/pos/cash";
import { OrdersScreen } from "@/components/pos/history";
import { SettingsScreen } from "@/components/pos/settings";
import { ActivityScreen } from "@/components/pos/activity";
import { FloorPlanEditor } from "@/components/pos/floorplan";
import { CustomersScreen } from "@/components/pos/customers";
import { OffersScreen } from "@/components/pos/offers";
import { DeliveriesScreen } from "@/components/pos/deliveries";
import { EventsScreen } from "@/components/pos/events";
import { InventoryScreen } from "@/components/pos/inventory";
import { TimesheetsScreen } from "@/components/pos/timesheets";
import { ReservationsScreen } from "@/components/pos/reservations";
import { LocationSwitcher, LocationsScreen } from "@/components/pos/locations";
import { DesktopAppLink } from "@/components/pos/apps";
import { Floor } from "@/components/pos/floor";
import { Kitchen, Online } from "@/components/pos/kitchen";
import { LockScreen } from "@/components/pos/lock-screen";
import { OrderScreen } from "@/components/pos/order";
import { usePrintHost } from "@/components/pos/print-host";
import { Live, Pos, type Screen, chime, useFmt, useLiveFeed, usePoll } from "@/components/pos/shared";
import { api, can, hasModule, session, type Session, type Tenant } from "@/lib/api";
import { cn } from "@/lib/utils";

// `module`: an optional module the restaurant must have turned on (set per restaurant in the admin console).
// Order and grouping follow the Service / Manage sidebar design; `gap` starts a new block within its side.
const MODULES: { k: Screen; l: string; perm: string; module?: string; group: "SERVICE" | "MANAGE"; gap?: boolean }[] = [
  { k: "floor", l: "Floor", perm: "floor", group: "SERVICE" },
  { k: "order", l: "Current check", perm: "order", group: "SERVICE" },
  { k: "kds", l: "Kitchen", perm: "kds", group: "SERVICE" },
  { k: "online", l: "Online orders", perm: "online", module: "online", group: "SERVICE" },
  { k: "reservations", l: "Reservations", perm: "floor", module: "reservations", group: "SERVICE", gap: true },
  { k: "deliveries", l: "Deliveries", perm: "floor", group: "SERVICE" },
  { k: "events", l: "Events & catering", perm: "floor", group: "SERVICE" },
  { k: "orders", l: "Order history", perm: "history", group: "SERVICE", gap: true },
  { k: "cash", l: "Cash drawer", perm: "cash", group: "SERVICE" },
  { k: "customers", l: "Customers", perm: "customers", group: "SERVICE" },
  { k: "menu", l: "Menu", perm: "menu", group: "MANAGE" },
  { k: "inventory", l: "Inventory", perm: "inventory_waste", module: "inventory", group: "MANAGE" },
  { k: "offers", l: "Offers", perm: "menu", group: "MANAGE" },
  { k: "dash", l: "Reports", perm: "reports", group: "MANAGE", gap: true },
  { k: "audit", l: "Activity log", perm: "reports", group: "MANAGE" },
  { k: "staff", l: "Staff & roles", perm: "staff", group: "MANAGE", gap: true },
  { k: "timesheets", l: "Timesheets", perm: "timesheets", module: "timeclock", group: "MANAGE" },
  { k: "locations", l: "Locations", perm: "locations", module: "locations", group: "MANAGE", gap: true },
  { k: "floorplan", l: "Floor plan", perm: "tables", group: "MANAGE" },
  { k: "settings", l: "Settings", perm: "settings", group: "MANAGE" },
];

type Side = "SERVICE" | "MANAGE";
const LAST_KEY = "tiffin.lastScreen";
const readLast = (): Partial<Record<Side, Screen>> => {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}"); } catch { return {}; }
};

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

  const allowed = useMemo(() => (s ? MODULES.filter((m) => can(s.user, m.perm) && (!m.module || hasModule(s.tenant, m.module))) : []), [s]);

  useEffect(() => {
    if (s && !allowed.find((m) => m.k === screen)) setScreen(allowed[0]?.k ?? "floor");
  }, [s, allowed, screen]);

  const go = useCallback((sc: Screen, opts?: { orderId?: string; pay?: boolean }) => {
    setScreen(sc);
    if (opts?.orderId !== undefined) setOrderId(opts.orderId);
    setPayNow(!!opts?.pay);
    setNavOpen(false);
  }, []);

  const setTenant = useCallback((t: Tenant, user?: Session["user"]) => {
    setS((cur) => {
      if (!cur) return cur;
      const next = { ...cur, tenant: t, ...(user && user.id === cur.user.id ? { user } : {}) };
      session.set(next);
      const d = session.device();
      if (d) {
        const dev = { ...d, tenant: t, ...(user && user.id === d.user.id ? { user } : {}) };
        try { localStorage.setItem("tiffin.device", JSON.stringify(dev)); } catch { /* storage blocked */ }
        setDevice(dev);
      }
      return next;
    });
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

  return <Shell s={s} screen={screen} go={go} orderId={orderId} payNow={payNow} allowed={allowed} navOpen={navOpen} setNavOpen={setNavOpen} setTenant={setTenant}
    onLock={() => { session.lock(); setS(null); setLocked(true); setOrderId(null); }} />;
}

function Shell({ s, screen, go, orderId, payNow, allowed, navOpen, setNavOpen, onLock, setTenant }: {
  s: Session; screen: Screen; go: (sc: Screen, o?: { orderId?: string; pay?: boolean }) => void; orderId: string | null; payNow: boolean;
  allowed: typeof MODULES; navOpen: boolean; setNavOpen: (v: boolean) => void; onLock: () => void; setTenant: (t: Tenant, user?: Session["user"]) => void;
}) {
  const fmt = useFmt(s);
  const revs = useLiveFeed(true);
  return (
    <Live.Provider value={revs}>
      <ShellInner s={s} screen={screen} go={go} orderId={orderId} payNow={payNow} allowed={allowed} navOpen={navOpen}
        setNavOpen={setNavOpen} onLock={onLock} setTenant={setTenant} fmt={fmt} />
    </Live.Provider>
  );
}

function ShellInner({ s, screen, go, orderId, payNow, allowed, navOpen, setNavOpen, onLock, setTenant, fmt }: {
  s: Session; screen: Screen; go: (sc: Screen, o?: { orderId?: string; pay?: boolean }) => void; orderId: string | null; payNow: boolean;
  allowed: typeof MODULES; navOpen: boolean; setNavOpen: (v: boolean) => void; onLock: () => void; setTenant: (t: Tenant, user?: Session["user"]) => void;
  fmt: (v: number) => string;
}) {
  usePrintHost(hasModule(s.tenant, "printing"));
  // Pick up restaurant changes made elsewhere (e.g. modules turned on in the admin console) without signing in again.
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      api<{ user: Session["user"]; tenant: Tenant }>("/pos/me").then((m) => {
        if (JSON.stringify(m.tenant) !== JSON.stringify(s.tenant) || JSON.stringify(m.user) !== JSON.stringify(s.user)) setTenant(m.tenant, m.user);
      }).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 120_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [s.tenant, s.user, setTenant]);
  const { data: online } = usePoll<{ status: string }[]>(can(s.user, "online") && hasModule(s.tenant, "online") ? "/online" : null, 30000, "online");
  const { data: kds } = usePoll<unknown[]>(can(s.user, "kds") ? "/kds" : null, 30000, "kds");
  const { data: asks } = usePoll<unknown[]>(hasModule(s.tenant, "qr_ordering") && can(s.user, "floor") ? "/service-requests" : null, 30000, "requests");
  const fresh = online?.filter((o) => o.status === "new").length ?? 0;
  const asking = asks?.length ?? 0;
  const tickets = kds?.length ?? 0;
  const last = useRef<{ fresh: number; tickets: number; asking: number } | null>(null);
  useEffect(() => {
    // Chime when a new online order arrives (anywhere) or a new ticket lands while the kitchen screen is up.
    if (online == null && kds == null && asks == null) return;
    if (last.current && (fresh > last.current.fresh || asking > last.current.asking || (screen === "kds" && tickets > last.current.tickets))) chime();
    last.current = { fresh, tickets, asking };
  }, [fresh, tickets, asking, online, kds, asks, screen]);
  const badges: Partial<Record<Screen, number>> = { online: fresh, kds: tickets, floor: asking };
  const act = MODULES.find((m) => m.k === screen)!;
  const ini = s.user.name.split(" ").map((w) => w[0]).join("").slice(0, 2);
  // Service / Manage: the side of the current screen; each side remembers its last screen (kept across reloads).
  const side: Side = act?.group ?? "SERVICE";
  const hasBoth = allowed.some((m) => m.group === "SERVICE") && allowed.some((m) => m.group === "MANAGE");
  const visible = hasBoth ? allowed.filter((m) => m.group === side) : allowed;
  useEffect(() => {
    if (!act) return;
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), [act.group]: act.k })); } catch { /* storage blocked */ }
  }, [act]);
  const switchSide = (g: Side) => {
    if (g === side) return;
    const last = readLast()[g];
    const target = allowed.find((m) => m.k === last && m.group === g) ?? allowed.find((m) => m.group === g);
    if (target) go(target.k);
  };
  const trialDays = s.tenant?.trial_ends_at && s.tenant.status === "trial"
    ? Math.max(0, Math.ceil((new Date(s.tenant.trial_ends_at).getTime() - Date.now()) / 86400000)) : null;

  const nav = (
    <>
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#ee8a3a] font-bold text-white">t</span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-white">{s.tenant?.name}</div>
          {s.tenant?.location_name && <div className="truncate text-[12px] text-[#cfc8be]">{s.tenant.location_name}</div>}
          <div className="text-[11px] text-[#8d867c]">{s.tenant?.market === "US" ? "USD · $" : "INR · ₹"}</div>
        </div>
      </div>
      <LocationSwitcher enabled={hasModule(s.tenant, "locations") || !!s.tenant?.brand_id} />
      {hasBoth && (
        <div className="mb-4 grid grid-cols-2 rounded-[11px] bg-[#2c2925] p-[3px] text-[13px]">
          {(["SERVICE", "MANAGE"] as const).map((g) => {
            const on = side === g;
            const waiting = !on && allowed.some((m) => m.group === g && badges[m.k]);
            return (
              <button key={g} onClick={() => switchSide(g)}
                className={cn("rounded-lg py-[7px] text-center font-medium transition", on ? "bg-[#4a453f] text-white" : "text-[#a39c92] hover:text-white")}>
                {g === "SERVICE" ? "Service" : "Manage"}
                {waiting && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-[#ee8a3a] align-middle" aria-label="Something needs attention" />}
              </button>
            );
          })}
        </div>
      )}
      <nav className="min-h-0 overflow-y-auto">
        {visible.map(({ k, l, gap }, i) => (
          <div key={k}>
            {gap && i > 0 && <div className="h-3" />}
            <button onClick={() => go(k)}
              className={cn("flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition",
                screen === k ? "bg-[#3a3631] font-medium text-white" : "text-[#cfc8be] hover:bg-[#2c2925]")}>
              <span>{l}</span>
              {!!badges[k] && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#ee8a3a] px-[5px] font-mono text-[10px] font-semibold text-white">{badges[k]}</span>}
            </button>
          </div>
        ))}
      </nav>
      <div className="flex-1" />
      <DesktopAppLink />
      {trialDays != null && (
        <div className="mb-2 rounded-xl bg-saffron/15 px-3 py-2.5 text-xs text-saffron">Free trial · {trialDays} day{trialDays === 1 ? "" : "s"} left</div>
      )}
      <div className="flex items-center gap-2.5 border-t border-[#33302c] px-2.5 pt-2.5 text-[12px]">
        <span className="grid size-7 place-items-center rounded-full bg-[#3a3631] text-[11px] text-white">{ini}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-white">{s.user.name}</div>
          <div className="capitalize text-[#7c766d]">{s.user.role}</div>
        </div>
        <button onClick={onLock} title="Lock" className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"><Lock className="size-4" /></button>
      </div>
    </>
  );

  return (
    <Pos.Provider value={{ s, fmt, go, orderId, payNow, setTenant }}>
      <div className="flex h-dvh overflow-hidden bg-background">
        <aside className="hidden w-[220px] shrink-0 flex-col gap-0.5 bg-[#211f1d] px-3 py-[18px] text-[#cfc8be] md:flex">{nav}</aside>
        {navOpen && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setNavOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside onClick={(e) => e.stopPropagation()} className="absolute inset-y-0 left-0 flex w-64 flex-col gap-0.5 bg-[#211f1d] px-3 py-[18px] text-[#cfc8be]">
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
            {screen === "orders" && <OrdersScreen />}
            {screen === "cash" && <CashScreen />}
            {screen === "settings" && <SettingsScreen />}
            {screen === "audit" && <ActivityScreen />}
            {screen === "floorplan" && <FloorPlanEditor />}
            {screen === "online" && <Online />}
            {screen === "kds" && <Kitchen />}
            {screen === "dash" && <ReportsScreen />}
            {screen === "menu" && <MenuAdmin />}
            {screen === "inventory" && <InventoryScreen />}
            {screen === "staff" && <Staff />}
            {screen === "timesheets" && <TimesheetsScreen />}
            {screen === "locations" && <LocationsScreen />}
            {screen === "reservations" && <ReservationsScreen />}
            {screen === "customers" && <CustomersScreen />}
            {screen === "offers" && <OffersScreen />}
            {screen === "deliveries" && <DeliveriesScreen />}
            {screen === "events" && <EventsScreen />}
          </main>
        </div>
      </div>
    </Pos.Provider>
  );
}
