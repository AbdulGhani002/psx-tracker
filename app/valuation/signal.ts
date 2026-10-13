// How each signal reads on the pages.
export const SIGNAL: Record<string, { label: string; tone: "positive" | "negative" | "muted" }> = {
  STRONG: { label: "Strong buy", tone: "positive" },
  ACCUMULATE: { label: "Accumulate", tone: "positive" },
  CONFIRM: { label: "In zone, confirm first", tone: "muted" },
  STALE: { label: "New filing: review", tone: "muted" },
  WAIT: { label: "Wait", tone: "muted" },
  HOLD: { label: "Hold", tone: "muted" },
  TRIM: { label: "Trim", tone: "negative" },
  AVOID: { label: "Avoid", tone: "negative" },
  WATCH: { label: "Watch (thin)", tone: "muted" },
  "NO VALUE": { label: "No value", tone: "muted" },
};

export const money = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
export const level = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v >= 10 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));
export const bandText = (b: [number, number] | null | undefined) => {
  if (!b) return null;
  const lo = level(b[0]), hi = level(b[1]);
  return lo === hi ? null : `${lo}–${hi}`;
};
export const pct = (v: number | null | undefined, d = 1, sign = false) => (v == null || !Number.isFinite(v) ? "—" : `${sign && v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
export const GOV: Record<string, string> = { green: "var(--positive)", amber: "#d97706", red: "var(--negative)" };
