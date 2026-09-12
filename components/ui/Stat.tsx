type StatProps = {
  label: React.ReactNode;
  value: string | number;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "accent" | "muted";
  size?: "sm" | "md" | "lg" | "hero";
  delta?: string; // a small pill beside the figure: "+1.08%"
  deltaTone?: "positive" | "negative" | "muted";
};

const TONE_COLOR: Record<NonNullable<StatProps["tone"]>, string> = {
  default: "var(--ink)",
  positive: "var(--positive)",
  negative: "var(--negative)",
  accent: "var(--accent-deep)",
  muted: "var(--muted)",
};

const SIZE_PX: Record<NonNullable<StatProps["size"]>, number> = {
  sm: 17,
  md: 21,
  lg: 28,
  hero: 44,
};

// One figure with its label above and its context below, the way a dashboard
// card reads: label, number, then the pill or the hint.
export function Stat({ label, value, hint, tone = "default", size = "md", delta, deltaTone }: StatProps) {
  const px = SIZE_PX[size];
  return (
    <div>
      <div className="text-[11.5px] text-muted font-medium">{label}</div>
      <div className="flex items-baseline gap-2 flex-wrap mt-1.5">
        <div className="mono-num" style={{ fontSize: px, color: TONE_COLOR[tone], lineHeight: 1.05, fontWeight: 600 }}>
          {value}
        </div>
        {delta && (
          <span className="pill" data-tone={deltaTone ?? "muted"}>
            {delta}
          </span>
        )}
      </div>
      {hint && <div className="text-[11px] text-muted mt-1.5 leading-snug">{hint}</div>}
    </div>
  );
}

// Stats sit in a row of cards.
export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mt-4 stagger [&>*]:stat-card">{children}</div>;
}

// One figure the page is about, set large with its supporting detail beside it.
export function StatLead({ label, value, tone = "default", detail }: { label: React.ReactNode; value: string | number; tone?: NonNullable<StatProps["tone"]>; detail?: React.ReactNode }) {
  return (
    <div className="fade-in-up">
      <div className="text-[12px] text-muted font-medium">{label}</div>
      <div className="mono-num mt-2" style={{ fontSize: "clamp(32px, 5vw, 44px)", color: TONE_COLOR[tone], lineHeight: 1, fontWeight: 600 }}>
        {value}
      </div>
      {detail && <div className="mt-2 text-[13px] text-muted">{detail}</div>}
    </div>
  );
}
