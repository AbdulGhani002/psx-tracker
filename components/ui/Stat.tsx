type StatProps = {
  label: React.ReactNode;
  value: string | number;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "accent" | "muted";
  size?: "sm" | "md" | "lg";
};

const TONE_COLOR: Record<NonNullable<StatProps["tone"]>, string> = {
  default: "var(--ink)",
  positive: "var(--positive)",
  negative: "var(--negative)",
  accent: "var(--accent-deep)",
  muted: "var(--muted)",
};

const SIZE_PX: Record<NonNullable<StatProps["size"]>, number> = {
  sm: 18,
  md: 22,
  lg: 32,
};

export function Stat({ label, value, hint, tone = "default", size = "md" }: StatProps) {
  return (
    <div>
      <div className="label-cap">{label}</div>
      <div
        className="font-display mono-num mt-0.5"
        style={{
          fontSize: SIZE_PX[size],
          color: TONE_COLOR[tone],
          lineHeight: 1.15,
        }}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted mt-1 font-mono">{hint}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-5 border-t border-ink border-b border-ink py-5">
      {children}
    </div>
  );
}
