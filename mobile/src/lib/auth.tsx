import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, sessions, setToken, whenUnauthorized, type Session } from "./api";

/**
 * Two levels, like the counter POS:
 * - device: the restaurant signed in once on this phone with an owner / manager email and password;
 * - staff: whoever picked their name and typed their PIN. Their role decides what the app shows.
 */
interface Auth {
  ready: boolean;
  device: Session | null;
  staff: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  pinIn: (userId: string, pin: string) => Promise<void>;
  lock: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Session | null>(null);

  useEffect(() => {
    sessions.load().then(({ device: d, staff: s }) => {
      setDevice(d);
      const st = d && s && s.tenant?.id === d.tenant?.id ? s : null;
      setStaff(st);
      setToken(st?.token ?? d?.token ?? null);
      setReady(true);
    });
  }, []);

  const lock = useCallback(async () => {
    await sessions.clearStaff();
    setStaff(null);
    setToken(device?.token ?? null);
  }, [device]);

  const signOut = useCallback(async () => {
    await sessions.clearAll();
    setStaff(null);
    setDevice(null);
    setToken(null);
  }, []);

  // An expired staff session drops back to the PIN screen; an expired device session to sign-in.
  useEffect(() => { whenUnauthorized(() => { if (staff) void lock(); else void signOut(); }); }, [staff, lock, signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await api<Session>("/auth/login", { body: { email: email.trim(), password }, token: null });
    if (!s.tenant) throw new Error("This is a platform admin account. Sign in with a restaurant account.");
    await sessions.saveDevice(s);
    await sessions.clearStaff();
    setDevice(s);
    setStaff(null);
    setToken(s.token);
  }, []);

  const pinIn = useCallback(async (userId: string, pin: string) => {
    if (!device) throw new Error("Sign in first");
    const s = await api<Session>("/auth/pin", { body: { user_id: userId, pin }, token: device.token });
    await sessions.saveStaff(s);
    setStaff(s);
    setToken(s.token);
  }, [device]);

  /** Pick up role, permission or module changes made elsewhere. */
  const refresh = useCallback(async () => {
    if (!staff) return;
    try {
      const me = await api<{ user: Session["user"]; tenant: Session["tenant"] }>("/pos/me");
      const next = { ...staff, user: me.user, tenant: me.tenant };
      setStaff(next);
      await sessions.saveStaff(next);
    } catch { /* offline: keep what we have */ }
  }, [staff]);

  const value = useMemo(() => ({ ready, device, staff, signIn, pinIn, lock, signOut, refresh }),
    [ready, device, staff, signIn, pinIn, lock, signOut, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

/** The signed-in staff member's session (screens under (app) only render with one). */
export function useStaff() {
  const { staff } = useAuth();
  if (!staff) throw new Error("No staff session");
  return staff;
}
