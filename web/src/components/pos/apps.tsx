"use client";

import { useEffect, useState } from "react";
import { Download, Monitor, Smartphone, X } from "lucide-react";
import { can } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePos } from "./shared";

/** Where the Windows installer is published (set when it's hosted). Empty = not available yet. */
export const DESKTOP_DOWNLOAD_URL = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL ?? "";

/** True when this page is running inside the Tiffin Counter desktop app (it adds window.tiffinDesktop). */
export function useInDesktopApp() {
  const [inside, setInside] = useState(true); // assume yes until checked, so nothing flashes inside the app
  useEffect(() => { setInside(!!(window as unknown as { tiffinDesktop?: unknown }).tiffinDesktop); }, []);
  return inside;
}

/** Sidebar nudge for people who bill: get the desktop app (silent printing, keeps billing offline). */
export function DesktopAppLink() {
  const { s } = usePos();
  const [open, setOpen] = useState(false);
  const inside = useInDesktopApp();
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem("tiffin.hideDesktopApp") === "1"); } catch { setHidden(false); } }, []);
  if (inside || hidden || !can(s.user, "pay")) return null;
  return (
    <div className="relative mb-2 rounded-xl bg-white/[0.06] p-3 pr-7 text-xs text-white/70">
      <button onClick={() => { setHidden(true); try { localStorage.setItem("tiffin.hideDesktopApp", "1"); } catch { /* storage blocked */ } }}
        className="absolute right-2 top-2 text-white/40 hover:text-white" aria-label="Hide"><X className="size-3.5" /></button>
      <button onClick={() => setOpen(true)} className="flex items-start gap-2 text-left">
        <Monitor className="mt-0.5 size-4 shrink-0 text-saffron" />
        <span><span className="block font-medium text-white">Get the desktop app</span>Prints without dialogs and keeps billing when the internet drops.</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Tiffin apps</DialogTitle></DialogHeader>
          <AppsPanel />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Settings → Apps: the counter desktop app and the staff phone app. */
export function AppsPanel() {
  const inside = useInDesktopApp();
  return (
    <div className="grid max-w-2xl gap-4">
      <div className="space-y-3 rounded-2xl bg-card p-5 ring-1 ring-border">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-saffron/20"><Monitor className="size-5 text-saffron-deep" /></span>
          <div><div className="font-semibold">Tiffin Counter for Windows</div><div className="text-sm text-muted-foreground">For the billing counter computer</div></div>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>The full Tiffin POS, always up to date: tables, kitchen, online orders, reports, everything.</li>
          <li>Receipts and kitchen tickets print straight to the printer, no print dialog.</li>
          <li>Keeps billing when the internet drops: quick counter billing with token numbers, sent to Tiffin when it&apos;s back.</li>
        </ul>
        {inside ? (
          <p className="text-sm font-medium text-[oklch(0.45_0.12_150)]">You&apos;re using the desktop app right now.</p>
        ) : DESKTOP_DOWNLOAD_URL ? (
          <a href={DESKTOP_DOWNLOAD_URL} className="flex h-11 w-fit items-center gap-2 rounded-xl bg-foreground px-5 font-semibold text-background">
            <Download className="size-4" />Download for Windows</a>
        ) : <p className="text-sm text-muted-foreground">The download is coming soon.</p>}
        {!inside && <p className="text-xs text-muted-foreground">After installing, open Tiffin Counter and sign in with the same email and password. Sign in once while online so it can bill offline later.</p>}
      </div>
      <div className="space-y-2 rounded-2xl bg-card p-5 ring-1 ring-border">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-sky/15"><Smartphone className="size-5 text-sky" /></span>
          <div><div className="font-semibold">Tiffin for phones</div><div className="text-sm text-muted-foreground">Waiters take orders at the table; owners and managers see sales on the move</div></div>
        </div>
        <p className="text-sm text-muted-foreground">Coming soon for Android and iPhone.</p>
      </div>
    </div>
  );
}
