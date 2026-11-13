"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

/** Change the signed-in user's own password. Works for owners and platform admins. */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close(o: boolean) {
    if (!o) { setCurrent(""); setNext(""); setConfirm(""); setError(""); }
    onOpenChange(o);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError("The new passwords don't match");
    setBusy(true);
    setError("");
    try {
      await api("/auth/password", { body: { current_password: current, new_password: next } });
      toast.success("Password changed");
      close(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Use at least 8 characters. You stay signed in on this device.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" required value={current}
              onChange={(e) => setCurrent(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={next}
              onChange={(e) => setNext(e.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} className="h-11" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className="h-11 rounded-xl bg-foreground font-semibold text-background disabled:opacity-40">
            {busy ? "Saving…" : "Change password"}
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
