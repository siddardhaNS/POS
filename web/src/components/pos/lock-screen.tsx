"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Coffee, Delete, LogIn, LogOut } from "lucide-react";
import { api, hasModule, type Session } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useNow } from "./shared";

interface StaffTile { id: string; name: string; role: string }
interface ClockTile { user_id: string; status: "on" | "break" | "off"; since: string | null; missed_clock_out: boolean }
interface PunchResult { status: "on" | "break" | "off"; since: string | null; break_since: string | null; hours_today: number; at: string; action: string; missed_clock_out: boolean }

const ini = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
const hours = (h: number) => `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}m`;

export function LockScreen({ device, onUnlock, onSignOut }: {
  device: Session; onUnlock: (s: Session) => void; onSignOut: () => void;
}) {
  const now = useNow(10_000);
  const clockOn = hasModule(device.tenant, "timeclock");
  const [mode, setMode] = useState<"unlock" | "clock">("unlock");
  const [staff, setStaff] = useState<StaffTile[] | null>(null);
  const [clock, setClock] = useState<Record<string, ClockTile>>({});
  const [who, setWho] = useState<StaffTile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [needsClockIn, setNeedsClockIn] = useState(false);
  const [state, setState] = useState<PunchResult | null>(null); // clock mode: this person's state after their PIN
  const [done, setDone] = useState<PunchResult | null>(null); // confirmation after a punch
  const lastPin = useRef("");

  const loadClock = useCallback(() => {
    if (!clockOn) return;
    api<ClockTile[]>("/timeclock/status", { token: device.token })
      .then((r) => setClock(Object.fromEntries(r.map((x) => [x.user_id, x])))).catch(() => {});
  }, [clockOn, device.token]);

  useEffect(() => {
    api<StaffTile[]>("/pos/staff", { token: device.token }).then(setStaff).catch(() => setStaff([]));
    loadClock();
    const t = setInterval(loadClock, 30_000);
    return () => clearInterval(t);
  }, [device.token, loadClock]);

  function reset() {
    setWho(null); setPin(""); setError(""); setState(null); setNeedsClockIn(false); lastPin.current = "";
  }

  async function punch(action: "in" | "out" | "break_start" | "break_end" | "status", p = lastPin.current) {
    return api<PunchResult>("/timeclock/punch", { token: device.token, body: { user_id: who!.id, pin: p, action } });
  }

  async function press(k: string) {
    if (!who || state || done) return;
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    setError("");
    setNeedsClockIn(false);
    if (next.length < 4) return;
    lastPin.current = next;
    try {
      if (mode === "clock") {
        setState(await punch("status", next));
      } else {
        onUnlock(await api<Session>("/auth/pin", { token: device.token, body: { user_id: who.id, pin: next } }));
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      if (mode === "unlock" && clockOn && /not clocked in/i.test(msg)) setNeedsClockIn(true);
      else setTimeout(() => setPin(""), 250);
    }
  }

  async function act(action: "in" | "out" | "break_start" | "break_end") {
    try {
      const r = await punch(action);
      setDone(r);
      setState(null);
      loadClock();
      setTimeout(() => { setDone(null); reset(); }, 3500);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function clockInAndUnlock() {
    try {
      await punch("in");
      onUnlock(await api<Session>("/auth/pin", { token: device.token, body: { user_id: who!.id, pin: lastPin.current } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    if (!who || state || done) return;
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const d = new Date(now);
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).split(" ");
  const h = d.getHours();
  const service = h < 11 ? "Breakfast" : h < 16 ? "Lunch service" : "Dinner service";
  const onShift = Object.values(clock).filter((c) => c.status !== "off").length;

  return (
    <div className="fixed inset-0 z-50 flex bg-background">
      <div className="hidden w-[460px] shrink-0 flex-col gap-4 bg-[#1d1c1a] p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-[13px] bg-saffron text-xl font-bold text-[#1d1c1a]">t</span>
          <div>
            <div className="text-lg font-semibold">{device.tenant?.name}</div>
            <div className="text-xs text-white/45">Tiffin POS</div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="font-mono text-6xl font-semibold tracking-tight">{t[0]}<span className="text-2xl text-white/50"> {t[1]}</span></div>
        <div className="text-[15px] text-white/60">{d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} · {service}</div>
        {clockOn && <div className="text-sm text-white/60">{onShift} on shift now</div>}
        <p className="max-w-sm text-sm leading-relaxed text-white/50">One login for service and back office. What you see depends on your role.</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-7 overflow-y-auto p-8">
        {clockOn && !who && (
          <div className="inline-flex rounded-xl bg-[#ebe8e1] p-1">
            {([["unlock", "Start using the POS", LogIn], ["clock", "Clock in / out", Clock]] as const).map(([k, l, Icon]) => (
              <button key={k} onClick={() => setMode(k)}
                className={cn("flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition", mode === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>
                <Icon className="size-4" />{l}
              </button>
            ))}
          </div>
        )}

        {done ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <span className={cn("grid size-16 place-items-center rounded-full", done.status === "off" ? "bg-muted" : done.status === "break" ? "bg-saffron/20" : "bg-leaf/15")}>
              {done.status === "off" ? <LogOut className="size-7" /> : done.status === "break" ? <Coffee className="size-7 text-saffron-deep" /> : <LogIn className="size-7 text-[oklch(0.45_0.12_150)]" />}
            </span>
            <div className="text-2xl font-semibold">
              {{ in: "Clocked in", out: "Clocked out", break_start: "Enjoy your break", break_end: "Back on shift" }[done.action] ?? "Done"}
            </div>
            <div className="text-muted-foreground">{who?.name} · {hm(done.at)} · {hours(done.hours_today)} worked today</div>
          </div>
        ) : !who ? (
          <>
            <h2 className="text-2xl font-semibold">{mode === "clock" ? "Who's clocking in or out?" : "Who's working?"}</h2>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
              {staff?.map((p) => {
                const c = clock[p.id];
                return (
                  <button key={p.id} onClick={() => setWho(p)}
                    className="relative flex h-36 w-40 flex-col items-center justify-center gap-2 rounded-[18px] border border-border bg-card transition hover:border-foreground/40">
                    {clockOn && c && c.status !== "off" && (
                      <span className={cn("absolute right-3 top-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                        c.status === "break" ? "bg-saffron/20 text-saffron-deep" : "bg-leaf/15 text-[oklch(0.45_0.12_150)]")}>
                        <span className={cn("size-1.5 rounded-full", c.status === "break" ? "bg-saffron" : "bg-leaf")} />
                        {c.status === "break" ? "Break" : "On"}
                      </span>
                    )}
                    <span className="grid size-12 place-items-center rounded-full bg-muted font-semibold">{ini(p.name)}</span>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {clockOn && c && c.status !== "off" ? `${c.status === "break" ? "Break since" : "Since"} ${hm(c.since)}` : p.role}
                    </span>
                  </button>
                );
              })}
            </div>
            {staff && staff.length === 0 && (
              <p className="max-w-sm text-center text-sm text-muted-foreground">
                No staff PINs yet. Sign in as the owner and add staff under <b>Staff &amp; roles</b>.
              </p>
            )}
            <div className="flex gap-5 text-sm text-muted-foreground">
              <button onClick={() => onUnlock(device)} className="hover:text-foreground">Continue as {device.user.name}</button>
              <span>·</span>
              <button onClick={onSignOut} className="hover:text-foreground">Sign out device</button>
            </div>
          </>
        ) : state ? (
          <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
            <span className="grid size-16 place-items-center rounded-full border border-border bg-card text-lg font-semibold">{ini(who.name)}</span>
            <div>
              <div className="text-xl font-semibold">{who.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {state.status === "off" ? "Not on the clock" : state.status === "break" ? `On break since ${hm(state.break_since)}` : `On shift since ${hm(state.since)}`}
                {state.hours_today > 0 && ` · ${hours(state.hours_today)} today`}
              </div>
              {state.missed_clock_out && <div className="mt-1 text-sm font-medium text-destructive">This shift has been open a very long time. Clock out and ask a manager to fix the times.</div>}
              <div className="h-5 text-sm text-destructive">{error}</div>
            </div>
            <div className="grid w-full gap-2.5">
              {state.status === "off" && <ClockBtn onClick={() => act("in")} icon={LogIn} label="Clock in" primary />}
              {state.status === "on" && <ClockBtn onClick={() => act("break_start")} icon={Coffee} label="Start break" />}
              {state.status === "break" && <ClockBtn onClick={() => act("break_end")} icon={LogIn} label="End break" primary />}
              {state.status !== "off" && <ClockBtn onClick={() => act("out")} icon={LogOut} label="Clock out" primary={state.status === "on"} />}
            </div>
            <button onClick={reset} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2">
              <span className="grid size-16 place-items-center rounded-full border border-border bg-card text-lg font-semibold">{ini(who.name)}</span>
              <div className="text-xl font-semibold">{who.name}</div>
              <div className="text-sm text-muted-foreground">{mode === "clock" ? "Enter your PIN to clock in or out" : ""}</div>
              <div className="min-h-5 text-center text-sm text-destructive">{error}</div>
              {needsClockIn && (
                <button onClick={clockInAndUnlock} className="flex h-11 items-center gap-2 rounded-xl bg-foreground px-5 text-sm font-semibold text-background">
                  <LogIn className="size-4" />Clock in now and start
                </button>
              )}
            </div>
            <div className="flex gap-3.5">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={cn("size-4 rounded-full border-2 border-foreground transition", i < pin.length && "bg-foreground")} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) =>
                k ? (
                  <button key={i} onClick={() => press(k)}
                    className="grid h-[68px] w-[84px] place-items-center rounded-2xl border border-border bg-card font-mono text-2xl font-medium transition active:scale-95 active:bg-muted">
                    {k === "⌫" ? <Delete className="size-6" /> : k}
                  </button>
                ) : <span key={i} />,
              )}
            </div>
            <button onClick={reset} className="text-sm text-muted-foreground hover:text-foreground">← Not you?</button>
          </>
        )}
        <Link href="/" className="text-xs text-muted-foreground/60 hover:text-muted-foreground">tiffin</Link>
      </div>
    </div>
  );
}

function ClockBtn({ onClick, icon: Icon, label, primary }: { onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string; primary?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex h-14 items-center justify-center gap-2 rounded-2xl text-base font-semibold transition active:scale-[0.98]",
      primary ? "bg-foreground text-background" : "bg-card ring-1 ring-border")}>
      <Icon className="size-5" />{label}
    </button>
  );
}
