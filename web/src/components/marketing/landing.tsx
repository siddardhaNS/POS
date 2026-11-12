"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight, BarChart3, Bike, ChefHat, Check, CreditCard, LayoutGrid, Lock, Package, ScrollText, Sparkles, Users, UtensilsCrossed,
} from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { Eyebrow, Logo } from "@/components/brand";
import { cn } from "@/lib/utils";

type Market = "IN" | "US";

const COPY = {
  IN: {
    flag: "India",
    hero: "From the first KOT to the last UPI payment.",
    sub: "Floor, kitchen, Swiggy & Zomato, GST invoices and inventory in one calm system. Built for Indian kitchens that run on rush hours.",
    currency: (v: number) => "₹" + Math.round(v).toLocaleString("en-IN"),
    items: [["Hyderabadi Chicken Biryani", 2, 349], ["Butter Naan", 4, 59], ["Sweet Lassi", 2, 129]] as const,
    taxLabel: "CGST 2.5% + SGST 2.5%", tax: 0.05, pay: "UPI · Dynamic QR", channels: ["Swiggy", "Zomato", "Website"],
    compliance: ["GST-ready invoices with CGST / SGST / IGST split", "Dynamic UPI QR on the customer display", "Swiggy & Zomato menus synced from one place", "FSSAI number and HSN codes on every bill", "Multi-outlet stock with purchase orders on WhatsApp", "Works on patchy internet and keeps billing offline"],
    price: { starter: "₹1,499", growth: "₹2,999", unit: "/ outlet / month + GST" },
  },
  US: {
    flag: "United States",
    hero: "From the first ticket to the last tip.",
    sub: "Floor, kitchen display, DoorDash & Uber Eats, sales tax and tips in one calm system. Built for American dining rooms that never slow down.",
    currency: (v: number) => "$" + v.toFixed(2),
    items: [["Chicken Tikka Masala", 2, 18.99], ["Garlic Naan", 2, 4.99], ["Mango Lassi", 2, 5.99]] as const,
    taxLabel: "Sales tax 8.875%", tax: 0.08875, pay: "Tap to pay · 20% tip", channels: ["DoorDash", "Uber Eats", "Website"],
    compliance: ["Sales tax by location, with exempt items", "Suggested tips, tip pooling and payouts by role", "Tap to Pay, EMV card readers and split checks", "DoorDash & Uber Eats orders straight to the KDS", "Labor scheduling with overtime alerts", "Works on patchy internet and keeps billing offline"],
    price: { starter: "$69", growth: "$139", unit: "/ location / month" },
  },
} as const;

const FEATURES = [
  { icon: LayoutGrid, t: "Floor & tables", d: "A live map of your dining room. See who's waiting, who's eating and who's ready to pay at a glance." },
  { icon: ScrollText, t: "Orders & KOTs", d: "Fire courses to the right station with one tap. Modifiers, notes and allergies print where they matter." },
  { icon: ChefHat, t: "Kitchen display", d: "Tickets by age, by station or by dish. The kitchen sees what's late before the guest does." },
  { icon: Bike, t: "Online orders", d: "Aggregator and website orders land in one queue with auto-accept, busy mode and prep timers." },
  { icon: CreditCard, t: "Payments", d: "Split by guest or by item, add tips, and take UPI, card, tap or cash. Every rupee and dollar reconciles." },
  { icon: UtensilsCrossed, t: "Menu everywhere", d: "Change a price or 86 an item once and it updates on the POS, the delivery apps and your website." },
  { icon: Package, t: "Inventory", d: "Recipe-level food cost, low-stock alerts and purchase orders sent to suppliers automatically." },
  { icon: Users, t: "Staff & roles", d: "PIN login on shared devices. Owners, managers, cashiers, captains and chefs each see only what they need." },
  { icon: BarChart3, t: "Reports", d: "Sales by hour, channel and server. Food cost, voids and discounts, so you can act on them during service." },
];

const SEGMENTS = ["Fine dining", "Casual dining", "Quick service", "Cloud kitchens", "Cafés & bakeries", "Bars & lounges", "Food courts", "Multi-outlet chains"];

