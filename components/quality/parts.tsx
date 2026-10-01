import type { Grade, Quadrant } from "@/lib/fundamentals/quality";

// The small pieces the quality pages share: the grade, the quadrant, and the
// way a multiple or a rate is written.

export const QUADRANT_COLOR: Record<Quadrant, string> = {
  compounder: "var(--positive)",
  premium: "var(--blue)",
  trap: "var(--amber)",
  danger: "var(--negative)",
};

export const QUADRANT_SHORT: Record<Quadrant, string> = {
  compounder: "Compounder",
  premium: "Premium",
  trap: "Value trap?",
  danger: "Poor and dear",
};

const GRADE_COLOR: Record<Grade, string> = { A: "var(--positive)", B: "var(--teal)", C: "var(--amber)", D: "var(--negative)" };

export const GRADE_TEXT: Record<Grade, string> = {
  A: "Earns 5 points or more over its cost of equity, profitable every year, earnings growing",
  B: "Earns its cost of equity and has been profitable every year",
  C: "Close to its cost of equity, or growing without earning it yet",
  D: "Earns well under its cost of equity",
};

export function GradeBadge({ grade, size = "sm" }: { grade: Grade | null; size?: "sm" | "lg" }) {
  if (!grade) return <span className="text-muted">—</span>;
  const c = GRADE_COLOR[grade];
  const px = size === "lg" ? 34 : 22;
  return (
    <span title={GRADE_TEXT[grade]} className="inline-flex items-center justify-center rounded-md font-bold" style={{ width: px, height: px, fontSize: size === "lg" ? 18 : 12, color: c, background: `color-mix(in srgb, ${c} 14%, transparent)` }}>
      {grade}
    </span>
  );
}

export function QuadrantPill({ quadrant }: { quadrant: Quadrant | null }) {
  if (!quadrant) return <span className="text-muted text-[12px]">—</span>;
  const c = QUADRANT_COLOR[quadrant];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-[2px] text-[11.5px] font-medium" style={{ color: c, background: `color-mix(in srgb, ${c} 11%, transparent)` }}>
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c }} />
      {QUADRANT_SHORT[quadrant]}
    </span>
  );
}

export const mult = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}×`);
export const rate = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`);
export const signed = (v: number | null | undefined, d = 1, unit = "%") => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}${unit}`);
export const toneOf = (v: number | null | undefined) => (v == null ? "var(--muted)" : v >= 0 ? "var(--positive)" : "var(--negative)");
