"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, LayoutGrid, Minus, Pencil, Plus, RotateCw, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Empty, run, usePoll } from "./shared";

/* ---------- Geometry ---------- */

export type Shape = "round" | "square" | "rect" | "booth" | "bar";
export interface PlanTable { id: string; name: string; seats: number; section: string; shape: Shape; x: number; y: number; rotation: number; sort?: number }
export interface PlanSection { id: string; name: string; sort: number }
interface Plan { sections: PlanSection[]; tables: PlanTable[] }

export const COLS = 32;
export const ROWS = 18;

export const SHAPES: { k: Shape; l: string; seats: number; hint: string }[] = [
  { k: "round", l: "Round", seats: 2, hint: "2–8 guests" },
  { k: "square", l: "Square", seats: 4, hint: "2–8 guests" },
  { k: "rect", l: "Long table", seats: 6, hint: "4–20 guests" },
  { k: "booth", l: "Booth", seats: 4, hint: "Bench seating" },
  { k: "bar", l: "Bar counter", seats: 5, hint: "Stools in a row" },
];

/** Footprint in grid cells, including the ring of chairs. */
export function footprint(shape: Shape, seats: number, rotation = 0) {
  let w: number, h: number;
  if (shape === "round" || shape === "square") {
    const d = seats <= 2 ? 3 : seats <= 4 ? 4 : seats <= 6 ? 5 : 6;
    w = h = d;
  } else if (shape === "bar") {
    w = Math.max(3, Math.ceil(seats * 1.4) + 1); h = 2;
  } else {
    w = Math.max(4, Math.ceil(seats / 2) * 2 + 1); h = 4;
  }
  return rotation % 180 ? { w: h, h: w } : { w, h };
}

/** Chair centres (in cells, unrotated frame) around the table body. */
function chairs(shape: Shape, seats: number, w: number, h: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (shape === "round") {
    const r = w / 2 - 0.36;
    for (let i = 0; i < seats; i++) {
      const a = (i / seats) * Math.PI * 2 - Math.PI / 2;
      out.push({ x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r });
    }
  } else if (shape === "square") {
    const per = [0, 0, 0, 0];
    for (let i = 0; i < seats; i++) per[i % 4]++;
    const side = (n: number, fn: (t: number) => { x: number; y: number }) => { for (let i = 0; i < n; i++) out.push(fn((i + 1) / (n + 1))); };
    side(per[0], (t) => ({ x: 0.75 + t * (w - 1.5), y: 0.36 }));
    side(per[2], (t) => ({ x: 0.75 + t * (w - 1.5), y: h - 0.36 }));
    side(per[1], (t) => ({ x: w - 0.36, y: 0.75 + t * (h - 1.5) }));
    side(per[3], (t) => ({ x: 0.36, y: 0.75 + t * (h - 1.5) }));
  } else if (shape === "rect") {
    const top = Math.ceil(seats / 2), bottom = Math.floor(seats / 2);
    for (let i = 0; i < top; i++) out.push({ x: 0.9 + ((i + 0.5) / top) * (w - 1.8), y: 0.36 });
    for (let i = 0; i < bottom; i++) out.push({ x: 0.9 + ((i + 0.5) / bottom) * (w - 1.8), y: h - 0.36 });
  } else if (shape === "bar") {
    for (let i = 0; i < seats; i++) out.push({ x: 0.6 + ((i + 0.5) / seats) * (w - 1.2), y: h - 0.36 });
  }
  return out;
}

export const TONE = {
  plan: { body: "#ffffff", stroke: "#1c1915", chair: "#d6c4ab", text: "#1c1915" },
  free: { body: "#ffffff", stroke: "#b9b0a2", chair: "#ddd2c2", text: "#1c1915" },
  unsent: { body: "#dbe6f6", stroke: "#5b86c5", chair: "#c4d4ec", text: "#1f3f6e" },
  kitchen: { body: "#fbe1c7", stroke: "#ec7a2c", chair: "#f4cda6", text: "#7a3a0c" },
  served: { body: "#d9efdf", stroke: "#3f8a55", chair: "#bfe0c8", text: "#1f5532" },
} as const;
export type Tone = keyof typeof TONE;

