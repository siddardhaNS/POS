"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Bike, Check, Clock, Laptop, Lock, Monitor, Package, QrCode, ScanLine, Smartphone, Tablet } from "lucide-react";
import { cn } from "@/lib/utils";

/* Tiffin 1a palette */
const ORANGE = "#ec7a2c";

const serif = "font-serif font-normal italic tracking-[-0.02em] text-[#ec7a2c]";
const kicker = "font-mono text-[11px] font-medium tracking-[0.1em] text-[#c85f17]";
const h2 = "text-[40px] font-semibold leading-none tracking-[-0.04em] md:text-[56px]";

const TABS = [
  {
    id: "pos", label: "Point of sale", kicker: "FRONT OF HOUSE",
    title: "Ring it in faster than they can say “and a side of…”",
    body: "A clean, touch-first order screen your newest server learns in one shift. Modifiers, courses, seat numbers and split checks are all one tap away.",
    bullets: ["Floor plan with live status", "Modifiers & required choices", "Split by item, guest or amount", "Takeaway & counter orders"],
  },
  {
    id: "kds", label: "Kitchen display", kicker: "BACK OF HOUSE",
    title: "Heard, fired, bumped. No more lost tickets.",
    body: "Tickets land on the right station the moment they are fired, with timers that turn orange before anything goes cold.",
    bullets: ["Station routing", "Ticket timers", "Allergy & 86 flags", "Printed kitchen tickets"],
  },
  {
    id: "online", label: "Online orders", kicker: "DELIVERY & PICKUP",
    title: "Every app, one queue.",
    body: "Delivery and pickup orders drop into the same flow as dine-in, so the kitchen sees one list and the tablets go back in the drawer.",
    bullets: ["Delivery apps merged", "Pickup & takeaway", "Accept or reject in a tap", "Handed-over tracking"],
  },
  {
    id: "office", label: "Back office", kicker: "THE OFFICE",
    title: "Close the night before you close the door.",
    body: "Sales, discounts and refunds by shift, a counted cash drawer with over/short, and every check searchable after the fact.",
    bullets: ["Shift & drawer reports", "Order history & reprints", "Refunds with reasons", "Discounts & comps tracked"],
  },
  {
    id: "menu", label: "Menu import", kicker: "SETUP",
    title: "Snap the paper menu. Go live tonight.",
    body: "Take a photo of your menu and Tiffin builds categories, items and prices for you to review.",
    bullets: ["Photo or PDF import", "Spreadsheet upload", "Modifiers & add-ons", "Editable preview"],
  },
] as const;
type TabId = (typeof TABS)[number]["id"];

const SEGMENTS = ["Full service", "Quick service", "Fine dining", "Cafés & bakeries", "Bars & breweries", "Cloud kitchens", "Food trucks"];

const FAQ = [
  ["How does the free trial work?", "Apply in about two minutes. Our team reviews every restaurant, usually within one business day. Once approved you get 14 days free, with your menu and floor ready to go."],
  ["Do I need new hardware?", "No. Tiffin runs in the browser on the tablets, laptops and desktops you already own. Bring your own receipt printer and card reader, or ask us for recommendations."],
  ["Can I run multiple locations or brands?", "Yes. Each location has its own floor, menu prices and staff, and the back office shows reports across all of them."],
  ["How do I get my menu in?", "Upload a photo of your menu or a spreadsheet. Tiffin reads it, shows you an editable preview, and imports it in one click."],
  ["Is my data separate from other restaurants?", "Yes. Each restaurant is its own tenant with its own data, and every request is scoped to your account."],
] as const;

