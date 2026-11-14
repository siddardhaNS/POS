import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api } from "./api";

/**
 * Load an endpoint and keep it fresh: refetch every `ms` while the app is in the foreground, and right away when it
 * comes back to the foreground. Pass null to skip.
 */
export function useLive<T>(path: string | null, ms = 8000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(load, 0);
    if (!ms) return () => { alive.current = false; clearTimeout(first); };
    const t = setInterval(() => { if (AppState.currentState === "active") load(); }, ms);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") load(); });
    return () => { alive.current = false; clearTimeout(first); clearInterval(t); sub.remove(); };
  }, [load, ms]);

  return { data, error, loading, reload: load, setData };
}