/** One table drawn with its chairs. Positioned absolutely by the canvas. */
export function TableGlyph({ t, cell, tone = "plan", selected, dashed, children }: {
  t: Pick<PlanTable, "shape" | "seats" | "rotation" | "name">; cell: number; tone?: Tone; selected?: boolean; dashed?: boolean; children?: React.ReactNode;
}) {
  const base = footprint(t.shape, t.seats, 0);
  const { w, h } = footprint(t.shape, t.seats, t.rotation);
  const rot = t.rotation % 180 !== 0;
  const c = TONE[tone];
  const pts = chairs(t.shape, t.seats, base.w, base.h).map((p) => (rot ? { x: base.h - p.y, y: p.x } : p));
  const bodyBox = t.shape === "bar"
    ? (rot ? { x: 0.74, y: 0.1, w: w - 0.84, h: h - 0.2 } : { x: 0.1, y: 0.1, w: w - 0.2, h: h - 0.84 })
    : { x: 0.74, y: 0.74, w: w - 1.48, h: h - 1.48 };
  const sw = selected ? 2.5 : 1.5;
  return (
    <div className="relative" style={{ width: w * cell, height: h * cell }}>
      <svg width={w * cell} height={h * cell} viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 overflow-visible">
        {t.shape === "booth" && (
          rot
            ? <><rect x={0.1} y={0.4} width={0.75} height={h - 0.8} rx={0.3} fill={c.chair} /><rect x={w - 0.85} y={0.4} width={0.75} height={h - 0.8} rx={0.3} fill={c.chair} /></>
            : <><rect x={0.4} y={0.1} width={w - 0.8} height={0.75} rx={0.3} fill={c.chair} /><rect x={0.4} y={h - 0.85} width={w - 0.8} height={0.75} rx={0.3} fill={c.chair} /></>
        )}
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={0.3} fill={c.chair} />)}
        {t.shape === "round" ? (
          <circle cx={w / 2} cy={h / 2} r={w / 2 - 0.74} fill={c.body} stroke={c.stroke} strokeWidth={sw / cell} strokeDasharray={dashed ? `${4 / cell} ${3 / cell}` : undefined} />
        ) : (
          <rect x={bodyBox.x} y={bodyBox.y} width={bodyBox.w} height={bodyBox.h} rx={t.shape === "bar" ? 0.35 : 0.3}
            fill={c.body} stroke={c.stroke} strokeWidth={sw / cell} strokeDasharray={dashed ? `${4 / cell} ${3 / cell}` : undefined} />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center leading-tight" style={{ color: c.text }}>
        <div>
          <div className="font-semibold" style={{ fontSize: Math.max(11, Math.min(18, cell * 0.55)) }}>{t.name}</div>
          {children}
        </div>
      </div>
      {selected && <div className="pointer-events-none absolute -inset-1 rounded-xl ring-2 ring-[#ec7a2c] ring-offset-2 ring-offset-transparent" />}
    </div>
  );
}

/** Mini preview used on shape buttons. */
export function ShapeIcon({ shape, size = 44 }: { shape: Shape; size?: number }) {
  const seats = SHAPES.find((s) => s.k === shape)!.seats;
  const f = footprint(shape, seats);
  const cell = size / Math.max(f.w, f.h);
  return <div className="grid place-items-center" style={{ width: size, height: size }}><TableGlyph t={{ shape, seats, rotation: 0, name: "" }} cell={cell} /></div>;
}

