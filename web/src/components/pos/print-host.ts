"use client";

import { useContext, useEffect, useRef } from "react";
import { ApiError, api, type Tenant } from "@/lib/api";
import { b64bytes, deviceReceiptPrinter, pairedIds, sendToPrinter } from "@/lib/printers";
import { printReceipt } from "./print";
import { Live } from "./shared";
import type { Order } from "./types";

interface ClaimedJob { id: string; printer_id: string; title: string; escpos: string }

/**
 * Print host: when USB / serial printers are paired with this device, take their queued jobs from the API and
 * send them. Runs whenever the print topic moves on the live feed, and every few seconds as a safety net.
 */
export function usePrintHost() {
  const revs = useContext(Live);
  const busy = useRef(false);
  const again = useRef(false);

  const pump = useRef(async () => {
    if (busy.current) { again.current = true; return; }
    const ids = pairedIds();
    if (!ids.length) return;
    busy.current = true;
    try {
      do {
        again.current = false;
        const jobs = await api<ClaimedJob[]>("/print/claim", { body: { printer_ids: ids } });
        for (const j of jobs) {
          let error = "";
          try {
            await sendToPrinter(j.printer_id, b64bytes(j.escpos));
          } catch (e) {
            error = (e as Error).message || "Print failed";
          }
          await api(`/print/jobs/${j.id}/result`, { body: error ? { ok: false, error } : { ok: true } }).catch(() => {});
        }
        if (jobs.length) again.current = true; // there may be more than one batch waiting
      } while (again.current);
    } catch { /* offline or locked: try again on the next tick */ } finally {
      busy.current = false;
    }
  });

  useEffect(() => {
    pump.current();
  }, [revs.print]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) pump.current(); }, 5000);
    const wake = () => pump.current();
    window.addEventListener("tiffin:printers", wake);
    return () => { clearInterval(t); window.removeEventListener("tiffin:printers", wake); };
  }, []);
}

/**
 * Print a bill or receipt on this device's receipt printer (or the restaurant's first one).
 * With no receipt printer set up, falls back to the browser's print dialog. Returns the printer name, if any.
 */
export async function printOrder(o: Order, t: Tenant | null | undefined, fmt: (v: number) => string,
  kind: "bill" | "receipt" = "receipt", opts: { drawer?: boolean } = {}): Promise<string | null> {
  try {
    const r = await api<{ printer: string }>(`/print/orders/${o.id}`, {
      body: { kind, printer_id: deviceReceiptPrinter(), drawer: !!opts.drawer },
    });
    return r.printer;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      printReceipt(o, t, fmt, kind);
      return null;
    }
    throw e;
  }
}

/** Open the cash drawer on this device's receipt printer, if it has one. Silent when there's no printer. */
export async function openDrawer() {
  try {
    await api("/print/drawer", { body: { printer_id: deviceReceiptPrinter() } });
  } catch { /* no receipt printer or no drawer: nothing to open */ }
}
