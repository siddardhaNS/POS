"use client";

/**
 * Drawn floor layout for a section: a room outline plus walls, doors, windows and areas (kitchen, bar...).
 * Coordinates are grid units: the same cells tables snap to, with corners on whole numbers.
 */

export type LineKind = "wall" | "door" | "window";
export type AreaKind = "kitchen" | "bar" | "counter" | "restroom" | "stage" | "stairs" | "zone" | "pillar" | "plant";
export interface LineItem { id: string; kind: LineKind; x1: number; y1: number; x2: number; y2: number; label?: string }
export interface AreaItem { id: string; kind: AreaKind; x: number; y: number; w: number; h: number; label?: string }
export type LayoutItem = LineItem | AreaItem;
export interface Layout { room: [number, number][]; items: LayoutItem[] }

export const isLine = (i: LayoutItem): i is LineItem => i.kind === "wall" || i.kind === "door" || i.kind === "window";
export const emptyLayout = (): Layout => ({ room: [], items: [] });
export const asLayout = (v: unknown): Layout => {
  const o = (v ?? {}) as Partial<Layout>;
  return { room: Array.isArray(o.room) ? o.room : [], items: Array.isArray(o.items) ? o.items : [] };
};

export const AREAS: Record<AreaKind, { label: string; fill: string; stroke: string; text: string; size: [number, number] }> = {
  kitchen: { label: "Kitchen", fill: "#f3e3cf", stroke: "#c98d4a", text: "#7a4a14", size: [6, 4] },
  bar: { label: "Bar", fill: "#e6dcf1", stroke: "#8a6cb5", text: "#4b2f73", size: [6, 2] },
  counter: { label: "Counter", fill: "#dfe9f2", stroke: "#6a90b3", text: "#2b4d6e", size: [4, 2] },
  restroom: { label: "Restrooms", fill: "#e3eef0", stroke: "#7aa3aa", text: "#2f5a61", size: [3, 3] },
  stage: { label: "Stage", fill: "#f1e6e6", stroke: "#b37a7a", text: "#6e2f2f", size: [5, 3] },
  stairs: { label: "Stairs", fill: "#ecebe7", stroke: "#8f8b80", text: "#4d4a42", size: [2, 4] },
  zone: { label: "Area", fill: "#f4f1ea", stroke: "#b9b0a2", text: "#5d5a53", size: [5, 4] },
  pillar: { label: "Pillar", fill: "#cfc8bc", stroke: "#8f877a", text: "#3d3a33", size: [1, 1] },
  plant: { label: "Plant", fill: "#d5e8d0", stroke: "#6f9a63", text: "#2e5223", size: [1, 1] },
};
export const LINES: Record<LineKind, { label: string }> = { wall: { label: "Wall" }, door: { label: "Door" }, window: { label: "Window" } };

/** Furthest cell the layout reaches, so the canvas grows to show it. */
export function layoutBounds(l: Layout) {
  let cols = 0, rows = 0;
  for (const [x, y] of l.room) { cols = Math.max(cols, x); rows = Math.max(rows, y); }
  for (const i of l.items) {
    if (isLine(i)) { cols = Math.max(cols, i.x1, i.x2); rows = Math.max(rows, i.y1, i.y2); }
    else { cols = Math.max(cols, i.x + i.w); rows = Math.max(rows, i.y + i.h); }
  }
  return { cols: Math.ceil(cols), rows: Math.ceil(rows) };
}

export function insidePolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is the box (grid units) fully on the floor: inside the room outline (if any) and clear of solid areas? */
export function boxFits(l: Layout, x: number, y: number, w: number, h: number) {
  if (l.room.length >= 3) {
    const corners: [number, number][] = [[x + 0.15, y + 0.15], [x + w - 0.15, y + 0.15], [x + 0.15, y + h - 0.15], [x + w - 0.15, y + h - 0.15]];
    if (!corners.every(([cx, cy]) => insidePolygon(cx, cy, l.room))) return false;
  }
  return !l.items.some((i) => !isLine(i) && i.kind !== "zone" && x < i.x + i.w && i.x < x + w && y < i.y + i.h && i.y < y + h);
}

