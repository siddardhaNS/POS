import { Logo } from "@/components/brand";

export function AuthShell({ title, quote, children }: { title: React.ReactNode; quote: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="relative hidden w-[520px] shrink-0 flex-col overflow-hidden bg-[#1d1c1a] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -bottom-40 -left-20 size-[480px] rounded-full bg-saffron/20 blur-[120px]" />
        <Logo dark />
        <div className="relative mt-auto">
          <h1 className="font-serif text-5xl leading-[1.05] tracking-tight">{title}</h1>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-white/55">{quote}</p>
        </div>
      </aside>
      <main className="flex flex-1 items-start justify-center overflow-y-auto px-5 py-12 sm:items-center">
        <div className="w-full max-w-lg">
          <Logo className="mb-10 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}

export function NativeSelect(props: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
    />
  );
}
