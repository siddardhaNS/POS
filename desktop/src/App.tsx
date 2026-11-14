import { useCallback, useEffect, useState } from "react";
import { reportError } from "./lib/api";
import { store, type Session } from "./lib/store";
import { useSync } from "./lib/sync";
import { Setup } from "./screens/Setup";
import { Pin } from "./screens/Pin";
import { Sell } from "./screens/Sell";
import { Sales } from "./screens/Sales";
import { Settings } from "./screens/Settings";

export type Toast = (msg: string, bad?: boolean) => void;
type Screen = "sell" | "sales" | "settings";

export default function App() {
  const [device, setDevice] = useState<Session | null>(() => store.device());
  const [staff, setStaff] = useState<Session | null>(() => store.staff());
  const [screen, setScreen] = useState<Screen>("sell");
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);
  const sync = useSync(!!device);

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

  if (!device) return <Setup onDone={(s) => { store.setDevice(s); store.setStaff(null); setDevice(s); setStaff(null); }} />;
  if (!staff) return <Pin device={device} online={sync.online} onDone={(s) => { store.setStaff(s); setStaff(s); }}
    onSignOut={() => { store.clearSignIn(); setDevice(null); setStaff(null); }} />;

  const t = sync.boot?.tenant ?? staff.tenant;
  const lock = () => { store.setStaff(null); setStaff(null); };

  return (
    <div style={{ display: "grid", gridTemplateRows: "56px 1fr", height: "100%" }}>
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
          <span title={sync.lastSync ? `Last synced ${new Date(sync.lastSync).toLocaleTimeString()}` : ""}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: sync.online === false ? "var(--chili)" : "rgba(255,255,255,.1)" }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: sync.online === false ? "#fff" : sync.online ? "#5fd38d" : "#aaa" }} />
            {sync.online === false ? "Offline: still billing" : sync.online ? "Online" : "Connecting…"}
            {sync.queued > 0 && <b>· {sync.queued} to send</b>}
          </span>
          <span style={{ opacity: 0.75 }}>{staff.user.name}</span>
          <button onClick={lock} className="btn sm soft">Lock</button>
        </div>
      </header>
      <main style={{ minHeight: 0 }}>
        {screen === "sell" && <Sell staff={staff} boot={sync.boot} online={sync.online} onSaved={sync.kick} say={say} />}
        {screen === "sales" && <Sales tenant={t} online={sync.online} onChange={sync.kick} say={say} />}
        {screen === "settings" && <Settings sync={sync} say={say} onSignOut={() => { store.clearSignIn(); setDevice(null); setStaff(null); }} />}
      </main>
      {toast && <div className={`toast ${toast.bad ? "bad" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