/** The layout drawn as SVG under the tables. `selected` highlights one item while editing. */
export function LayoutLayer({ layout, cell, cols, rows, selected, editing, onItemDown }: {
  layout: Layout; cell: number; cols: number; rows: number; selected?: string | null; editing?: boolean;
  onItemDown?: (e: React.PointerEvent, item: LayoutItem) => void;
}) {
  const { room, items } = layout;
  const wall = 0.28;
  const hasRoom = room.length >= 3;
  const pts = room.map(([x, y]) => `${x},${y}`).join(" ");
  const areas = items.filter((i): i is AreaItem => !isLine(i));
  const lines = items.filter(isLine);
  return (
    <svg width={cols * cell} height={rows * cell} viewBox={`0 0 ${cols} ${rows}`} className="pointer-events-none absolute inset-0">
      <defs>
        <pattern id="outside" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="0.5" stroke="#d8d0c3" strokeWidth="0.06" />
        </pattern>
      </defs>
      {hasRoom && (
        <>
          <path d={`M0,0 H${cols} V${rows} H0 Z M${room.map(([x, y]) => `${x},${y}`).join(" L")} Z`} fill="url(#outside)" fillRule="evenodd" />
          <polygon points={pts} fill="#fffdf8" />
        </>
      )}
      {areas.map((a) => {
        const s = AREAS[a.kind] ?? AREAS.zone;
        const small = a.w <= 1.5 || a.h <= 1.5;
        const label = a.label || s.label;
        const fs = Math.min(0.62, Math.max(0.34, Math.min(a.w, a.h) * 0.3));
        return (
          <g key={a.id} className={editing ? "pointer-events-auto cursor-move" : undefined} onPointerDown={(e) => onItemDown?.(e, a)}>
            {a.kind === "pillar" ? <rect x={a.x + 0.12} y={a.y + 0.12} width={a.w - 0.24} height={a.h - 0.24} fill={s.fill} stroke={s.stroke} strokeWidth={0.06} />
              : a.kind === "plant" ? <circle cx={a.x + a.w / 2} cy={a.y + a.h / 2} r={Math.min(a.w, a.h) / 2 - 0.1} fill={s.fill} stroke={s.stroke} strokeWidth={0.06} />
                : <rect x={a.x} y={a.y} width={a.w} height={a.h} rx={0.25} fill={s.fill} stroke={s.stroke} strokeWidth={0.06}
                  strokeDasharray={a.kind === "zone" ? "0.25 0.18" : undefined} />}
            {a.kind === "stairs" && Array.from({ length: Math.floor(a.h / 0.5) - 1 }, (_, k) => (
              <line key={k} x1={a.x + 0.1} x2={a.x + a.w - 0.1} y1={a.y + (k + 1) * 0.5} y2={a.y + (k + 1) * 0.5} stroke={s.stroke} strokeWidth={0.04} />
            ))}
            {!small && (
              <text x={a.x + a.w / 2} y={a.y + a.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={600} fill={s.text}
                style={{ fontFamily: "inherit" }}>{label}</text>
            )}
            {selected === a.id && <rect x={a.x - 0.1} y={a.y - 0.1} width={a.w + 0.2} height={a.h + 0.2} rx={0.3} fill="none" stroke="#ec7a2c" strokeWidth={0.1} />}
            {selected === a.id && editing && <rect data-handle="resize" x={a.x + a.w - 0.3} y={a.y + a.h - 0.3} width={0.6} height={0.6} rx={0.1} fill="#ec7a2c" className="cursor-nwse-resize" />}
          </g>
        );
      })}
      {hasRoom && <polygon points={pts} fill="none" stroke="#1c1915" strokeWidth={wall} strokeLinejoin="round" />}
      {lines.map((l) => {
        const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
        const sel = selected === l.id;
        let body: React.ReactNode;
        if (l.kind === "wall") body = <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#1c1915" strokeWidth={wall} strokeLinecap="round" />;
        else if (l.kind === "window") body = (
          <>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#fffdf8" strokeWidth={wall + 0.06} />
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#6a90b3" strokeWidth={wall} strokeDasharray="none" />
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#fffdf8" strokeWidth={0.08} />
          </>
        );
        else {
          // Door: a gap in the wall with the leaf and its swing.
          const ux = (l.x2 - l.x1) / len, uy = (l.y2 - l.y1) / len;
          const nx = -uy, ny = ux;
          const tipX = l.x1 + nx * len, tipY = l.y1 + ny * len;
          body = (
            <>
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#fffdf8" strokeWidth={wall + 0.08} />
              <line x1={l.x1} y1={l.y1} x2={tipX} y2={tipY} stroke="#c98d4a" strokeWidth={0.08} />
              <path d={`M${tipX},${tipY} A${len},${len} 0 0 1 ${l.x2},${l.y2}`} fill="none" stroke="#c98d4a" strokeWidth={0.05} strokeDasharray="0.15 0.1" />
            </>
          );
        }
        return (
          <g key={l.id} className={editing ? "pointer-events-auto cursor-move" : undefined} onPointerDown={(e) => onItemDown?.(e, l)}>
            {editing && <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="transparent" strokeWidth={0.8} />}
            {body}
            {sel && <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#ec7a2c" strokeWidth={0.12} strokeOpacity={0.8} />}
            {sel && editing && <><circle data-handle="a" cx={l.x1} cy={l.y1} r={0.28} fill="#ec7a2c" /><circle data-handle="b" cx={l.x2} cy={l.y2} r={0.28} fill="#ec7a2c" /></>}
          </g>
        );
      })}
    </svg>
  );
}
