"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { AuthShell, NativeSelect } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function SignupPage() {
  return (
    <AuthShell
      title={<>Start your <em className="text-saffron">free</em> trial.</>}
      quote="Tell us about your restaurant. A real person on our team reviews every application, usually within one business day."
    >
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthShell>
  );
}

function SignupForm() {
  const params = useSearchParams();
  const [market, setMarket] = useState<"IN" | "US">(params.get("market") === "US" ? "US" : "IN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError("Passwords don't match");
    setBusy(true);
    setError("");
    try {
      await api("/public/signup", {
        token: null,
        body: {
          restaurant_name: f.get("restaurant_name"),
          market,
          contact_name: f.get("contact_name"),
          email: f.get("email"),
          phone: f.get("phone"),
          city: f.get("city"),
          cuisine: f.get("cuisine"),
          outlets: Number(f.get("outlets") || 1),
          service_style: f.get("service_style"),
          message: f.get("message"),
          password: f.get("password"),
        },
      });
      setDone(String(f.get("email")));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="rounded-3xl border border-border bg-card p-10 text-center">
        <CheckCircle2 className="mx-auto size-12 text-leaf" />
        <h2 className="mt-5 font-serif text-4xl">Application received</h2>
        <p className="mt-3 text-muted-foreground">
          We&apos;ll review your restaurant and email <span className="font-medium text-foreground">{done}</span> as soon as your 14-day trial is ready.
        </p>
        <Link href="/" className="mt-8 inline-block text-sm font-medium underline-offset-4 hover:underline">Back to home</Link>
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <h2 className="font-serif text-4xl tracking-tight">Apply for Tiffin</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Already approved? <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Sign in</Link>
        </p>
      </div>

      <div className="space-y-2"><Label>Billing currency</Label><div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1">
        {(["IN", "US"] as const).map((m) => (
          <button type="button" key={m} onClick={() => setMarket(m)}
            className={cn("rounded-lg py-2 text-sm font-medium transition", market === m ? "bg-card shadow-sm" : "text-muted-foreground")}>
            {m === "IN" ? "₹ Rupee (INR)" : "$ Dollar (USD)"}
          </button>
        ))}
      </div></div>

      <Section title="Restaurant">
        <Field label="Restaurant name" name="restaurant_name" required placeholder="e.g. Saffron & Smoke" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" name="city" required placeholder="Your city" />
          <Field label="Cuisine" name="cuisine" placeholder="e.g. Modern bistro, burgers, café…" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="service_style">Service style</Label>
            <NativeSelect id="service_style" name="service_style" defaultValue="Full service">
              {["Full service", "Quick service", "Cloud kitchen", "Café / bakery", "Bar / lounge", "Food court"].map((s) => <option key={s}>{s}</option>)}
            </NativeSelect>
          </div>
          <Field label="Number of outlets" name="outlets" type="number" min={1} defaultValue={1} />
        </div>
      </Section>

      <Section title="You">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" name="contact_name" required autoComplete="name" />
          <Field label="Phone" name="phone" type="tel" autoComplete="tel" placeholder="Include country code" />
        </div>
        <Field label="Work email" name="email" type="email" required autoComplete="email" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          <Field label="Confirm password" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="message">Anything we should know? <span className="text-muted-foreground">(optional)</span></Label>
          <Textarea id="message" name="message" rows={3} placeholder="Current POS, delivery partners, when you'd like to go live…" />
        </div>
      </Section>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={busy} className="h-12 w-full rounded-full text-base">
        {busy && <Loader2 className="size-4 animate-spin" />}Request free trial
      </Button>
      <p className="text-center text-xs text-muted-foreground">14 days free · No card required · We&apos;ll never share your details</p>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <legend className="px-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, name, ...props }: { label: string; name: string } & React.ComponentProps<"input">) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} className="h-10 bg-card" {...props} />
    </div>
  );
}