const FAQ = [
  ["How does the free trial work?", "Apply in two minutes. Our team reviews every restaurant, usually within one business day. Once approved you get 14 days free, with your menu and floor ready to go."],
  ["Do I need new hardware?", "No. Tiffin runs in the browser on any tablet, laptop or desktop, and our iOS and Android apps are coming soon. Bring your own printer and card reader, or we can recommend some."],
  ["Can I run multiple outlets or brands?", "Yes. Every outlet has its own floor, menu prices and staff, and you can see reports across all of them from the back office."],
  ["Is my data separate from other restaurants?", "Yes. Each restaurant is its own tenant with its own data, and every request is scoped to your account."],
];

export function Landing() {
  const [market, setMarket] = useState<Market>("IN");
  const C = COPY[market];
  const sub = C.items.reduce((a, [, q, p]) => a + q * p, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="absolute inset-x-0 top-0 z-30">
        <div className="mx-auto flex h-20 max-w-7xl items-center gap-8 px-5 md:px-8">
          <Logo dark />
          <nav className="hidden items-center gap-7 text-sm text-white/65 md:flex">
            <a href="#product" className="transition hover:text-white">Product</a>
            <a href="#markets" className="transition hover:text-white">India & US</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="hidden px-3 text-sm text-white/75 transition hover:text-white sm:block">Sign in</Link>
            <LinkButton href={`/signup?market=${market}`} className="h-10 rounded-full bg-saffron px-5 text-[#1d1c1a] hover:bg-saffron/90">Start free trial</LinkButton>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-[#1d1c1a] pt-32 pb-24 text-white md:pt-40 md:pb-32">
        <div className="pointer-events-none absolute -top-40 right-[-10%] size-[640px] rounded-full bg-saffron/20 blur-[140px]" />
        <div className="pointer-events-none absolute bottom-[-30%] left-[-10%] size-[520px] rounded-full bg-[oklch(0.45_0.1_30)]/25 blur-[140px]" />
        <div className="relative mx-auto grid max-w-7xl gap-14 px-5 md:px-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <MarketToggle market={market} onChange={setMarket} dark />
            <h1 className="mt-7 font-serif text-[44px] leading-[1.02] tracking-tight text-balance sm:text-6xl lg:text-[76px]">
              {C.hero.split(" ").slice(0, -2).join(" ")}{" "}
              <em className="text-saffron">{C.hero.split(" ").slice(-2).join(" ")}</em>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/65">{C.sub}</p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <LinkButton href={`/signup?market=${market}`} size="lg" className="h-12 rounded-full bg-saffron px-7 text-base text-[#1d1c1a] hover:bg-saffron/90">Start your 14-day free trial <ArrowRight className="ml-1 size-4" /></LinkButton>
              <LinkButton href="/login" size="lg" variant="ghost" className="h-12 rounded-full px-6 text-base text-white hover:bg-white/10 hover:text-white">See the demo</LinkButton>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/50">
              {["No card required", "Live in an evening", "Cancel anytime"].map((t) => (
                <span key={t} className="flex items-center gap-2"><Check className="size-4 text-saffron" />{t}</span>
              ))}
            </div>
          </div>

          {/* Product vignette */}
          <div className="relative">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-3 shadow-2xl backdrop-blur">
              <div className="rounded-[20px] bg-[#f5f4f0] p-5 text-[#1d1c1a]">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Table 4 · 3 guests</div>
                    <div className="text-lg font-semibold">Dinner service</div>
                  </div>
                  <span className="rounded-lg bg-accent px-2.5 py-1 font-mono text-[11px] font-semibold text-accent-foreground">KOT 214 · Sent</span>
                </div>
                <div className="mt-4 divide-y divide-border rounded-2xl bg-white px-4">
                  {C.items.map(([n, q, p]) => (
                    <div key={n} className="flex items-center gap-3 py-3 text-sm">
                      <span className="grid size-7 place-items-center rounded-lg bg-muted font-mono text-xs font-semibold">{q}</span>
                      <span className="flex-1 font-medium">{n}</span>
                      <span className="tabular font-mono text-[13px]">{C.currency(q * p)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-1.5 px-1 text-sm">
                  <Row l="Subtotal" v={C.currency(sub)} />
                  <Row l={C.taxLabel} v={C.currency(sub * C.tax)} />
                  <div className="flex items-baseline justify-between pt-2">
                    <span className="font-semibold">Total</span>
                    <span className="tabular font-mono text-2xl font-semibold">{C.currency(sub * (1 + C.tax))}</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#1d1c1a] px-4 py-3.5 text-white">
                  <CreditCard className="size-5 text-saffron" />
                  <span className="flex-1 text-sm font-medium">{C.pay}</span>
                  <span className="rounded-full bg-leaf px-2.5 py-0.5 text-xs font-semibold text-white">Paid</span>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-8 -left-6 hidden w-64 rounded-2xl border border-white/10 bg-[#2a2926] p-4 text-white shadow-2xl sm:block">
              <div className="flex items-center justify-between text-xs text-white/50">
                <span>{C.channels[0]} · #4821</span><span className="font-mono text-saffron">00:42 left</span>
              </div>
              <div className="mt-1.5 text-sm font-medium">New order · 3 items</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold">
                <span className="rounded-lg bg-white/10 py-2 text-center">Reject</span>
                <span className="rounded-lg bg-saffron py-2 text-center text-[#1d1c1a]">Accept</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Segments */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-5 py-8 text-sm text-muted-foreground md:px-8">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em]">Made for</span>
          {SEGMENTS.map((s) => <span key={s} className="font-serif text-lg italic text-foreground/70">{s}</span>)}
        </div>
      </section>

      {/* Features */}
      <section id="product" className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <div className="max-w-2xl">
          <Eyebrow>The whole restaurant</Eyebrow>
          <h2 className="mt-4 font-serif text-4xl leading-[1.05] tracking-tight md:text-6xl">
            Front of house, back of house, <em className="text-saffron-deep">one</em> source of truth.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Tiffin replaces the billing app, the KOT printer software, the aggregator tablets and the spreadsheet in the office.
          </p>
        </div>
        <div className="mt-16 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, t, d }) => (
            <div key={t} className="group bg-card p-8 transition hover:bg-[oklch(0.985_0.01_80)]">
              <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground transition group-hover:bg-saffron group-hover:text-[#1d1c1a]">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-6 text-lg font-semibold">{t}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Markets */}
      <section id="markets" className="bg-[#1d1c1a] py-24 text-white md:py-32">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Eyebrow className="text-white/45">Two markets, one product</Eyebrow>
              <h2 className="mt-4 font-serif text-4xl leading-[1.05] tracking-tight md:text-6xl">
                Speaks <em className="text-saffron">GST</em> in Bengaluru.<br />Speaks <em className="text-saffron">sales tax</em> in Brooklyn.
              </h2>
            </div>
            <MarketToggle market={market} onChange={setMarket} dark />
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {C.compliance.map((c, i) => (
              <div key={c} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <span className="font-mono text-xs text-saffron">{String(i + 1).padStart(2, "0")}</span>
                <p className="mt-3 text-[17px] leading-snug text-white/85">{c}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <Eyebrow>Getting started</Eyebrow>
            <h2 className="mt-4 font-serif text-4xl leading-[1.05] tracking-tight md:text-5xl">Live before tonight&apos;s dinner rush.</h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Every restaurant on Tiffin is reviewed by a person, so you get a setup that fits your kitchen and not a generic template.
            </p>
          </div>
          <ol className="grid gap-4">
            {[
              ["Apply for a free trial", "Tell us about your restaurant, your outlets and how you serve. It takes about two minutes."],
              ["We review and approve", "Our team checks every application, usually within one business day, and emails you when you're in."],
              ["Ring your first sale", "Your menu, tables and taxes are pre-loaded for your market. Add staff PINs and start service."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-6 rounded-3xl border border-border bg-card p-7">
                <span className="font-serif text-5xl leading-none text-saffron">{i + 1}</span>
                <div>
                  <h3 className="text-lg font-semibold">{t}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-y border-border bg-[oklch(0.95_0.008_85)] py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="flex flex-col items-center text-center">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="mt-4 font-serif text-4xl tracking-tight md:text-6xl">Simple, per-outlet pricing.</h2>
            <div className="mt-8"><MarketToggle market={market} onChange={setMarket} /></div>
          </div>
          <div className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-3">
            {[
              { n: "Starter", p: C.price.starter, d: "For a single outlet getting off paper.", f: ["POS, floor & KOT", "Kitchen display", "Menu & taxes", "Up to 5 staff"] },
              { n: "Growth", p: C.price.growth, d: "For busy rooms and delivery-heavy kitchens.", f: ["Everything in Starter", "Online order integrations", "Inventory & purchase orders", "Unlimited staff & roles"], hi: true },
              { n: "Enterprise", p: "Let's talk", d: "For chains, franchises and multi-brand groups.", f: ["Everything in Growth", "Central menu & pricing", "Custom reports & API", "Dedicated success manager"] },
            ].map((pl) => (
              <div key={pl.n} className={cn("flex flex-col rounded-3xl border p-8", pl.hi ? "border-transparent bg-[#1d1c1a] text-white shadow-2xl md:-my-4 md:py-12" : "border-border bg-card")}>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{pl.n}</h3>
                  {pl.hi && <span className="flex items-center gap-1 rounded-full bg-saffron px-2.5 py-0.5 text-xs font-semibold text-[#1d1c1a]"><Sparkles className="size-3" />Popular</span>}
                </div>
                <p className={cn("mt-2 text-sm", pl.hi ? "text-white/60" : "text-muted-foreground")}>{pl.d}</p>
                <div className="mt-7 flex items-baseline gap-2">
                  <span className="font-serif text-5xl">{pl.p}</span>
                  {pl.p !== "Let's talk" && <span className={cn("text-xs", pl.hi ? "text-white/50" : "text-muted-foreground")}>{C.price.unit}</span>}
                </div>
                <ul className="mt-7 flex-1 space-y-3 text-sm">
                  {pl.f.map((f) => <li key={f} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-saffron" />{f}</li>)}
                </ul>
                <LinkButton href={`/signup?market=${market}`} className={cn("mt-8 h-11 rounded-full", pl.hi ? "bg-saffron text-[#1d1c1a] hover:bg-saffron/90" : "")} variant={pl.hi ? "default" : "outline"}>{pl.p === "Let's talk" ? "Contact sales" : "Start free trial"}</LinkButton>
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-sm text-muted-foreground">Every plan starts with a 14-day free trial. No card required.</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto grid max-w-7xl gap-12 px-5 py-24 md:px-8 md:py-32 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <Eyebrow>Questions</Eyebrow>
          <h2 className="mt-4 font-serif text-4xl tracking-tight md:text-5xl">Before you apply</h2>
        </div>
        <div className="divide-y divide-border border-y border-border">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium">
                {q}<span className="text-2xl font-light text-muted-foreground transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 pb-24 md:px-8">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] bg-[#1d1c1a] px-8 py-20 text-center text-white md:py-28">
          <div className="pointer-events-none absolute left-1/2 top-0 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron/25 blur-[120px]" />
          <h2 className="relative mx-auto max-w-3xl font-serif text-4xl leading-[1.05] tracking-tight md:text-7xl">
            Your best service starts <em className="text-saffron">tonight.</em>
          </h2>
          <p className="relative mx-auto mt-5 max-w-lg text-white/60">Apply in two minutes. A real person reviews every restaurant.</p>
          <LinkButton href={`/signup?market=${market}`} size="lg" className="relative mt-9 h-12 rounded-full bg-saffron px-8 text-base text-[#1d1c1a] hover:bg-saffron/90">Start your free trial <ArrowRight className="ml-1 size-4" /></LinkButton>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-sm text-muted-foreground md:flex-row md:items-center md:px-8">
          <Logo />
          <span className="md:ml-6">Restaurant POS for India & the United States.</span>
          <div className="flex items-center gap-6 md:ml-auto">
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <Link href="/admin" className="flex items-center gap-1.5 hover:text-foreground"><Lock className="size-3.5" />Admin</Link>
            <span>© {new Date().getFullYear()} Tiffin</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{l}</span><span className="tabular font-mono text-[13px]">{v}</span>
    </div>
  );
}

function MarketToggle({ market, onChange, dark }: { market: Market; onChange: (m: Market) => void; dark?: boolean }) {
  return (
    <div className={cn("inline-flex rounded-full p-1 text-sm", dark ? "bg-white/[0.07] ring-1 ring-white/10" : "bg-card ring-1 ring-border")}>
      {(["IN", "US"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={cn(
            "rounded-full px-4 py-1.5 font-medium transition",
            market === m
              ? dark ? "bg-white text-[#1d1c1a]" : "bg-[#1d1c1a] text-white"
              : dark ? "text-white/60 hover:text-white" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m === "IN" ? "🇮🇳 India" : "🇺🇸 United States"}
        </button>
      ))}
    </div>
  );
}