/** Responsive cell size for the plan canvas. */
export function useCell(ref: React.RefObject<HTMLDivElement | null>, cols = COLS) {
  const [cell, setCell] = useState(24);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCell(Math.max(16, Math.min(34, Math.floor(el.clientWidth / cols)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, cols]);
  return cell;
}

export function planBounds(tables: PlanTable[]) {
  let cols = COLS, rows = ROWS;
  for (const t of tables) {
    const f = footprint(t.shape, t.seats, t.rotation);
    cols = Math.max(cols, t.x + f.w + 1);
    rows = Math.max(rows, t.y + f.h + 1);
  }
  return { cols, rows };
}

export const gridBg = (cell: number) => ({
  backgroundImage: "radial-gradient(rgba(28,25,21,.16) 1px, transparent 1px)",
  backgroundSize: `${cell}px ${cell}px`,
  backgroundPosition: `${cell / 2}px ${cell / 2}px`,
});

function overlaps(a: PlanTable, b: PlanTable) {
  const fa = footprint(a.shape, a.seats, a.rotation), fb = footprint(b.shape, b.seats, b.rotation);
  return a.x < b.x + fb.w && b.x < a.x + fa.w && a.y < b.y + fb.h && b.y < a.y + fa.h;
}

/** First grid spot (scanning row by row) where the table fits with a one-cell gap around it. */
function freeSpot(tables: PlanTable[], probe: Omit<PlanTable, "x" | "y" | "id">): { x: number; y: number } {
  const f = footprint(probe.shape, probe.seats, probe.rotation);
  const boxes = tables.map((t) => ({ ...footprint(t.shape, t.seats, t.rotation), x: t.x, y: t.y }));
  for (let y = 1; y < ROWS * 4; y++) {
    for (let x = 1; x + f.w <= COLS - 1; x++) {
      const hit = boxes.some((b) => x - 1 < b.x + b.w && b.x < x + f.w + 1 && y - 1 < b.y + b.h && b.y < y + f.h + 1);
      if (!hit) return { x, y };
    }
  }
  return { x: 1, y: 1 };
}

/* ---------- Editor ---------- */

export function FloorPlanEditor() {
  const { data, setData, reload } = usePoll<Plan>("/floor/plan", 0, "floor");
  const [section, setSection] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [newSection, setNewSection] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const cell = useCell(wrap);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean; start: { x: number; y: number } } | null>(null);

  const sections = data?.sections ?? [];
  const active = section && sections.some((s) => s.name === section) ? section : sections[0]?.name ?? "Main";
  const tables = useMemo(() => (data?.tables ?? []).filter((t) => t.section === active), [data, active]);
  const selected = data?.tables.find((t) => t.id === sel) ?? null;
  const bounds = planBounds(tables);
  const seatsHere = tables.reduce((a, t) => a + t.seats, 0);

  const local = (id: string, p: Partial<PlanTable>) => setData((d) => d && { ...d, tables: d.tables.map((t) => (t.id === id ? { ...t, ...p } : t)) });

  async function patch(id: string, p: Partial<PlanTable>) {
    local(id, p);
    if (!(await run(api(`/floor/tables/${id}`, { method: "PATCH", body: p })))) reload();
  }

  function nextName() {
    const used = new Set((data?.tables ?? []).map((t) => t.name.toUpperCase()));
    for (let i = 1; ; i++) if (!used.has(`T${i}`)) return `T${i}`;
  }

  async function add(shape: Shape, from?: PlanTable) {
    const seats = from?.seats ?? SHAPES.find((s) => s.k === shape)!.seats;
    const probe = { name: nextName(), seats, section: active, shape, rotation: from?.rotation ?? 0 };
    const spot = freeSpot(tables, probe);
    const t = await run(api<PlanTable>("/floor/tables", { body: { ...probe, ...spot } }), `${probe.name} added to ${active}`);
    if (t) { setData((d) => d && { ...d, tables: [...d.tables, t] }); setSel(t.id); }
  }

  async function remove(t: PlanTable) {
    if (await run(api(`/floor/tables/${t.id}`, { method: "DELETE" }), `${t.name} removed`)) {
      setData((d) => d && { ...d, tables: d.tables.filter((x) => x.id !== t.id) });
      setSel(null);
    }
  }

  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    const name = newSection?.trim();
    if (!name) return setNewSection(null);
    const p = await run(api<Plan>("/floor/sections", { body: { name } }), `${name} added`);
    if (p) { setData(p); setSection(name); setNewSection(null); }
  }
  async function renameSection(s: PlanSection, name: string) {
    setRenaming(null);
    if (!name.trim() || name.trim() === s.name || s.id.startsWith("implicit:")) return;
    const p = await run(api<Plan>(`/floor/sections/${s.id}`, { method: "PATCH", body: { name: name.trim() } }), "Section renamed");
    if (p) { setData(p); setSection(name.trim()); }
  }
  async function deleteSection(s: PlanSection) {
    const p = await run(api<Plan>(`/floor/sections/${s.id}`, { method: "DELETE" }), `${s.name} removed`);
    if (p) { setData(p); setSection(null); }
  }

  /* drag & drop with snapping */
  function onDown(e: React.PointerEvent, t: PlanTable) {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const box = wrap.current!.getBoundingClientRect();
    drag.current = { id: t.id, dx: (e.clientX - box.left + wrap.current!.scrollLeft) / cell - t.x, dy: (e.clientY - box.top + wrap.current!.scrollTop) / cell - t.y, moved: false, start: { x: t.x, y: t.y } };
    setSel(t.id);
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const box = wrap.current!.getBoundingClientRect();
    const t = data!.tables.find((x) => x.id === d.id)!;
    const f = footprint(t.shape, t.seats, t.rotation);
    const x = Math.max(0, Math.min(bounds.cols + 6 - f.w, Math.round((e.clientX - box.left + wrap.current!.scrollLeft) / cell - d.dx)));
    const y = Math.max(0, Math.min(bounds.rows + 6 - f.h, Math.round((e.clientY - box.top + wrap.current!.scrollTop) / cell - d.dy)));
    if (x !== t.x || y !== t.y) { d.moved = true; local(d.id, { x, y }); }
  }
  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    const t = data!.tables.find((x) => x.id === d.id)!;
    if (t.x !== d.start.x || t.y !== d.start.y) patch(t.id, { x: t.x, y: t.y });
  }

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (step[e.key]) {
        e.preventDefault();
        patch(selected.id, { x: Math.max(0, selected.x + step[e.key][0]), y: Math.max(0, selected.y + step[e.key][1]) });
      } else if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (!data) return <Empty>Loading floor plan…</Empty>;

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[1fr_340px]">
      <div className="flex min-h-0 min-w-0 flex-col gap-4 p-5 md:p-6">
        {/* Section tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {sections.map((s) => (
            renaming === s.id ? (
              <form key={s.id} onSubmit={(e) => { e.preventDefault(); renameSection(s, (e.currentTarget.elements.namedItem("n") as HTMLInputElement).value); }}>
                <Input name="n" autoFocus defaultValue={s.name} maxLength={40} onBlur={(e) => renameSection(s, e.target.value)} className="h-9 w-36" />
              </form>
            ) : (
              <div key={s.id} className={cn("group flex items-center rounded-xl text-sm font-medium transition",
                active === s.name ? "bg-foreground text-background" : "bg-card text-[#5d5a53] ring-1 ring-border")}>
                <button onClick={() => { setSection(s.name); setSel(null); }} className="py-2 pl-3.5 pr-2">
                  {s.name} <span className="opacity-60">{data.tables.filter((t) => t.section === s.name).length}</span>
                </button>
                {active === s.name && (
                  <button onClick={() => setRenaming(s.id)} className="pr-2.5 opacity-70 hover:opacity-100" aria-label={`Rename ${s.name}`}><Pencil className="size-3.5" /></button>
                )}
              </div>
            )
          ))}
          {newSection !== null ? (
            <form onSubmit={addSection} className="flex items-center gap-1">
              <Input autoFocus value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder="e.g. Patio" maxLength={40} className="h-9 w-36" />
              <button type="submit" className="h-9 rounded-lg bg-foreground px-3 text-sm font-semibold text-background">Add</button>
              <button type="button" onClick={() => setNewSection(null)} className="grid size-9 place-items-center rounded-lg bg-muted"><X className="size-4" /></button>
            </form>
          ) : (
            <button onClick={() => setNewSection("")} className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:text-foreground">+ Section</button>
          )}
          <span className="ml-auto text-sm text-muted-foreground">{tables.length} tables · {seatsHere} seats</span>
        </div>

        {/* Canvas */}
        <div ref={wrap} className="relative min-h-0 flex-1 overflow-auto rounded-3xl border border-border bg-[#fbf8f3]"
          onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
          onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvas) setSel(null); }}>
          <div data-canvas="1" className="relative" style={{ width: bounds.cols * cell, height: bounds.rows * cell, ...gridBg(cell) }}>
            {tables.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-sm text-muted-foreground">
                <div><LayoutGrid className="mx-auto mb-2 size-8 opacity-40" />Add a table from the panel on the right,<br />then drag it into place.</div>
              </div>
            )}
            {tables.map((t) => {
              const clash = tables.some((o) => o.id !== t.id && overlaps(o, t));
              return (
                <div key={t.id} onPointerDown={(e) => onDown(e, t)}
                  className={cn("absolute cursor-grab touch-none select-none transition-[left,top] duration-75 active:cursor-grabbing", sel === t.id && "z-10")}
                  style={{ left: t.x * cell, top: t.y * cell }}>
                  <TableGlyph t={t} cell={cell} selected={sel === t.id} tone="plan">
                    <div className="text-[10px] opacity-60">{t.seats} seats</div>
                  </TableGlyph>
                  {clash && <span className="absolute -right-1 -top-1 size-3 rounded-full bg-destructive ring-2 ring-white" title="Overlaps another table" />}
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Drag tables to arrange them. Arrow keys nudge the selected table. Changes save automatically.</p>
      </div>

      {/* Inspector */}
      <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto border-t border-border bg-card p-5 lg:border-l lg:border-t-0">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Add to {active}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {SHAPES.map((s) => (
              <button key={s.k} onClick={() => add(s.k)}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-background p-3 text-center ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-foreground/40">
                <ShapeIcon shape={s.k} />
                <span className="text-[13px] font-medium">{s.l}</span>
                <span className="text-[11px] text-muted-foreground">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {selected ? (
          <TableInspector key={selected.id} t={selected} sections={sections} onPatch={(p) => patch(selected.id, p)}
            onDuplicate={() => add(selected.shape, selected)} onDelete={() => remove(selected)} onClose={() => setSel(null)} />
        ) : (
          <div className="rounded-2xl bg-muted/50 p-5 text-sm text-muted-foreground">
            Select a table to change its name, guests, shape or section.
            {tables.length === 0 && sections.length > 1 && !sections.find((s) => s.name === active)?.id.startsWith("implicit:") && (
              <button onClick={() => deleteSection(sections.find((s) => s.name === active)!)} className="mt-3 flex items-center gap-1.5 font-medium text-destructive">
                <Trash2 className="size-4" />Remove empty section “{active}”
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function TableInspector({ t, sections, onPatch, onDuplicate, onDelete, onClose }: {
  t: PlanTable; sections: PlanSection[]; onPatch: (p: Partial<PlanTable>) => void; onDuplicate: () => void; onDelete: () => void; onClose: () => void;
}) {
  const [name, setName] = useState(t.name);
  const [confirm, setConfirm] = useState(false);
  const setSeats = (n: number) => onPatch({ seats: Math.max(1, Math.min(t.shape === "rect" ? 20 : t.shape === "bar" ? 16 : 10, n)) });
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">Table {t.name}</div>
        <button onClick={onClose} className="text-muted-foreground" aria-label="Close"><X className="size-5" /></button>
      </div>
      <div className="grid place-items-center rounded-2xl bg-[#fbf8f3] py-5" style={gridBg(18)}>
        <TableGlyph t={t} cell={Math.min(24, Math.floor(220 / Math.max(...Object.values(footprint(t.shape, t.seats, t.rotation)))))} tone="plan" />
      </div>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Table name</span>
        <Input value={name} maxLength={20} onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== t.name ? onPatch({ name: name.trim() }) : setName(t.name)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className="h-11 text-base font-semibold" />
      </label>
      <div className="space-y-2">
        <span className="text-sm font-medium">Guests it seats</span>
        <div className="flex items-center gap-3">
          <button onClick={() => setSeats(t.seats - 1)} className="grid size-11 place-items-center rounded-xl bg-muted"><Minus className="size-4" /></button>
          <span className="w-10 text-center font-mono text-2xl font-semibold">{t.seats}</span>
          <button onClick={() => setSeats(t.seats + 1)} className="grid size-11 place-items-center rounded-xl bg-muted"><Plus className="size-4" /></button>
        </div>
      </div>
      <div className="space-y-2">
        <span className="text-sm font-medium">Shape</span>
        <div className="grid grid-cols-5 gap-1.5">
          {SHAPES.map((s) => (
            <button key={s.k} onClick={() => onPatch({ shape: s.k })} title={s.l}
              className={cn("grid place-items-center rounded-xl p-1.5 ring-1 ring-border", t.shape === s.k ? "bg-accent ring-2 ring-[#ec7a2c]" : "bg-background")}>
              <ShapeIcon shape={s.k} size={36} />
            </button>
          ))}
        </div>
      </div>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Section</span>
        <select value={t.section} onChange={(e) => onPatch({ section: e.target.value })}
          className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm">
          {sections.map((s) => <option key={s.id}>{s.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => onPatch({ rotation: t.rotation ? 0 : 90 })} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-muted text-sm font-semibold"><RotateCw className="size-4" />Rotate</button>
        <button onClick={onDuplicate} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-muted text-sm font-semibold"><Copy className="size-4" />Copy</button>
        <button onClick={() => (confirm ? onDelete() : setConfirm(true))} onBlur={() => setConfirm(false)}
          className={cn("flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold", confirm ? "bg-destructive text-white" : "bg-destructive/10 text-destructive")}>
          <Trash2 className="size-4" />{confirm ? "Sure?" : "Remove"}
        </button>
      </div>
    </div>
  );
}

