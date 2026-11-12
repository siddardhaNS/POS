"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight, ArrowUpRight, BarChart3, Bell, Bike, ChefHat, Check, Clock, CreditCard, Flame, Laptop, LayoutGrid, Lock,
  Monitor, Package, QrCode, ScanLine, ShieldCheck, Smartphone, Sparkles, Tablet, Timer, TrendingUp, Users, UtensilsCrossed, Wifi,
} from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { Eyebrow, Logo } from "@/components/brand";
import { cn } from "@/lib/utils";

const money = (v: number) => v.toFixed(2);

const SEGMENTS = ["Full service", "Quick service", "Fine dining", "Cafés & bakeries", "Bars & breweries", "Cloud kitchens", "Food courts", "Multi-location groups"];

const TABS = [
  {
    id: "pos", icon: LayoutGrid, label: "Point of sale",
    title: "Ring it in faster than they can say “and a side of…”",
    body: "A clean, touch-first order screen your newest server learns in one shift. Modifiers, courses, seat numbers and split checks are all one tap away.",
    points: ["Floor plan with live table status", "Courses, seats and modifiers", "Split by item, seat or amount", "Works through internet blips"],
  },
  {
    id: "kds", icon: ChefHat, label: "Kitchen display",
    title: "The kitchen sees what's late before the guest does.",
    body: "Tickets route to the right station the moment they're fired. Colour-coded timers keep every cook on the same clock.",
    points: ["Routing by station", "Ticket timers & bump bar flow", "Allergy and note highlights", "All-day counts per dish"],
  },
  {
    id: "online", icon: Bike, label: "Online orders",
    title: "Every delivery tablet, folded into one queue.",
    body: "Delivery partner and website orders land beside your dine-in tickets with auto-accept, busy mode and prep timers.",
    points: ["One queue for every channel", "Auto-accept & busy mode", "Prep-time countdowns", "Pause items everywhere at once"],
  },
  {
    id: "office", icon: BarChart3, label: "Back office",
    title: "Know how tonight is going while it's still going.",
    body: "Sales by hour, channel and server, food cost, voids and discounts, live from any device, for one location or twenty.",
    points: ["Live sales dashboard", "Recipe-level food cost", "Low-stock alerts", "Staff roles & PIN access"],
  },
  {
    id: "menu", icon: ScanLine, label: "Menu import",
    title: "Snap your paper menu. We'll do the typing.",
    body: "Upload a photo or a spreadsheet and Tiffin builds your categories, items and prices for you. Review, tweak, publish.",
    points: ["Photo & PDF menu scanning", "CSV / spreadsheet upload", "Editable preview before import", "Live in minutes, not days"],
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

const FAQ = [
  ["How does the free trial work?", "Apply in about two minutes. Our team reviews every restaurant, usually within one business day. Once approved you get 14 days free, with your menu and floor ready to go."],
  ["Do I need new hardware?", "No. Tiffin runs in the browser on the tablets, laptops and desktops you already own. Bring your own receipt printer and card reader, or ask us for recommendations."],
  ["Can I run multiple locations or brands?", "Yes. Each location has its own floor, menu prices and staff, and the back office shows reports across all of them."],
  ["How do I get my menu in?", "Upload a photo of your menu or a spreadsheet. Tiffin reads it, shows you an editable preview, and imports it in one click."],
  ["Is my data separate from other restaurants?", "Yes. Each restaurant is its own tenant with its own data, and every request is scoped to your account."],
] as const;

export function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [tab, setTab] = useState<TabId>("pos");

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      {/* Nav */}
      <header className={cn("fixed inset-x-0 top-0 z-40 transition-all", scrolled ? "border-b border-border/70 bg-background/80 backdrop-blur-xl" : "bg-transparent")}>
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5 md:h-[72px] md:px-8">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground lg:flex">
            <a href="#platform" className="transition hover:text-foreground">Platform</a>
            <a href="#features" className="transition hover:text-foreground">Features</a>
            <a href="#hardware" className="transition hover:text-foreground">Hardware</a>
            <a href="#plans" className="transition hover:text-foreground">Plans</a>
            <a href="#faq" className="transition hover:text-foreground">FAQ</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="hidden px-3 text-sm font-medium text-muted-foreground transition hover:text-foreground sm:block">Sign in</Link>
            <LinkButton href="/signup" className="h-10 rounded-full px-5">Start free trial</LinkButton>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-28 md:pt-36">
        <div className="pointer-events-none absolute inset-0 -z-0 bg-[radial-gradient(60%_50%_at_75%_10%,oklch(0.88_0.09_65/0.55),transparent_70%),radial-gradient(40%_40%_at_10%_30%,oklch(0.93_0.04_150/0.5),transparent_70%)]" />
        <div className="pointer-events-none absolute inset-0 -z-0 bg-[linear-gradient(to_right,oklch(0_0_0/4%)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0_0_0/4%)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(70%_60%_at_50%_20%,black,transparent)]" />
        <div className="relative mx-auto max-w-7xl px-5 md:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <a href="#platform" onClick={() => setTab("menu")} className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 py-1 pl-1 pr-3 text-[13px] shadow-sm backdrop-blur transition hover:border-foreground/20">
              <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">New</span>
              Scan a paper menu and go live in minutes
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </a>
            <h1 className="mt-7 text-[44px] font-semibold leading-[1] tracking-[-0.035em] text-balance sm:text-6xl lg:text-[84px]">
              The restaurant POS that <span className="font-serif font-normal italic tracking-[-0.01em] text-saffron-deep">keeps up</span> with the rush.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Tables, tickets, kitchen display, online orders, payments and reports in one calm system that works on the devices you already own.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <LinkButton href="/signup" size="lg" className="h-12 w-full rounded-full px-7 text-base sm:w-auto">Start 14-day free trial <ArrowRight className="ml-1 size-4" /></LinkButton>
              <LinkButton href="/login" size="lg" variant="outline" className="h-12 w-full rounded-full bg-card px-7 text-base sm:w-auto">Try the live demo</LinkButton>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["No card required", "Set up in an evening", "Cancel anytime"].map((t) => (
                <span key={t} className="flex items-center gap-1.5"><Check className="size-4 text-leaf" />{t}</span>
              ))}
            </div>
          </div>

          <HeroProduct />
        </div>
      </section>

      {/* Segments */}
      <section className="border-y border-border bg-card/60">
        <div className="mx-auto max-w-7xl px-5 py-7 md:px-8">
          <div className="flex flex-col items-center gap-4 md:flex-row md:gap-8">
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Built for every kind of restaurant</span>
            <div className="relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
              <div className="flex w-max animate-[marquee_40s_linear_infinite] gap-3 hover:[animation-play-state:paused]">
                {[...SEGMENTS, ...SEGMENTS].map((s, i) => (
                  <span key={i} className="whitespace-nowrap rounded-full border border-border bg-background px-4 py-1.5 text-sm font-medium text-foreground/80">{s}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Platform tabs */}
      <section id="platform" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>One platform</Eyebrow>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-6xl">
            Every station, <span className="font-serif font-normal italic text-saffron-deep">in sync.</span>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Replace the billing app, the ticket printer software, the delivery tablets and the spreadsheet in the office.
          </p>
        </div>

        <div className="mt-12 flex justify-center">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-card p-1 shadow-sm [scrollbar-width:none]">
            {TABS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition",
                  tab === id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />{label}
              </button>
            ))}
          </div>
        </div>

        <div key={active.id} className="mt-10 grid animate-in fade-in slide-in-from-bottom-2 items-center gap-10 duration-500 lg:grid-cols-[1fr_1.25fr] lg:gap-16">
          <div>
            <h3 className="text-3xl font-semibold leading-tight tracking-[-0.02em] md:text-4xl">{active.title}</h3>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{active.body}</p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {active.points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[15px]">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground"><Check className="size-3" /></span>{p}
                </li>
              ))}
            </ul>
            <LinkButton href="/login" variant="link" className="mt-6 h-auto px-0 text-base">See it in the demo <ArrowUpRight className="size-4" /></LinkButton>
          </div>
          <div className="rounded-[28px] border border-border bg-gradient-to-br from-[oklch(0.94_0.04_70)] to-[oklch(0.95_0.02_150)] p-4 sm:p-8">
            <TabVisual id={active.id} />
          </div>
        </div>
      </section>

      {/* Bento features */}
      <section id="features" className="scroll-mt-20 bg-[#1d1c1a] py-24 text-white md:py-32">
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Eyebrow className="text-white/45">Front of house to back</Eyebrow>
              <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-6xl">
                Everything you need. <span className="font-serif font-normal italic text-saffron">Nothing you don&apos;t.</span>
              </h2>
            </div>
            <p className="max-w-sm text-white/60">Every feature is included in your trial, so you can run a real service before you decide.</p>
          </div>

          <div className="mt-14 grid gap-4 md:grid-cols-6">
            <Bento className="md:col-span-4" icon={CreditCard} t="Payments your way" d="Card, tap, QR and cash. Split by guest or item, add tips and discounts, and every shift reconciles to the cent.">
              <div className="mt-6 flex flex-wrap gap-2">
                {["Tap to pay", "Chip & PIN", "QR code", "Cash", "Split check", "Tips"].map((p) => (
                  <span key={p} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs text-white/75">{p}</span>
                ))}
              </div>
            </Bento>
            <Bento className="md:col-span-2" icon={Wifi} t="Offline-ready" d="Internet drops mid-rush? Keep taking orders. Everything syncs when you're back." />
            <Bento className="md:col-span-2" icon={Users} t="Staff & roles" d="PIN login on shared devices. Owners, managers, cashiers, servers and chefs each see only what they need." />
            <Bento className="md:col-span-2" icon={Package} t="Inventory" d="Recipe-level food cost, low-stock alerts and purchase orders to suppliers." />
            <Bento className="md:col-span-2" icon={UtensilsCrossed} t="Menu everywhere" d="Change a price or 86 an item once. It updates on the POS, delivery and your website." />
            <Bento className="md:col-span-3" icon={ShieldCheck} t="Your data, walled off" d="Every restaurant is its own tenant. Every request is scoped to your account, and admins can't see your tickets." />
            <Bento className="md:col-span-3" icon={TrendingUp} t="Taxes, done right" d="Set tax rates by item and location, with inclusive or exclusive pricing and clean, itemised receipts." />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-border px-5 md:grid-cols-4 md:divide-x md:px-8">
          {[
            ["2 min", "to apply"],
            ["< 1 day", "to get approved"],
            ["14 days", "free, no card"],
            ["0", "new hardware required"],
          ].map(([n, l]) => (
            <div key={l} className="px-2 py-10 text-center md:py-14">
              <div className="text-4xl font-semibold tracking-[-0.03em] md:text-5xl">{n}</div>
              <div className="mt-2 text-sm text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Flow */}
      <section className="mx-auto max-w-7xl px-5 py-24 md:px-8 md:py-32">
        <div className="max-w-2xl">
          <Eyebrow>A night on Tiffin</Eyebrow>
          <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-5xl">From first order to last call.</h2>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {[
            { i: LayoutGrid, t: "Ring it in", d: "Seat the table, add items with modifiers and notes, and hold or fire by course." },
            { i: Flame, t: "Fire to the kitchen", d: "Tickets appear on the right station's screen instantly, with timers and allergy flags." },
            { i: CreditCard, t: "Close & pay", d: "Split the check, take payment and tips, and turn the table, all from the same screen." },
          ].map(({ i: Icon, t, d }, n) => (
            <div key={t} className="relative rounded-3xl border border-border bg-card p-8">
              <div className="flex items-center justify-between">
                <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><Icon className="size-5" /></span>
                <span className="font-mono text-sm text-muted-foreground">0{n + 1}</span>
              </div>
              <h3 className="mt-8 text-xl font-semibold">{t}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Hardware */}
      <section id="hardware" className="scroll-mt-20 px-5 md:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-12 overflow-hidden rounded-[32px] border border-border bg-card p-8 md:p-14 lg:grid-cols-2">
          <div>
            <Eyebrow>Hardware</Eyebrow>
            <h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-5xl">
              Runs on what you <span className="font-serif font-normal italic text-saffron-deep">already own.</span>
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              No locked-in terminals and no long hardware contracts. Open Tiffin in a browser and start service. Native handheld apps are on the way.
            </p>
            <LinkButton href="/signup" className="mt-8 h-11 rounded-full px-6">Start free trial <ArrowRight className="ml-1 size-4" /></LinkButton>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { i: Tablet, t: "Tablets", d: "Counter & tableside" },
              { i: Laptop, t: "Laptops & desktops", d: "Front desk & office" },
              { i: Monitor, t: "Kitchen screens", d: "Any display with a browser" },
              { i: Smartphone, t: "Handheld apps", d: "iOS & Android", soon: true },
            ].map(({ i: Icon, t, d, soon }) => (
              <div key={t} className="rounded-2xl border border-border bg-background p-5">
                <div className="flex items-start justify-between">
                  <Icon className="size-7 text-foreground/80" strokeWidth={1.5} />
                  {soon && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">Coming soon</span>}
                </div>
                <div className="mt-6 font-semibold">{t}</div>
                <div className="text-sm text-muted-foreground">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="plans" className="mx-auto max-w-7xl scroll-mt-20 px-5 py-24 md:px-8 md:py-32">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Plans</Eyebrow>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] md:text-6xl">Simple, per-location plans.</h2>
          <p className="mt-5 text-lg text-muted-foreground">Start free for 14 days. Pricing is quoted in your local currency when you&apos;re approved, with no setup fees.</p>
        </div>
        <div className="mx-auto mt-14 grid max-w-5xl gap-5 md:grid-cols-3">
          {[
            { n: "Starter", d: "For a single location getting off paper.", f: ["POS, floor & tickets", "Kitchen display", "Menu import & taxes", "Up to 5 staff"] },
            { n: "Growth", d: "For busy rooms and delivery-heavy kitchens.", f: ["Everything in Starter", "Online order queue", "Inventory & purchase orders", "Unlimited staff & roles"], hi: true },
            { n: "Enterprise", d: "For chains, franchises and multi-brand groups.", f: ["Everything in Growth", "Central menu & pricing", "Custom reports & API", "Dedicated success manager"] },
          ].map((pl) => (
            <div key={pl.n} className={cn("flex flex-col rounded-3xl border p-8", pl.hi ? "border-transparent bg-[#1d1c1a] text-white shadow-2xl md:-my-4 md:py-12" : "border-border bg-card")}>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">{pl.n}</h3>
                {pl.hi && <span className="flex items-center gap-1 rounded-full bg-saffron px-2.5 py-0.5 text-xs font-semibold text-[#1d1c1a]"><Sparkles className="size-3" />Most popular</span>}
              </div>
              <p className={cn("mt-2 text-sm", pl.hi ? "text-white/60" : "text-muted-foreground")}>{pl.d}</p>
              <ul className="mt-7 flex-1 space-y-3 text-sm">
                {pl.f.map((f) => <li key={f} className="flex gap-2.5"><Check className="mt-0.5 size-4 shrink-0 text-saffron" />{f}</li>)}
              </ul>
              <LinkButton
                href="/signup"
                variant={pl.hi ? "default" : "outline"}
                className={cn("mt-8 h-11 rounded-full", pl.hi && "bg-saffron text-[#1d1c1a] hover:bg-saffron/90")}
              >
                {pl.n === "Enterprise" ? "Talk to us" : "Start free trial"}
              </LinkButton>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto grid max-w-7xl scroll-mt-20 gap-12 border-t border-border px-5 py-24 md:px-8 md:py-32 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] md:text-5xl">Questions, answered.</h2>
          <p className="mt-4 text-muted-foreground">Still curious? <Link href="/login" className="font-medium text-foreground underline underline-offset-4">Poke around the demo</Link>.</p>
        </div>
        <div className="divide-y divide-border border-y border-border">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium">
                {q}<span className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-xl font-light text-muted-foreground transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 pb-24 md:px-8">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[32px] bg-[#1d1c1a] px-8 py-20 text-center text-white md:py-28">
          <div className="pointer-events-none absolute left-1/2 top-0 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron/30 blur-[120px]" />
          <h2 className="relative mx-auto max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-0.035em] md:text-7xl">
            Your best service starts <span className="font-serif font-normal italic text-saffron">tonight.</span>
          </h2>
          <p className="relative mx-auto mt-5 max-w-lg text-white/60">Apply in two minutes. A real person reviews every restaurant.</p>
          <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LinkButton href="/signup" size="lg" className="h-12 rounded-full bg-saffron px-8 text-base text-[#1d1c1a] hover:bg-saffron/90">Start your free trial <ArrowRight className="ml-1 size-4" /></LinkButton>
            <LinkButton href="/login" size="lg" variant="ghost" className="h-12 rounded-full px-7 text-base text-white hover:bg-white/10 hover:text-white">Try the demo</LinkButton>
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-card/50">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-[1.5fr_1fr_1fr_1fr] md:px-8">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">The calm, all-in-one restaurant POS for dine-in, delivery and the back office.</p>
          </div>
          <FooterCol title="Product" links={[["Point of sale", "#platform"], ["Kitchen display", "#platform"], ["Online orders", "#platform"], ["Menu import", "#platform"]]} />
          <FooterCol title="Company" links={[["Features", "#features"], ["Hardware", "#hardware"], ["Plans", "#plans"], ["FAQ", "#faq"]]} />
          <FooterCol title="Account" links={[["Start free trial", "/signup"], ["Sign in", "/login"], ["Live demo", "/login"]]} />
        </div>
        <div className="mx-auto flex max-w-7xl items-center justify-between border-t border-border px-5 py-6 text-sm text-muted-foreground md:px-8">
          <span>© {new Date().getFullYear()} Tiffin</span>
          <Link href="/admin" className="flex items-center gap-1.5 hover:text-foreground"><Lock className="size-3.5" />Admin</Link>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Hero product composite ---------- */

const HERO_MENU = [
  ["Smash burger", 14.5], ["Truffle fries", 7], ["Caesar salad", 11], ["Margherita", 16],
  ["Wings · 8pc", 12.5], ["Iced tea", 4], ["Cold brew", 5], ["Cheesecake", 8.5],
] as const;
const HERO_CHECK = [["Smash burger", 2, 14.5, "No onion"], ["Truffle fries", 1, 7, ""], ["Cold brew", 2, 5, "Oat milk"]] as const;

function HeroProduct() {
  const sub = HERO_CHECK.reduce((a, [, q, p]) => a + q * p, 0);
  const tax = sub * 0.08;
  return (
    <div className="relative mx-auto mt-16 max-w-6xl pb-20 md:mt-20">
      <div className="rounded-[26px] border border-border bg-card/70 p-2 shadow-[0_40px_120px_-30px_oklch(0.4_0.08_60/0.35)] backdrop-blur md:p-3">
        <div className="overflow-hidden rounded-[20px] border border-border bg-background">
          {/* app bar */}
          <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
            <div className="flex gap-1.5"><i className="size-2.5 rounded-full bg-chili/70" /><i className="size-2.5 rounded-full bg-saffron/80" /><i className="size-2.5 rounded-full bg-leaf/70" /></div>
            <div className="ml-2 hidden gap-1 text-xs font-medium sm:flex">
              {["Floor", "Order", "Kitchen", "Online", "Reports"].map((t, i) => (
                <span key={t} className={cn("rounded-md px-2.5 py-1", i === 1 ? "bg-foreground text-background" : "text-muted-foreground")}>{t}</span>
              ))}
            </div>
            <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-leaf" />Online</span>
          </div>
          <div className="grid md:grid-cols-[1fr_340px]">
            {/* menu grid */}
            <div className="hidden p-4 md:block">
              <div className="flex gap-2 text-xs font-medium">
                {["Mains", "Sides", "Drinks", "Desserts"].map((c, i) => (
                  <span key={c} className={cn("rounded-full px-3 py-1.5", i === 0 ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{c}</span>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2.5">
                {HERO_MENU.map(([n, p], i) => (
                  <div key={n} className={cn("rounded-xl border border-border bg-card p-3 text-left", i === 0 && "ring-2 ring-saffron")}>
                    <div className={cn("mb-6 h-1.5 w-8 rounded-full", ["bg-saffron", "bg-leaf", "bg-sky", "bg-chili"][i % 4])} />
                    <div className="text-[13px] font-medium leading-tight">{n}</div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">{money(p)}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* check */}
            <div className="border-border bg-card p-4 md:border-l">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Table 12 · 4 guests</div>
                  <div className="font-semibold">Check #1042</div>
                </div>
                <span className="rounded-md bg-accent px-2 py-1 font-mono text-[11px] font-semibold text-accent-foreground">Course 1 · Fired</span>
              </div>
              <div className="mt-3 divide-y divide-border">
                {HERO_CHECK.map(([n, q, p, note]) => (
                  <div key={n} className="flex items-start gap-3 py-2.5 text-sm">
                    <span className="grid size-6 place-items-center rounded-md bg-muted font-mono text-[11px] font-semibold">{q}</span>
                    <div className="flex-1">
                      <div className="font-medium">{n}</div>
                      {note && <div className="text-xs text-saffron-deep">{note}</div>}
                    </div>
                    <span className="tabular font-mono text-[13px]">{money(q * p)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 space-y-1 border-t border-dashed border-border pt-3 text-sm text-muted-foreground">
                <div className="flex justify-between"><span>Subtotal</span><span className="tabular font-mono text-[13px]">{money(sub)}</span></div>
                <div className="flex justify-between"><span>Tax</span><span className="tabular font-mono text-[13px]">{money(tax)}</span></div>
                <div className="flex items-baseline justify-between pt-1 text-foreground"><span className="font-semibold">Total</span><span className="tabular font-mono text-xl font-semibold">{money(sub + tax)}</span></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-semibold">
                <span className="rounded-xl border border-border py-2.5 text-center">Split</span>
                <span className="rounded-xl bg-foreground py-2.5 text-center text-background">Pay</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* floating: KDS ticket */}
      <div className="absolute -left-4 bottom-0 hidden w-60 rotate-[-3deg] rounded-2xl border border-border bg-card p-4 shadow-2xl lg:block xl:-left-14">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-semibold">T12 · Grill</span>
          <span className="flex items-center gap-1 rounded-md bg-saffron/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-saffron-deep"><Timer className="size-3" />06:12</span>
        </div>
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between"><span>2 × Smash burger</span><Check className="size-4 text-leaf" /></div>
          <div className="text-xs font-medium text-chili">⚠ No onion</div>
          <div>1 × Truffle fries</div>
        </div>
        <div className="mt-3 rounded-lg bg-foreground py-1.5 text-center text-xs font-semibold text-background">Bump</div>
      </div>

      {/* floating: sales card */}
      <div className="absolute -right-4 bottom-6 hidden w-64 rotate-[2deg] rounded-2xl border border-white/10 bg-[#1d1c1a] p-4 text-white shadow-2xl lg:block xl:-right-12">
        <div className="flex items-center justify-between text-xs text-white/50"><span>Today&apos;s net sales</span><span className="flex items-center gap-1 text-leaf"><TrendingUp className="size-3" />12%</span></div>
        <div className="mt-1 font-mono text-2xl font-semibold">8,412.60</div>
        <div className="mt-3 flex h-12 items-end gap-1">
          {[30, 45, 38, 60, 52, 80, 95, 70, 88, 64].map((h, i) => (
            <span key={i} className={cn("flex-1 rounded-sm", i === 6 ? "bg-saffron" : "bg-white/15")} style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>

      {/* floating: online order */}
      <div className="absolute -top-6 right-6 hidden items-center gap-3 rounded-full border border-border bg-card py-2 pl-2 pr-4 shadow-xl md:flex">
        <span className="grid size-8 place-items-center rounded-full bg-saffron text-[#1d1c1a]"><Bell className="size-4" /></span>
        <div className="text-sm"><span className="font-semibold">New online order</span> <span className="text-muted-foreground">· 3 items · ready in 18m</span></div>
      </div>
    </div>
  );
}

/* ---------- Tab visuals ---------- */

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-border bg-card p-4 shadow-xl sm:p-5", className)}>{children}</div>;
}

function TabVisual({ id }: { id: TabId }) {
  if (id === "pos") {
    const tables = [
      ["1", "free"], ["2", "eating"], ["3", "eating"], ["4", "pay"], ["5", "free"], ["6", "waiting"],
      ["7", "eating"], ["8", "free"], ["9", "pay"], ["10", "eating"], ["11", "free"], ["12", "waiting"],
    ] as const;
    const tone = { free: "bg-muted text-muted-foreground", eating: "bg-leaf/15 text-leaf", pay: "bg-saffron/20 text-saffron-deep", waiting: "bg-sky/15 text-sky" };
    return (
      <Panel>
        <div className="flex items-center justify-between">
          <div className="font-semibold">Main dining room</div>
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            {(["eating", "pay", "waiting"] as const).map((k) => <span key={k} className="flex items-center gap-1 capitalize"><i className={cn("size-2 rounded-full", tone[k])} />{k}</span>)}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2.5 sm:grid-cols-6">
          {tables.map(([n, s], i) => (
            <div key={n} className={cn("grid aspect-square place-items-center font-mono text-sm font-semibold", i % 3 === 0 ? "rounded-full" : "rounded-xl", tone[s])}>T{n}</div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-sm">
          <span>T4 · ready to pay</span><span className="font-mono font-semibold">142.80</span>
        </div>
      </Panel>
    );
  }
  if (id === "kds") {
    const tickets = [
      { t: "T7", age: "02:10", c: "border-leaf", items: ["2 × Margherita", "1 × Caesar salad"] },
      { t: "T12", age: "06:12", c: "border-saffron", items: ["2 × Smash burger", "1 × Truffle fries"], note: "No onion" },
      { t: "#4821", age: "11:40", c: "border-chili", items: ["3 × Wings · 8pc", "2 × Iced tea"], note: "Nut allergy" },
    ];
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {tickets.map((k) => (
          <Panel key={k.t} className={cn("border-t-4 p-4 sm:p-4", k.c)}>
            <div className="flex items-center justify-between font-mono text-xs font-semibold"><span>{k.t}</span><span className="flex items-center gap-1"><Clock className="size-3" />{k.age}</span></div>
            <div className="mt-3 space-y-1.5 text-sm">{k.items.map((i) => <div key={i}>{i}</div>)}</div>
            {k.note && <div className="mt-2 text-xs font-semibold text-chili">⚠ {k.note}</div>}
            <div className="mt-4 rounded-lg bg-foreground py-1.5 text-center text-xs font-semibold text-background">Bump</div>
          </Panel>
        ))}
      </div>
    );
  }
  if (id === "online") {
    const orders = [
      { src: "Website", id: "#4823", items: 2, eta: "New", hi: true },
      { src: "Delivery app", id: "#4822", items: 4, eta: "12m left" },
      { src: "Delivery app", id: "#4821", items: 3, eta: "4m left" },
      { src: "Pickup", id: "#4820", items: 1, eta: "Ready" },
    ];
    return (
      <Panel>
        <div className="flex items-center justify-between">
          <div className="font-semibold">Online queue</div>
          <span className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs"><span className="size-1.5 rounded-full bg-leaf" />Auto-accept on</span>
        </div>
        <div className="mt-4 space-y-2">
          {orders.map((o) => (
            <div key={o.id} className={cn("flex items-center gap-3 rounded-xl border p-3", o.hi ? "border-saffron bg-saffron/5" : "border-border")}>
              <span className="grid size-9 place-items-center rounded-lg bg-muted">{o.src === "Website" ? <QrCode className="size-4" /> : <Bike className="size-4" />}</span>
              <div className="flex-1 text-sm"><div className="font-medium">{o.src} · {o.id}</div><div className="text-xs text-muted-foreground">{o.items} items</div></div>
              {o.hi
                ? <span className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background">Accept</span>
                : <span className="font-mono text-xs text-muted-foreground">{o.eta}</span>}
            </div>
          ))}
        </div>
      </Panel>
    );
  }
  if (id === "office") {
    const bars = [22, 30, 28, 45, 70, 92, 85, 60, 48, 66, 88, 74];
    return (
      <Panel>
        <div className="grid grid-cols-3 gap-3">
          {[["Net sales", "8,412.60", "+12%"], ["Orders", "214", "+8%"], ["Avg check", "39.31", "+3%"]].map(([l, v, d]) => (
            <div key={l} className="rounded-xl bg-muted p-3">
              <div className="text-[11px] text-muted-foreground">{l}</div>
              <div className="mt-1 font-mono text-base font-semibold sm:text-lg">{v}</div>
              <div className="text-[11px] font-medium text-leaf">{d}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 text-xs text-muted-foreground">Sales by hour</div>
        <div className="mt-2 flex h-36 items-end gap-1.5">
          {bars.map((h, i) => <span key={i} className={cn("flex-1 rounded-t-md", i === 5 ? "bg-saffron" : "bg-foreground/15")} style={{ height: `${h}%` }} />)}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
          <span className="flex items-center gap-2"><Package className="size-4 text-chili" />Mozzarella running low</span>
          <span className="text-xs font-semibold text-saffron-deep">Reorder</span>
        </div>
      </Panel>
    );
  }
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[0.8fr_1.2fr]">
      <Panel className="rotate-[-2deg] bg-[oklch(0.98_0.01_85)] font-serif">
        <div className="text-center text-xl">Menu</div>
        <div className="mt-3 space-y-2 text-sm">
          {[["Smash burger", "14.50"], ["Truffle fries", "7.00"], ["Caesar salad", "11.00"], ["Cold brew", "5.00"]].map(([n, p]) => (
            <div key={n} className="flex justify-between border-b border-dotted border-border pb-1"><span>{n}</span><span>{p}</span></div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-center gap-1.5 font-sans text-xs text-muted-foreground"><ScanLine className="size-3.5" />Scanning…</div>
      </Panel>
      <Panel>
        <div className="flex items-center justify-between"><div className="font-semibold">Import preview</div><span className="rounded-full bg-leaf/15 px-2 py-0.5 text-[11px] font-semibold text-leaf">4 items found</span></div>
        <div className="mt-3 divide-y divide-border text-sm">
          {[["Mains", "Smash burger", "14.50"], ["Sides", "Truffle fries", "7.00"], ["Salads", "Caesar salad", "11.00"], ["Drinks", "Cold brew", "5.00"]].map(([c, n, p]) => (
            <div key={n} className="grid grid-cols-[70px_1fr_auto] gap-2 py-2"><span className="text-xs text-muted-foreground">{c}</span><span className="font-medium">{n}</span><span className="font-mono text-[13px]">{p}</span></div>
          ))}
        </div>
        <div className="mt-4 rounded-lg bg-foreground py-2 text-center text-sm font-semibold text-background">Import 4 items</div>
      </Panel>
    </div>
  );
}

/* ---------- small pieces ---------- */

function Bento({ icon: Icon, t, d, className, children }: { icon: React.ElementType; t: string; d: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("group rounded-3xl border border-white/10 bg-white/[0.04] p-7 transition hover:border-white/20 hover:bg-white/[0.06]", className)}>
      <span className="grid size-11 place-items-center rounded-xl bg-white/[0.08] text-saffron transition group-hover:bg-saffron group-hover:text-[#1d1c1a]"><Icon className="size-5" /></span>
      <h3 className="mt-6 text-lg font-semibold">{t}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-white/60">{d}</p>
      {children}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="text-sm font-semibold">{title}</div>
      <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
        {links.map(([l, h]) => <li key={l}><Link href={h} className="transition hover:text-foreground">{l}</Link></li>)}
      </ul>
    </div>
  );
}
