import { useEffect, useState } from "react";
import { bridge } from "../lib/api";
import { printHtml } from "../lib/receipt";
import { store, type Config } from "../lib/store";
import type { useSync } from "../lib/sync";
import type { Toast } from "../App";

/** Printers, paper, what to print automatically, and the connection to the server. */
export function Settings({ sync, say, onSignOut }: { sync: ReturnType<typeof useSync>; say: Toast; onSignOut: () => void }) {
  const [cfg, setCfg] = useState<Config>(store.config());
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([]);
  const [info, setInfo] = useState<{ version: string; platform: string } | null>(null);
  useEffect(() => {
    bridge?.printers().then(setPrinters).catch(() => {});
    bridge?.info().then(setInfo).catch(() => {});
  }, []);
  const set = (p: Partial<Config>) => {
    store.setConfig(p);
    const c = store.config();
    setCfg(c);
    // The full POS prints through the same printer.
    if (p.printer !== undefined || p.paperMm !== undefined) void bridge?.savePrinter({ name: c.printer, widthMm: c.paperMm });
  };
  const boot = sync.boot;

  return (
    <div className="scroll" style={{ height: "100%", padding: 18 }}>
      <div style={{ maxWidth: 640, display: "grid", gap: 14 }}>
        <div className="card" style={{ padding: 18, display: "grid", gap: 12 }}>
          <b>Printing</b>
          {!bridge && <div className="muted">Running in a browser: printing uses the print dialog. Install the desktop app to print silently.</div>}
          <label className="muted">Receipt printer
            <select className="input" value={cfg.printer} onChange={(e) => set({ printer: e.target.value })}>
              <option value="">Computer's default printer</option>
              {printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? " (default)" : ""}</option>)}
            </select></label>
          <label className="muted">Paper width
            <select className="input" value={cfg.paperMm} onChange={(e) => set({ paperMm: Number(e.target.value) as 58 | 80 })}>
              <option value={80}>80 mm</option><option value={58}>58 mm</option>
            </select></label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={cfg.printReceipt} onChange={(e) => set({ printReceipt: e.target.checked })} />Print a receipt for every sale</label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={cfg.printKitchen} onChange={(e) => set({ printKitchen: e.target.checked })} />Also print a kitchen ticket with the token</label>
          {cfg.printKitchen && (
            <label className="muted">Kitchen printer
              <select className="input" value={cfg.kitchenPrinter} onChange={(e) => set({ kitchenPrinter: e.target.value })}>
                <option value="">Same as receipts</option>
                {printers.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select></label>
          )}
          <button className="btn soft" onClick={async () => {
            const err = await printHtml(`<html><body style="font:12px monospace;width:${cfg.paperMm - 4}mm"><b>Tiffin Counter</b><br>Test print<br>${"1234567890".repeat(5).slice(0, cfg.paperMm === 80 ? 48 : 32)}<br>If you can read this, it works.</body></html>`);
            say(err ? `Couldn't print: ${err}` : "Test page sent", !!err);
          }}>Print a test page</button>
        </div>

        <div className="card" style={{ padding: 18, display: "grid", gap: 8 }}>
          <b>Connection</b>
          <div className="muted">Status: {sync.online === false ? "offline (billing continues, sales are kept here)" : sync.online ? "online" : "checking"}{sync.lastSync ? ` · last synced ${new Date(sync.lastSync).toLocaleTimeString()}` : ""}</div>
          <div className="muted">Menu downloaded: {boot ? new Date(boot.fetched_at).toLocaleString() : "not yet"} · {boot?.menu.reduce((a, c) => a + c.items.length, 0) ?? 0} dishes</div>
          <div className="muted">Sales waiting to send: {sync.queued}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn soft" onClick={() => sync.refreshMenu().then(() => say("Menu and prices updated")).catch((e) => say((e as Error).message, true))}>Update menu now</button>
            <button className="btn soft" onClick={() => { sync.kick(); say("Sending…"); }}>Send sales now</button>
          </div>
        </div>

        <div className="card" style={{ padding: 18, display: "grid", gap: 8 }}>
          <b>This counter</b>
          <div className="muted">Counter id {store.deviceId()}{info ? ` · Tiffin Counter ${info.version} (${info.platform})` : ""}</div>
          <button className="btn danger" onClick={() => {
            if (sync.queued && !confirm(`${sync.queued} sales haven't reached the server yet. They stay on this computer, but they won't send until someone signs in again. Sign out anyway?`)) return;
            onSignOut();
          }}>Sign this counter out</button>
        </div>
      </div>
    </div>
  );
}
