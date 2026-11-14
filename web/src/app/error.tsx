"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/errors";

/** A screen crashed while rendering: report it and offer a way back instead of a blank page. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { reportError(error); }, [error]);
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="max-w-sm space-y-4">
        <div className="text-xl font-semibold">Something went wrong on this screen</div>
        <p className="text-sm text-muted-foreground">It has been reported to the Tiffin team. Your checks and payments are saved on the server.</p>
        <div className="flex justify-center gap-2">
          <button onClick={reset} className="h-11 rounded-xl bg-foreground px-5 font-semibold text-background">Try again</button>
          <button onClick={() => window.location.reload()} className="h-11 rounded-xl bg-muted px-5 font-semibold">Reload</button>
        </div>
      </div>
    </div>
  );
}
