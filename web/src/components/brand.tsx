import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ className, dark = false, href = "/" }: { className?: string; dark?: boolean; href?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5", className)}>
      <span className="grid size-9 place-items-center rounded-[10px] bg-saffron text-lg font-bold text-[#1d1c1a]">t</span>
      <span className={cn("text-lg font-semibold tracking-tight", dark ? "text-white" : "text-foreground")}>Tiffin</span>
    </Link>
  );
}

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground", className)}>
      {children}
    </div>
  );
}
