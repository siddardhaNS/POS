"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errors";

/** Catches uncaught errors and rejected promises anywhere in the app and reports them. */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError(e.error ?? e.message);
    const onReject = (e: PromiseRejectionEvent) => {
      const r = e.reason as { status?: number } | undefined;
      if (r && typeof r.status === "number" && r.status < 500) return; // expected API answers (validation, auth)
      reportError(e.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onReject); };
  }, []);
  return null;
}