function Pill({ href, children, tone = "ink", className }: { href: string; children: React.ReactNode; tone?: "ink" | "orange" | "white"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-3 text-[14.5px] font-medium transition active:scale-[0.98]",
        tone === "ink" && "bg-[#1c1915] text-[#faf6f0] hover:bg-black",
        tone === "orange" && "bg-[#ec7a2c] text-white hover:bg-[#de6d20]",
        tone === "white" && "border border-[#1c1915]/12 bg-white text-[#1c1915] hover:border-[#1c1915]/30",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Landing() {
  const [tab, setTab] = useState<TabId>("pos");
  const [cents, setCents] = useState(841260);
  const [sec, setSec] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const clock = setInterval(() => setSec((s) => (s + 9) % 522), 60);
    const sales = setInterval(() => setCents((c) => c + 400 + Math.floor(Math.random() * 3200)), 1800);
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => { clearInterval(clock); clearInterval(sales); window.removeEventListener("scroll", on); };
  }, []);

  const active = TABS.find((t) => t.id === tab)!;
  const setupClock = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  const sales = "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="min-h-screen overflow-x-clip bg-[#faf6f0] text-[#1c1915] antialiased">
      <div className="mx-auto max-w-[1440px]">
        {/* Nav */}
        <header className={cn("sticky top-0 z-40 transition-colors", scrolled && "border-b border-[#1c1915]/8 bg-[#faf6f0]/85 backdrop-blur-xl")}>
          <div className="flex items-center justify-between px-5 py-4 md:px-14 md:py-5">
            <div className="flex items-center gap-9">
              <Link href="/" className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em]">
                <span className="grid size-6 place-items-center rounded-[7px] bg-[#ec7a2c] text-sm font-semibold text-white">t</span>Tiffin
              </Link>
              <nav className="hidden gap-[26px] text-[13.5px] text-[#6f675d] lg:flex">
                <a href="#product" onClick={() => setTab("pos")} className="hover:text-[#1c1915]">Product</a>
                <a href="#product" onClick={() => setTab("kds")} className="hover:text-[#1c1915]">Kitchen</a>
                <a href="#hardware" className="hover:text-[#1c1915]">Hardware</a>
                <a href="#pricing" className="hover:text-[#1c1915]">Pricing</a>
                <a href="#faq" className="hover:text-[#1c1915]">FAQ</a>
              </nav>
            </div>
            <div className="flex items-center gap-[18px] text-[13.5px]">
              <Link href="/login" className="hidden text-[#6f675d] hover:text-[#1c1915] sm:block">Sign in</Link>
              <Pill href="/signup" className="px-4 py-[9px] text-[13.5px]">Start free trial</Pill>
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="relative bg-[radial-gradient(60%_60%_at_85%_0%,rgba(236,122,44,.16),transparent_70%)] px-5 pt-10 md:px-14 md:pt-14">
          <div className="grid items-end gap-8 lg:grid-cols-2 lg:gap-10">
            <div>
              <a href="#paper" className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#1c1915]/10 bg-white py-[5px] pl-[5px] pr-3 text-[12.5px] text-[#6f675d]">
                <span className="rounded-full bg-[#1c1915] px-2 py-0.5 text-[11px] text-white">New</span>
                <span className="truncate">Menu photo to first ticket in under 10 minutes →</span>
              </a>
              <h1 className="mt-6 text-[46px] font-semibold leading-[0.98] tracking-[-0.045em] text-balance sm:text-[64px] xl:text-[84px]">
                The restaurant POS that <span className={serif}>keeps up</span> with the rush.
              </h1>
            </div>
            <div className="pb-2.5">
              <p className="max-w-[420px] text-[17px] leading-relaxed text-[#6f675d] md:text-lg">
                Tables, tickets, kitchen display, online orders, payments and reports in one calm system that works on the devices you already own.
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <Pill href="/signup" tone="orange">Start 14-day free trial →</Pill>
                <Pill href="/login" tone="white">Try the live demo</Pill>
              </div>
              <div className="mt-[18px] flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-[#8a8176]">
                <span>✓ No card required</span><span>✓ Set up in an evening</span><span>✓ Cancel anytime</span>
              </div>
            </div>
          </div>
          <HeroProduct sales={sales} />
        </section>

        {/* Marquee */}
        <div className="overflow-hidden border-y border-[#1c1915]/8 bg-white py-[18px]">
          <div className="flex w-max animate-[marquee_30s_linear_infinite] gap-11 whitespace-nowrap text-[15px] text-[#6f675d]">
            {[...SEGMENTS, ...SEGMENTS].map((s, i) => (
              <span key={i} className="flex gap-11">{s}<span className="text-[#ec7a2c]">✳</span></span>
            ))}
          </div>
        </div>

        {/* From paper to service */}
        <section id="paper" className="scroll-mt-20 px-5 pb-5 pt-20 md:px-14 md:pt-[110px]">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end md:gap-10">
            <div>
              <div className={kicker}>FROM PAPER TO SERVICE</div>
              <h2 className={cn(h2, "mt-3")}>Open for service in <span className={serif}>minutes,</span><br />not weeks.</h2>
            </div>
            <div className="flex flex-col gap-1.5 md:items-end">
              <div className="font-mono text-xs font-medium text-[#8a8176]">AVERAGE SETUP TIME</div>
              <div className="font-mono text-5xl font-medium tracking-[-0.04em] tabular-nums">{setupClock}</div>
            </div>
          </div>
          <div className="mt-11 grid gap-3.5 lg:grid-cols-3">
            <Step n="01" time="~3 min" title="Snap your menu" body="Photograph the paper menu. Tiffin reads items, prices and categories, and builds your menu for you to approve.">
              <div className="relative grid h-[230px] grid-cols-2 gap-3 overflow-hidden rounded-[14px] bg-[#f6f1ea] p-4">
                <Placeholder label="paper menu photo" className="-rotate-3" />
                <div className="flex flex-col gap-[7px] text-xs">
                  {[["Smash burger", "14.50"], ["Truffle fries", "7.00"], ["Caesar salad", "11.00"], ["Cheesecake", "8.50"]].map(([n, p], i) => (
                    <div key={n} className="flex justify-between rounded-[7px] bg-white px-[9px] py-[7px]" style={{ animation: `lp-popIn 6s infinite ${0.6 + i * 0.5}s` }}>
                      <span>{n}</span><span className="font-mono">{p}</span>
                    </div>
                  ))}
                  <div className="font-mono text-[11px] text-[#c85f17]" style={{ animation: "lp-popIn 6s infinite 2.6s" }}>+ 38 items · 6 categories</div>
                </div>
                <div className="absolute left-4 h-0.5 w-[calc(50%-22px)] bg-[#ec7a2c] shadow-[0_0_12px_2px_rgba(236,122,44,.6)]" style={{ animation: "lp-scan 3s ease-in-out infinite" }} />
              </div>
            </Step>
            <Step n="02" time="~4 min" title="Drop in your floor" body="Add tables with seat counts and sections like Main, Patio or Bar. Move and merge checks between them during service.">
              <div className="relative h-[230px] rounded-[14px] bg-[#f6f1ea] bg-[radial-gradient(rgba(28,25,21,.12)_1px,transparent_1px)] bg-[size:16px_16px]">
                {[
                  { l: 18, t: 18, w: 58, round: true, label: "T1", d: 0.3 },
                  { l: 96, t: 18, w: 58, round: true, label: "T2", d: 0.7 },
                  { l: 174, t: 18, w: 96, label: "T3 · 6", d: 1.1 },
                  { l: 18, t: 100, w: 96, label: "T4 · 4", d: 1.5 },
                  { l: 134, t: 100, w: 58, round: true, label: "T5", d: 1.9, hot: true },
                ].map((t) => (
                  <div key={t.label}
                    className={cn("absolute grid h-[58px] place-items-center border-[1.5px] font-mono text-[11px]",
                      t.round ? "rounded-full" : "rounded-xl", t.hot ? "border-dashed border-[#ec7a2c] bg-[#fdf1e6] text-[#c85f17]" : "border-[#1c1915] bg-white")}
                    style={{ left: t.l, top: t.t, width: t.w, animation: `lp-popIn 6s infinite ${t.d}s` }}>{t.label}</div>
                ))}
                <div className="absolute inset-x-[18px] bottom-4 flex h-[30px] items-center rounded-lg bg-[#1c1915] px-3 font-mono text-[11px] text-[#faf6f0]" style={{ animation: "lp-popIn 6s infinite 2.3s" }}>BAR · 8 SEATS</div>
              </div>
            </Step>
            <Step dark n="03" time="~1 min" title="Fire your first ticket" body="Add staff PINs, open the cash drawer and open the doors. Your first order can hit the kitchen before the soup is hot.">
              <div className="flex h-[230px] flex-col gap-3 rounded-[14px] bg-[#26221d] p-[18px]">
                <div className="flex justify-between font-mono text-[11px] font-medium text-[#b9afa2]"><span>GO-LIVE CHECKLIST</span><span className="text-[#7fd39a]">READY</span></div>
                <div className="flex flex-col gap-[9px] text-[13px]">
                  {["Menu · 42 items", "Floor · 14 tables", "Staff PINs · 6 people", "Cash drawer open"].map((x, i) => (
                    <div key={x} className="flex gap-[9px]" style={{ animation: `lp-popIn 6s infinite ${0.4 + i * 0.5}s` }}><span className="text-[#ec7a2c]">✓</span>{x}</div>
                  ))}
                </div>
                <div className="mt-auto h-1.5 overflow-hidden rounded-[3px] bg-[#332d27]"><div className="h-full bg-[#ec7a2c]" style={{ animation: "lp-fillBar 6s ease-out infinite" }} /></div>
                <div className="rounded-[10px] bg-[#ec7a2c] p-[11px] text-center text-sm font-semibold text-[#1c1915]">Open for service</div>
              </div>
            </Step>
          </div>
        </section>

        {/* Every station */}
        <section id="product" className="scroll-mt-20 px-5 py-20 md:px-14 md:py-[90px]">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end md:gap-10">
            <h2 className={h2}>Every station, <span className={serif}>in sync.</span></h2>
            <p className="max-w-[360px] text-base leading-normal text-[#6f675d]">Replace the billing app, the ticket printer software, the delivery tablets and the spreadsheet in the office.</p>
          </div>
          <div className="mt-10 flex w-full max-w-max gap-1.5 overflow-x-auto rounded-full bg-[#f1ebe2] p-[5px] [scrollbar-width:none]">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn("shrink-0 rounded-full px-[18px] py-[9px] text-[13.5px] font-medium transition-all duration-200",
                  tab === t.id ? "bg-[#1c1915] text-[#faf6f0]" : "text-[#6f675d] hover:text-[#1c1915]")}>
                {t.label}
              </button>
            ))}
          </div>
          <div key={active.id} className="mt-7 grid animate-in fade-in gap-10 rounded-3xl border border-[#1c1915]/7 bg-white p-6 duration-300 md:p-10 lg:grid-cols-[1fr_1.3fr]">
            <div className="flex flex-col justify-center">
              <div className={kicker}>{active.kicker}</div>
              <h3 className="mb-3.5 mt-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.03em] md:text-[32px]">{active.title}</h3>
              <p className="text-[15.5px] leading-[1.55] text-[#6f675d]">{active.body}</p>
              <div className="mt-[22px] grid gap-2.5 text-[13.5px] sm:grid-cols-2">
                {active.bullets.map((b) => <div key={b} className="flex gap-2"><span className="text-[#ec7a2c]">✓</span>{b}</div>)}
              </div>
            </div>
            <div className="grid min-h-[300px] place-items-center rounded-2xl bg-[repeating-linear-gradient(135deg,#f3ece2_0_10px,#f8f3ec_10px_20px)] p-4 sm:p-8">
              <TabVisual id={active.id} />
            </div>
          </div>
        </section>

        {/* Everything you need */}
        <section className="bg-[#1c1915] px-5 py-20 text-[#faf6f0] md:px-14 md:py-[100px]">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <h2 className={h2}>Everything you need.<br /><span className={serif}>Nothing you don&apos;t.</span></h2>
            <p className="max-w-[320px] text-[15px] leading-normal text-[#b9afa2]">Every feature is in your trial, so you can run a real service before you decide.</p>
          </div>
          <div className="mt-12 grid gap-3 md:grid-cols-6">
            <div className="flex min-h-[220px] flex-col rounded-[20px] bg-[#26221d] p-7 md:col-span-3">
              <div className="text-xl font-semibold tracking-[-0.02em]">Payments your way</div>
              <p className="mt-2 text-sm leading-normal text-[#b9afa2]">Card, tap, QR and cash. Split by guest or item, take mixed payments, add tips and discounts, and every shift reconciles to the cent.</p>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-[18px]">
                {["Tap to pay", "Chip & PIN", "QR at table", "Split check", "Refunds"].map((p) => <span key={p} className="rounded-full bg-[#332d27] px-[11px] py-1.5 text-xs">{p}</span>)}
                <span className="rounded-full bg-[#ec7a2c] px-[11px] py-1.5 text-xs text-[#1c1915]">Tips</span>
              </div>
            </div>
            <div className="flex min-h-[220px] flex-col rounded-[20px] bg-[#ec7a2c] p-7 text-[#1c1915] md:col-span-3">
              <div className="text-xl font-semibold tracking-[-0.02em]">Cash drawer, counted</div>
              <p className="mt-2 max-w-[340px] text-sm leading-normal">Open with a float, log paid-ins and paid-outs, and close with a count. Tiffin tells you exactly how much you&apos;re over or short.</p>
              <div className="mt-auto flex items-center gap-2.5 pt-4 font-mono text-[13px] font-medium">
                <span className="size-2.5 rounded-full bg-[#1c1915]" style={{ animation: "lp-livedot 1.4s infinite" }} />Drawer open · expected {sales}
              </div>
            </div>
            {[
              ["Staff & roles", "PIN login on shared devices. Owners, managers, cashiers, servers and chefs see only what they need."],
              ["Discounts & comps", "Percent or fixed off the check, comp a single dish, and every one is logged with a reason."],
              ["Menu everywhere", "Change a price or 86 an item once. Modifiers, add-ons and required choices go with it."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-[20px] bg-[#26221d] p-7 md:col-span-2">
                <div className="text-lg font-semibold">{t}</div>
                <p className="mt-2 text-sm leading-normal text-[#b9afa2]">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* A night on Tiffin */}
        <section className="px-5 py-20 md:px-14 md:py-[100px]">
          <div className={kicker}>A NIGHT ON TIFFIN</div>
          <h2 className={cn(h2, "mb-12 mt-3")}>From first order to <span className={serif}>last call.</span></h2>
          <div className="grid border-t border-[#1c1915]/12 md:grid-cols-3">
            {[
              ["17:02 — 01", "Ring it in", "Seat the table, add items with modifiers and notes, and send them to the kitchen when you're ready."],
              ["17:03 — 02", "Fire to the kitchen", "Tickets appear on the kitchen screen instantly and print at the pass, with timers and allergy flags."],
              ["18:15 — 03", "Close & pay", "Split the check, take payment and tips, print the receipt and turn the table, all from the same screen."],
            ].map(([t, h, d], i) => (
              <div key={h} className={cn("py-7 md:pb-0", i === 0 ? "md:pr-7" : "border-t border-[#1c1915]/12 md:border-l md:border-t-0 md:px-7", i === 2 && "md:pr-0")}>
                <div className="font-mono text-[13px] font-medium text-[#8a8176]">{t}</div>
                <div className="mt-[18px] text-2xl font-semibold tracking-[-0.02em]">{h}</div>
                <p className="mt-3 text-[15px] leading-normal text-[#6f675d]">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Hardware */}
        <section id="hardware" className="scroll-mt-20 px-5 pb-20 md:px-14 md:pb-[100px]">
          <div className="grid items-center gap-10 rounded-3xl border border-[#1c1915]/7 bg-white p-7 md:p-12 lg:grid-cols-2">
            <div>
              <div className={kicker}>HARDWARE</div>
              <h2 className="mt-3 text-[36px] font-semibold leading-none tracking-[-0.04em] md:text-[44px]">Runs on what you <span className={serif}>already own.</span></h2>
              <p className="mt-4 max-w-md text-[15.5px] leading-[1.55] text-[#6f675d]">No locked-in terminals and no long hardware contracts. Open Tiffin in a browser, connect any receipt printer, and start service.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { i: Tablet, t: "Tablets", d: "Counter & tableside" },
                { i: Laptop, t: "Laptops & desktops", d: "Front desk & office" },
                { i: Monitor, t: "Kitchen screens", d: "Any display with a browser" },
                { i: Smartphone, t: "Handheld apps", d: "iOS & Android", soon: true },
              ].map(({ i: Icon, t, d, soon }) => (
                <div key={t} className="rounded-2xl bg-[#f6f1ea] p-5">
                  <div className="flex items-start justify-between">
                    <Icon className="size-6" strokeWidth={1.5} />
                    {soon && <span className="rounded-full bg-[#fdf1e6] px-2 py-0.5 text-[11px] font-medium text-[#c85f17]">Coming soon</span>}
                  </div>
                  <div className="mt-6 text-[15px] font-semibold">{t}</div>
                  <div className="text-[13px] text-[#6f675d]">{d}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 px-5 pb-20 md:px-14 md:pb-[100px]">
          <div className={kicker}>PRICING</div>
          <h2 className={cn(h2, "mb-12 mt-3")}>Simple, <span className={serif}>per-location</span> pricing.</h2>
          <div className="grid items-stretch gap-3.5 md:grid-cols-3">
            <Plan name="Starter" desc="For a single location getting off paper." price="$49" features={["POS, floor & tickets", "Kitchen display", "Menu import & taxes", "Up to 5 staff"]} cta="Start free trial" />
            <Plan featured name="Growth" desc="For busy rooms and delivery-heavy kitchens." price="$119" features={["Everything in Starter", "Online order queue", "Cash drawer & refunds", "Unlimited staff & roles"]} cta="Start free trial" />
            <Plan name="Enterprise" desc="For chains, franchises and multi-brand groups." price="Let's talk" features={["Everything in Growth", "Central menu & pricing", "Custom reports & API", "Dedicated success manager"]} cta="Talk to us" />
          </div>
          <p className="mt-6 text-[13px] text-[#8a8176]">Every plan starts with a 14-day free trial. No card required.</p>
        </section>

        {/* FAQ */}
        <section id="faq" className="grid scroll-mt-20 gap-10 px-5 pb-20 md:px-14 md:pb-[100px] lg:grid-cols-[1fr_1.6fr]">
          <div>
            <div className={kicker}>FAQ</div>
            <h2 className="mt-3 text-[36px] font-semibold leading-none tracking-[-0.04em] md:text-[44px]">Questions, <span className={serif}>answered.</span></h2>
          </div>
          <div className="divide-y divide-[#1c1915]/10 border-y border-[#1c1915]/10">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-medium">
                  {q}<span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-xl font-light text-[#6f675d] transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl leading-relaxed text-[#6f675d]">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-5 mb-14 flex flex-col justify-between gap-8 rounded-[28px] bg-[#ec7a2c] px-7 py-14 md:mx-14 md:flex-row md:items-end md:px-14 md:py-20">
          <h2 className="text-[48px] font-semibold leading-[0.95] tracking-[-0.045em] text-[#1c1915] md:text-[72px]">
            Your best service<br />starts <span className="font-serif font-normal italic">tonight.</span>
          </h2>
          <div className="flex flex-col gap-2.5 md:items-end">
            <Pill href="/signup" className="px-6 py-[15px]">Start your free trial <ArrowRight className="size-4" /></Pill>
            <span className="text-[13px] text-[#3a2410]">Apply in two minutes. A real person reviews every restaurant.</span>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-[#1c1915]/8 px-5 py-7 text-[12.5px] text-[#8a8176] sm:flex-row sm:justify-between md:px-14">
          <span>© {new Date().getFullYear()} Tiffin</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <a href="#product" className="hover:text-[#1c1915]">Product</a>
            <a href="#pricing" className="hover:text-[#1c1915]">Pricing</a>
            <Link href="/signup" className="hover:text-[#1c1915]">Start free trial</Link>
            <Link href="/login" className="hover:text-[#1c1915]">Sign in</Link>
            <Link href="/admin" className="flex items-center gap-1 hover:text-[#1c1915]"><Lock className="size-3" />Admin</Link>
          </span>
        </footer>
      </div>
    </div>
  );
}

/* ---------- Hero product ---------- */

const MENU = [["Smash burger", "14.50", "burger"], ["Truffle fries", "7.00", "fries"], ["Caesar salad", "11.00", "salad"], ["Margherita", "16.00", "pizza"],
  ["Wings · 8pc", "12.50", "wings"], ["Iced tea", "4.00", "iced tea"], ["Cold brew", "5.00", "cold brew"], ["Cheesecake", "8.50", "cheesecake"]] as const;
const TAPS: Record<number, string> = { 0: "0.4s", 1: "1.4s", 6: "2.4s" };

function HeroProduct({ sales }: { sales: string }) {
  return (
    <div className="relative mt-12 h-[470px] md:mt-14">
      <div className="absolute inset-0 grid overflow-hidden rounded-t-[20px] border border-b-0 border-[#1c1915]/8 bg-white shadow-[0_30px_80px_-30px_rgba(80,40,10,.25)] md:grid-cols-[1fr_300px] lg:grid-cols-[200px_1fr_330px]">
        <div className="hidden flex-col gap-1 bg-[#f6f1ea] px-3.5 py-[18px] text-[13px] lg:flex">
          <div className="px-2.5 pb-2.5 font-mono text-[10.5px] font-medium tracking-[0.08em] text-[#8a8176]">MAIN ROOM · LUNCH</div>
          <div className="flex justify-between rounded-[9px] bg-white px-2.5 py-[9px] font-medium">Order<span className="text-[#ec7a2c]">●</span></div>
          <div className="px-2.5 py-[9px] text-[#6f675d]">Floor</div>
          <div className="flex justify-between px-2.5 py-[9px] text-[#6f675d]">Kitchen<span className="rounded-md bg-[#1c1915] px-1.5 py-px font-mono text-[11px] font-medium text-white">7</span></div>
          <div className="flex justify-between px-2.5 py-[9px] text-[#6f675d]">Online<span className="rounded-md bg-[#ec7a2c] px-1.5 py-px font-mono text-[11px] font-medium text-white">3</span></div>
          <div className="px-2.5 py-[9px] text-[#6f675d]">Reports</div>
        </div>
        <div className="hidden px-[22px] py-[18px] md:block">
          <div className="mb-4 flex gap-1.5 text-[12.5px]">
            <span className="rounded-full bg-[#1c1915] px-3 py-1.5 text-white">Mains</span>
            {["Sides", "Drinks", "Sweets"].map((c) => <span key={c} className="rounded-full bg-[#f6f1ea] px-3 py-1.5">{c}</span>)}
          </div>
          <div className="grid grid-cols-3 gap-2.5 xl:grid-cols-4">
            {MENU.map(([n, p, ph], i) => (
              <div key={n} className={cn("rounded-xl p-2.5", i === 0 ? "bg-[#fdf1e6]" : "bg-[#f6f1ea]")} style={TAPS[i] ? { animation: `lp-tap 8s infinite ${TAPS[i]}` } : undefined}>
                <Placeholder label={ph} warm={i === 0} className="h-[62px]" />
                <div className="mt-2 text-[13px] font-medium">{n}</div>
                <div className="font-mono text-xs text-[#8a8176]">{p}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col border-[#1c1915]/8 px-5 py-[18px] md:border-l">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="font-mono text-[11px] text-[#8a8176]">TABLE 12 · 4 GUESTS</div>
              <div className="mt-0.5 text-[17px] font-semibold">Check #1042</div>
            </div>
            <span className="rounded-md bg-[#fdf1e6] px-2 py-1 font-mono text-[11px] font-medium text-[#c85f17]">Course 1 · Fired</span>
          </div>
          <div className="mt-[18px] flex flex-col gap-3 text-[13.5px]">
            <div className="flex justify-between" style={{ animation: "lp-lineIn 8s infinite .6s" }}>
              <span><b className="font-medium">2 × Smash burger</b><br /><span className="text-xs text-[#c85f17]">No onion · medium</span></span><span className="font-mono">29.00</span>
            </div>
            <div className="flex justify-between" style={{ animation: "lp-lineIn 8s infinite 1.6s" }}><b className="font-medium">1 × Truffle fries</b><span className="font-mono">7.00</span></div>
            <div className="flex justify-between" style={{ animation: "lp-lineIn 8s infinite 2.6s" }}>
              <span><b className="font-medium">2 × Cold brew</b><br /><span className="text-xs text-[#8a8176]">Oat milk</span></span><span className="font-mono">10.00</span>
            </div>
          </div>
          <div className="mt-auto flex flex-col gap-1.5 border-t border-dashed border-[#1c1915]/18 pt-3 text-[13px] text-[#6f675d]">
            <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">46.00</span></div>
            <div className="flex justify-between"><span>Tax</span><span className="font-mono">3.68</span></div>
            <div className="flex justify-between text-base font-semibold text-[#1c1915]"><span>Total</span><span className="font-mono">49.68</span></div>
          </div>
          <div className="mt-3.5 grid grid-cols-[1fr_2fr] gap-2 pb-4 text-[13.5px] font-medium">
            <span className="rounded-[10px] bg-[#f6f1ea] p-3 text-center">Split</span>
            <span className="rounded-[10px] bg-[#1c1915] p-3 text-center text-white">Fire &amp; pay</span>
          </div>
        </div>
      </div>

      <div className="absolute -left-[18px] bottom-10 hidden w-[210px] rounded-[14px] bg-white p-3.5 shadow-[0_20px_40px_-12px_rgba(60,30,10,.3)] lg:block"
        style={{ ["--r" as string]: "-4deg", animation: "lp-floaty 6s ease-in-out infinite" }}>
        <div className="flex justify-between font-mono text-[11px] font-medium"><span>T12 · KITCHEN</span><span className="text-[#c85f17]" style={{ animation: "lp-livedot 1s infinite" }}>06:12</span></div>
        <div className="mt-2.5 text-[13px] leading-relaxed"><b className="font-medium">2 × Smash burger</b><br /><span className="text-xs text-[#d0421b]">86 onion</span><br /><b className="font-medium">1 × Truffle fries</b></div>
        <div className="mt-2.5 rounded-lg bg-[#1c1915] p-2 text-center text-[12.5px] font-medium text-white">Heard → Bump</div>
      </div>

      <div className="absolute -right-4 bottom-24 hidden w-[230px] rounded-2xl bg-[#1c1915] px-[18px] py-4 text-[#faf6f0] shadow-[0_24px_50px_-16px_rgba(0,0,0,.45)] lg:block"
        style={{ ["--r" as string]: "3deg", animation: "lp-floaty 7s ease-in-out infinite 1s" }}>
        <div className="flex justify-between text-[11.5px] text-[#b9afa2]"><span>Today&apos;s net sales</span><span className="text-[#7fd39a]">↑ 12%</span></div>
        <div className="mt-1.5 font-mono text-[28px] font-medium tracking-[-0.02em] tabular-nums">{sales}</div>
        <div className="mt-2.5 flex h-10 items-end gap-[5px]">
          {[40, 60, 50, 80, 100, 70, 55].map((h, i) => (
            <div key={i} className="flex-1 origin-bottom rounded-[3px]" style={{ height: `${h}%`, background: i === 4 ? ORANGE : "#4a4239", animation: `lp-bar 2.4s infinite ${i * 0.2}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Pieces ---------- */

function Placeholder({ label, className, warm }: { label: string; className?: string; warm?: boolean }) {
  return (
    <div className={cn("grid place-items-center rounded-lg font-mono text-[10px]", warm
      ? "bg-[repeating-linear-gradient(135deg,#f7dcc4_0_6px,#fbe7d6_6px_12px)] text-[#b77a49]"
      : "bg-[repeating-linear-gradient(135deg,#ece3d6_0_6px,#f3ece2_6px_12px)] text-[#9d907f]", className)}>{label}</div>
  );
}

function Step({ n, time, title, body, dark, children }: { n: string; time: string; title: string; body: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-[18px] rounded-[22px] p-[22px]", dark ? "bg-[#1c1915] text-[#faf6f0]" : "border border-[#1c1915]/7 bg-white")}>
      {children}
      <div>
        <div className={cn("flex justify-between font-mono text-xs font-medium", dark ? "text-[#b9afa2]" : "text-[#8a8176]")}><span>STEP {n}</span><span>{time}</span></div>
        <div className="mt-2 text-[22px] font-semibold tracking-[-0.02em]">{title}</div>
        <p className={cn("mt-1.5 text-[14.5px] leading-normal", dark ? "text-[#b9afa2]" : "text-[#6f675d]")}>{body}</p>
      </div>
    </div>
  );
}

function Plan({ name, desc, price, features, cta, featured }: { name: string; desc: string; price: string; features: string[]; cta: string; featured?: boolean }) {
  return (
    <div className={cn("flex flex-col rounded-[22px] p-[30px]", featured
      ? "bg-[#1c1915] text-[#faf6f0] shadow-[0_30px_60px_-24px_rgba(60,30,10,.5)] md:-translate-y-3"
      : "border border-[#1c1915]/7 bg-white")}>
      <div className="flex justify-between">
        <div className="text-lg font-semibold">{name}</div>
        {featured && <span className="rounded-full bg-[#ec7a2c] px-2.5 py-1 text-[11.5px] font-medium text-[#1c1915]">Chef&apos;s pick</span>}
      </div>
      <div className={cn("mt-1 text-[13.5px]", featured ? "text-[#b9afa2]" : "text-[#6f675d]")}>{desc}</div>
      <div className="mb-1 mt-[22px] text-[44px] font-semibold tracking-[-0.04em]">
        {price}{price.startsWith("$") && <span className="text-[15px] font-normal text-[#8a8176]">/mo</span>}
      </div>
      <div className="mb-[26px] mt-5 flex flex-1 flex-col gap-[9px] text-sm">
        {features.map((f) => <span key={f}>✓ {f}</span>)}
      </div>
      <Pill href="/signup" tone={featured ? "orange" : "white"} className={cn("py-3 text-sm", featured && "text-[#1c1915]")}>{cta}</Pill>
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("w-full rounded-2xl border border-[#1c1915]/8 bg-white p-4 shadow-xl sm:p-5", className)}>{children}</div>;
}

function TabVisual({ id }: { id: TabId }) {
  if (id === "pos") {
    const tables = [["1", "free"], ["2", "eating"], ["3", "eating"], ["4", "pay"], ["5", "free"], ["6", "waiting"],
      ["7", "eating"], ["8", "free"], ["9", "pay"], ["10", "eating"], ["11", "free"], ["12", "waiting"]] as const;
    const tone = { free: "bg-[#f6f1ea] text-[#8a8176]", eating: "bg-[#e3f1e6] text-[#3f8a55]", pay: "bg-[#fdf1e6] text-[#c85f17]", waiting: "bg-[#e6eef9] text-[#3d6fb6]" };
    return (
      <Panel>
        <div className="flex items-center justify-between">
          <div className="font-semibold">Main dining room</div>
          <div className="flex gap-3 text-[11px] text-[#8a8176]">{(["eating", "pay", "waiting"] as const).map((k) => <span key={k} className="flex items-center gap-1 capitalize"><i className={cn("size-2 rounded-full", tone[k])} />{k}</span>)}</div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2.5 sm:grid-cols-6">
          {tables.map(([n, s], i) => <div key={n} className={cn("grid aspect-square place-items-center font-mono text-sm font-semibold", i % 3 === 0 ? "rounded-full" : "rounded-xl", tone[s])}>T{n}</div>)}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl bg-[#f6f1ea] px-4 py-3 text-sm"><span>T4 · split 2 ways · 1 paid</span><span className="font-mono font-semibold">71.40 due</span></div>
      </Panel>
    );
  }
  if (id === "kds") {
    const tickets = [
      { t: "T7", age: "02:10", c: "border-t-[#3f8a55]", items: ["2 × Margherita", "1 × Caesar salad"] },
      { t: "T12", age: "06:12", c: "border-t-[#ec7a2c]", items: ["2 × Smash burger", "+ No onion", "1 × Truffle fries"] },
      { t: "Pickup #88", age: "11:40", c: "border-t-[#d0421b]", items: ["3 × Wings · 8pc", "2 × Iced tea"], note: "Nut allergy" },
    ];
    return (
      <div className="grid w-full gap-3 sm:grid-cols-3">
        {tickets.map((k) => (
          <Panel key={k.t} className={cn("border-t-4 p-4 sm:p-4", k.c)}>
            <div className="flex items-center justify-between font-mono text-xs font-semibold"><span>{k.t}</span><span className="flex items-center gap-1"><Clock className="size-3" />{k.age}</span></div>
            <div className="mt-3 space-y-1.5 text-sm">{k.items.map((i) => <div key={i} className={i.startsWith("+") ? "pl-3 text-xs text-[#c85f17]" : ""}>{i}</div>)}</div>
            {k.note && <div className="mt-2 text-xs font-semibold text-[#d0421b]">⚠ {k.note}</div>}
            <div className="mt-4 rounded-lg bg-[#1c1915] py-1.5 text-center text-xs font-semibold text-white">Bump</div>
          </Panel>
        ))}
      </div>
    );
  }
  if (id === "online") {
    const orders = [{ src: "Website", id: "#4823", items: 2, eta: "New", hi: true }, { src: "Delivery app", id: "#4822", items: 4, eta: "12m left" },
      { src: "Takeaway", id: "#4821", items: 3, eta: "4m left" }, { src: "Pickup", id: "#4820", items: 1, eta: "Ready" }];
    return (
      <Panel>
        <div className="flex items-center justify-between"><div className="font-semibold">Online queue</div><span className="flex items-center gap-2 rounded-full bg-[#f6f1ea] px-3 py-1 text-xs"><span className="size-1.5 rounded-full bg-[#3f8a55]" />Live</span></div>
        <div className="mt-4 space-y-2">
          {orders.map((o) => (
            <div key={o.id} className={cn("flex items-center gap-3 rounded-xl border p-3", o.hi ? "border-[#ec7a2c] bg-[#fdf1e6]/60" : "border-[#1c1915]/8")}>
              <span className="grid size-9 place-items-center rounded-lg bg-[#f6f1ea]">{o.src === "Website" ? <QrCode className="size-4" /> : <Bike className="size-4" />}</span>
              <div className="flex-1 text-sm"><div className="font-medium">{o.src} · {o.id}</div><div className="text-xs text-[#8a8176]">{o.items} items</div></div>
              {o.hi ? <span className="rounded-lg bg-[#1c1915] px-3 py-1.5 text-xs font-semibold text-white">Accept</span> : <span className="font-mono text-xs text-[#8a8176]">{o.eta}</span>}
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
          {[["Net sales", "8,412.60", "+12%"], ["Discounts", "214.00", "1.4%"], ["Drawer", "−2.00", "short"]].map(([l, v, d]) => (
            <div key={l} className="rounded-xl bg-[#f6f1ea] p-3"><div className="text-[11px] text-[#8a8176]">{l}</div><div className="mt-1 font-mono text-base font-semibold sm:text-lg">{v}</div><div className="text-[11px] font-medium text-[#3f8a55]">{d}</div></div>
          ))}
        </div>
        <div className="mt-5 text-xs text-[#8a8176]">Sales by hour</div>
        <div className="mt-2 flex h-32 items-end gap-1.5">{bars.map((h, i) => <span key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, background: i === 5 ? ORANGE : "rgba(28,25,21,.14)" }} />)}</div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-[#1c1915]/8 px-4 py-3 text-sm"><span className="flex items-center gap-2"><Package className="size-4 text-[#d0421b]" />Refund · Check #1038</span><span className="text-xs font-semibold text-[#c85f17]">Cold food</span></div>
      </Panel>
    );
  }
  return (
    <div className="grid w-full items-center gap-4 sm:grid-cols-[0.8fr_1.2fr]">
      <Panel className="-rotate-2 bg-[#fffdf8] font-serif">
        <div className="text-center text-xl">Menu</div>
        <div className="mt-3 space-y-2 text-sm">
          {[["Smash burger", "14.50"], ["Truffle fries", "7.00"], ["Caesar salad", "11.00"], ["Cold brew", "5.00"]].map(([n, p]) => (
            <div key={n} className="flex justify-between border-b border-dotted border-[#1c1915]/15 pb-1"><span>{n}</span><span>{p}</span></div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-center gap-1.5 font-sans text-xs text-[#8a8176]"><ScanLine className="size-3.5" />Scanning…</div>
      </Panel>
      <Panel>
        <div className="flex items-center justify-between"><div className="font-semibold">Import preview</div><span className="rounded-full bg-[#e3f1e6] px-2 py-0.5 text-[11px] font-semibold text-[#3f8a55]">4 items found</span></div>
        <div className="mt-3 divide-y divide-[#1c1915]/8 text-sm">
          {[["Mains", "Smash burger", "14.50"], ["Sides", "Truffle fries", "7.00"], ["Salads", "Caesar salad", "11.00"], ["Drinks", "Cold brew", "5.00"]].map(([c, n, p]) => (
            <div key={n} className="grid grid-cols-[64px_1fr_auto] gap-2 py-2"><span className="text-xs text-[#8a8176]">{c}</span><span className="font-medium">{n}</span><span className="font-mono text-[13px]">{p}</span></div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-1.5 rounded-lg bg-[#1c1915] py-2 text-center text-sm font-semibold text-white"><Check className="size-4" />Import 4 items</div>
      </Panel>
    </div>
  );
}

