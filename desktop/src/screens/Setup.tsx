import { useState } from "react";
import { api } from "../lib/api";
import { store, type Session } from "../lib/store";

/** First run: which server, and the owner or a manager signs this computer in. Needs the internet once. */
export function Setup({ onDone }: { onDone: (s: Session) => void }) {
  const [url, setUrl] = useState(store.config().apiUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    store.setConfig({ apiUrl: url.trim().replace(/\/+$/, "") });
    try {
      const s = await api<Session>("/auth/login", { body: { email: email.trim(), password }, token: null });
      if (!s.tenant) throw new Error("That's a platform admin account. Sign in with a restaurant account.");
      onDone(s);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="center">
      <form onSubmit={go} className="card" style={{ width: 420, padding: 28, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--saffron)", display: "grid", placeItems: "center", fontWeight: 800 }}>t</span>
          <b style={{ fontSize: 20 }}>Tiffin Counter</b>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Set up this counter</div>
        <div className="muted">The owner or a manager signs in once. After that, staff use their PINs, and billing keeps working when the internet drops.</div>
        <label className="muted">Server<input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://app.yourdomain.com/api" /></label>
        <input className="input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <input className="input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div style={{ color: "var(--chili)" }}>{error}</div>}
        <button className="btn" disabled={busy || !email || !password || !url}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
