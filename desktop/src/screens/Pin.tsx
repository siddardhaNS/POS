import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { store, type Session } from "../lib/store";

/**
 * Who's on the till. PINs are checked by the server, so switching staff needs the internet; when it's down, the last
 * person signed in can carry on (sales are queued under the counter's sign-in).
 */
export function Pin({ device, online, onDone, onSignOut }: { device: Session; online: boolean | null; onDone: (s: Session) => void; onSignOut: () => void }) {
  const boot = store.boot();
  const [staff, setStaff] = useState(boot?.staff ?? []);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const last = localStorage.getItem("tc.lastStaff");

  useEffect(() => {
    api<{ id: string; name: string; role: string }[]>("/pos/staff", { token: device.token }).then(setStaff).catch(() => {});
  }, [device.token]);

  useEffect(() => {
    if (pin.length !== 4 || !who) return;
    api<Session>("/auth/pin", { body: { user_id: who.id, pin }, token: device.token })
      .then((s) => { localStorage.setItem("tc.lastStaff", JSON.stringify(s)); onDone(s); })
      .catch((e) => { setError((e as Error).message); setPin(""); });
  }, [pin, who, device.token, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!who) return;
      if (/^\d$/.test(e.key)) setPin((p) => (p + e.key).slice(0, 4));
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      if (e.key === "Escape") { setWho(null); setPin(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [who]);

  const offlineAs = last ? (JSON.parse(last) as Session) : null;

  return (
    <div className="center">
      <div style={{ width: 560, display: "grid", gap: 16 }}>
        <div className="muted">{device.tenant?.name}{device.tenant?.location_name ? ` · ${device.tenant.location_name}` : ""}</div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{who ? `Hi ${who.name.split(" ")[0]}, your PIN` : "Who's on the till?"}</div>
        {online === false && (
          <div className="card" style={{ padding: 14, background: "var(--saffron-soft)", borderColor: "transparent" }}>
            Offline: PINs need the internet.
            {offlineAs && offlineAs.tenant?.id === device.tenant?.id && <> <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => onDone(offlineAs)}>Continue as {offlineAs.user.name}</button></>}
          </div>
        )}
        {!who ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {staff.map((u) => (
              <button key={u.id} onClick={() => { setWho(u); setPin(""); setError(""); }} className="card" style={{ padding: 16, textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>{u.name}</div><div className="muted" style={{ textTransform: "capitalize" }}>{u.role}</div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16, justifyItems: "center" }}>
            <div style={{ display: "flex", gap: 14 }}>{[0, 1, 2, 3].map((i) => <span key={i} style={{ width: 16, height: 16, borderRadius: 8, background: i < pin.length ? "var(--ink)" : "var(--line)" }} />)}</div>
            {error && <div style={{ color: "var(--chili)" }}>{error}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 84px)", gap: 10 }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((k, i) => (
                <button key={i} disabled={!k} onClick={() => setPin((p) => (k === "⌫" ? p.slice(0, -1) : (p + k).slice(0, 4)))} className="card"
                  style={{ height: 64, fontSize: 24, fontWeight: 600, visibility: k ? "visible" : "hidden" }}>{k}</button>
              ))}
            </div>
            <button className="btn soft" onClick={() => { setWho(null); setPin(""); }}>Not you?</button>
          </div>
        )}
        <button className="muted" style={{ justifySelf: "start" }} onClick={() => { if (confirm("Sign this counter out? Unsent sales stay on this computer.")) onSignOut(); }}>Sign this counter out</button>
      </div>
    </div>
  );
}
