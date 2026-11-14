import { useCallback, useEffect, useState } from "react";
import { bridge, reportError } from "./lib/api";
import { store, type Session } from "./lib/store";
import { useSync } from "./lib/sync";
import { Setup } from "./screens/Setup";
import { Pin } from "./screens/Pin";
import { Sell } from "./screens/Sell";
import { Sales } from "./screens/Sales";
import { Settings } from "./screens/Settings";

export type Toast = (msg: string, bad?: boolean) => void;
type Screen = "sell" | "sales" | "settings";

/**
 * The offline billing screen. In the desktop app it opens only when the server can't be reached: it runs on the
 * sign-in, staff and menu the app saved while the full POS was online, and hands back to the full POS once the
 * server is back, its sales are sent and no bill is half-done.
 */
export default function App() {
  const [ready, setReady] = useState(!bridge);
  const [device, setDevice] = useState<Session | null>(() => store.device());
  const [staff, setStaff] = useState<Session | null>(() => store.staff());

  useEffect(() => {
    if (!bridge) return;
    bridge.cached().then((c) => {
      store.setConfig({ apiUrl: c.apiUrl });
      if (c.device) { store.setDevice(c.device); setDevice(c.device); }
      if (c.staff) { store.setStaff(c.staff); setStaff(c.staff); localStorage.setItem("tc.lastStaff", JSON.stringify(c.staff)); }
      if (c.boot && (!store.boot() || c.boot.fetched_at > (store.boot()?.fetched_at ?? ""))) store.setBoot(c.boot);
      setReady(true);
    }).catch(() => setReady(true));
  }, []);

  // Not signed in yet: go back to the full POS (where sign-in happens) as soon as the server answers.
  useEffect(() => (bridge && !device ? bridge.onOnline((ok) => { if (ok) void bridge!.goFull(); }) : undefined), [device]);

  if (!ready) return null;
  if (!device) {
    if (bridge) return (
      <div className="center" style={{ padding: 30, textAlign: "center" }}>
        <div style={{ maxWidth: 460, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Connect to the internet once</div>
          <div className="muted">Tiffin Counter needs to sign in to your restaurant once while online. After that it keeps billing even when the internet drops.</div>
          <button className="btn" onClick={() => bridge!.goFull()}>Try again</button>
        </div>
      </div>
    );
    return <Setup onDone={(s) => { store.setDevice(s); store.setStaff(null); setDevice(s); setStaff(null); }} />;
  }
  return <Signed device={device} staff={staff} setStaff={setStaff} onSignOut={() => { store.clearSignIn(); setDevice(null); setStaff(null); }} />;
}

function Signed({ device, staff, setStaff, onSignOut }: { device: Session; staff: Session | null; setStaff: (s: Session | null) => void; onSignOut: () => void }) {
  const [screen, setScreen] = useState<Screen>("sell");
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);
  const [billOpen, setBillOpen] = useState(false);
  const [serverBack, setServerBack] = useState(false);
  const sync = useSync(true);

  const say: Toast = useCallback((msg, bad) => {
    setToast({ msg, bad });
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), 3500);
  }, []);

  useEffect(() => {
    const onErr = (e: ErrorEvent) => reportError(e.error ?? e.message, "window");
    const onRej = (e: PromiseRejectionEvent) => reportError(e.reason, "promise");
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, []);

  // The app tells us when the server is reachable again.
  useEffect(() => bridge?.onOnline((ok) => setServerBack(ok)), []);
  const back = serverBack || sync.online === true;
  // Back to the full POS when nothing would be lost: sales sent, no bill being rung up.
  useEffect(() => {
    if (bridge && back && sync.queued === 0 && !billOpen) void bridge.goFull();
  }, [back, sync.queued, billOpen]);

  if (!staff) return <Pin device={device} online={sync.online} onDone={(s) => { store.setStaff(s); setStaff(s); }} onSignOut={onSignOut} />;
  const t = sync.boot?.tenant ?? staff.tenant;

  return (
    <div style={{ display: "grid", gridTemplateRows: "56px auto 1fr", height: "100%" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 18px", background: "#1d1c1a", color: "#fff" }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: "var(--saffron)", color: "var(--ink)", display: "grid", placeItems: "center", fontWeight: 800 }}>t</span>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontWeight: 600 }}>{t?.name}</div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{t?.location_name || "Counter"}</div>
        </div>
        <nav style={{ display: "flex", gap: 6, marginLeft: 20 }}>
          {([["sell", "Sell"], ["sales", "Today's sales"], ["settings", "Settings"]] as [Screen, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setScreen(k)} style={{ height: 36, padding: "0 14px", borderRadius: 10, color: "#fff", background: screen === k ? "rgba(255,255,255,.14)" : "transparent", opacity: screen === k ? 1 : 0.65 }}>{l}</button>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, fontSize: 13 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: back ? "rgba(255,255,255,.1)" : "var(--chili)" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: back ? "#5fd38d" : "#fff" }} />
            {back ? "Online" : "Offline: still billing"}
            {sync.queued > 0 && <b>· {sync.queued} to send</b>}
          </span>
          <span style={{ opacity: 0.75 }}>{staff.user.name}</span>
          {!bridge && <button onClick={() => { store.setStaff(null); setStaff(null); }} className="btn sm soft">Lock</button>}
        </div>
      </header>
      {bridge ? (
        <div style={{ padding: "8px 18px", fontSize: 13, background: back ? "var(--leaf-soft)" : "var(--saffron-soft)" }}>
          {back
            ? (sync.queued > 0 ? `Internet is back. Sending ${sync.queued} sale${sync.queued === 1 ? "" : "s"}, then the full POS opens.` : billOpen ? "Internet is back. Finish this bill and the full POS opens." : "Opening the full POS…")
            : "No internet: quick billing only. Sales are kept on this computer and sent when the connection returns. Tables, online orders and reports come back with the full POS."}
        </div>
      ) : <div />}
      <main style={{ minHeight: 0 }}>
        {screen === "sell" && <Sell staff={staff} boot={sync.boot} online={sync.online} onSaved={sync.kick} say={say} onBillChange={setBillOpen} />}
        {screen === "sales" && <Sales tenant={t} online={sync.online} onChange={sync.kick} say={say} />}
        {screen === "settings" && <Settings sync={sync} say={say} onSignOut={onSignOut} />}
      </main>
      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
