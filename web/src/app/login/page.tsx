"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, session, type Session } from "@/lib/api";

const DEMOS = [
  { l: "India demo (owner)", e: "owner@tiffin.in", p: "demo12345" },
  { l: "US demo (owner)", e: "owner@saffronsmoke.com", p: "demo12345" },
  { l: "Platform admin", e: "admin@tiffin.app", p: "admin12345" },
];

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const s = await api<Session>("/auth/login", { token: null, body: { email, password } });
      if (s.user.role === "platform_admin") {
        session.set(s);
        router.push("/admin");
      } else {
        session.set(s, { device: true });
        router.push("/pos");
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={<>Welcome <em className="text-saffron">back.</em></>}
      quote="One login for service and back office. What you see depends on your role."
    >
      <form onSubmit={submit} className="space-y-6">
        <div>
          <h2 className="font-serif text-4xl tracking-tight">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            New to Tiffin? <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">Start a free trial</Link>
          </p>
        </div>
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
          </div>
        </div>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy} className="h-12 w-full rounded-full text-base">
          {busy && <Loader2 className="size-4 animate-spin" />}Sign in
        </Button>
        {process.env.NODE_ENV !== "production" && (
          <div className="rounded-2xl border border-dashed border-border p-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Demo accounts</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {DEMOS.map((d) => (
                <button key={d.e} type="button" onClick={() => { setEmail(d.e); setPassword(d.p); }}
                  className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium hover:bg-accent">{d.l}</button>
              ))}
            </div>
          </div>
        )}
      </form>
    </AuthShell>
  );
}
