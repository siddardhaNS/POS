"use client";

import { API_URL, session } from "./api";

let sent = 0;

/** Send a crash to the platform error log (admin console). Best effort: never throws, at most 10 per page load. */
export function reportError(err: unknown, where = "") {
  if (typeof window === "undefined" || sent >= 10) return;
  sent += 1;
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
  const token = session.get()?.token;
  fetch(`${API_URL}/client-errors`, {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ source: "web", message: `${e.name}: ${e.message}`.slice(0, 500), stack: (e.stack ?? "").slice(0, 20000),
      path: (where || window.location.pathname + window.location.hash).slice(0, 300) }),
  }).catch(() => {});
}
