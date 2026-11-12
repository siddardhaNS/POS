"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import { api, type Session } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useNow } from "./shared";

interface StaffTile { id: string; name: string; role: string }

const ini = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export function LockScreen({ device, onUnlock, onSignOut }: {
  device: Session; onUnlock: (s: Session) => void; onSignOut: () => void;
}) {
  const now = useNow(10_000);
  const [staff, setStaff] = useState<StaffTile[] | null>(null);
  const [who, setWho] = useState<StaffTile | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<StaffTile[]>("/pos/staff", { token: device.token }).then(setStaff).catch(() => setStaff([]));
  }, [device.token]);

  async function press(k: string) {
    if (!who) return;
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 4);
    setPin(next);
    setError("");
    if (next.length === 4) {
      try {
        const s = await api<Session>("/auth/pin", { token: device.token, body: { user_id: who.id, pin: next } });
        onUnlock(s);
      } catch (e) {
        setError((e as Error).message);
        setTimeout(() => setPin(""), 250);
      }
    }
  }

  useEffect(() => {
    if (!who) return;
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Escape") { setWho(null); setPin(""); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const d = new Date(now);
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).split(" ");
  const h = d.getHours();
  const service = h < 11 ? "Breakfast" : h < 16 ? "Lunch service" : "Dinner service";

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
        <p className="max-w-sm text-sm leading-relaxed text-white/50">One login for service and back office. What you see depends on your role.</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-7 overflow-y-auto p-8">
        {!who ? (
          <>
            <h2 className="text-2xl font-semibold">Who&apos;s working?</h2>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
              {staff?.map((p) => (
                <button key={p.id} onClick={() => setWho(p)}
                  className="flex h-36 w-40 flex-col items-center justify-center gap-2 rounded-[18px] border border-border bg-card transition hover:border-foreground/40">
                  <span className="grid size-12 place-items-center rounded-full bg-muted font-semibold">{ini(p.name)}</span>
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs capitalize text-muted-foreground">{p.role}</span>
                </button>
              ))}
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
        ) : (
          <>
            <div className="flex flex-col items-center gap-2">
              <span className="grid size-16 place-items-center rounded-full border border-border bg-card text-lg font-semibold">{ini(who.name)}</span>
              <div className="text-xl font-semibold">{who.name}</div>
              <div className="h-5 text-sm text-destructive">{error}</div>
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
            <button onClick={() => { setWho(null); setPin(""); }} className="text-sm text-muted-foreground hover:text-foreground">← Not you?</button>
          </>
        )}
        <Link href="/" className="text-xs text-muted-foreground/60 hover:text-muted-foreground">tiffin</Link>
      </div>
    </div>
  );
}
