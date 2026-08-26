type StatProps = {
  label: React.ReactNode;
  value: string | number;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "accent" | "muted";
  size?: "sm" | "md" | "lg" | "hero";
};

const TONE_COLOR: Record<NonNullable<StatProps["tone"]>, string> = {
  default: "var(--ink)",
  positive: "var(--positive)",
  negative: "var(--negative)",
  accent: "var(--accent-deep)",
  muted: "var(--muted)",
};

// Real scale contrast. A row where every figure is 22px is a row with no
// hierarchy, which is what made these read as generated: the eye is given
// nothing to land on first. "hero" is for the one number a page is actually
// about, and everything else steps well down from it.
const SIZE_PX: Record<NonNullable<StatProps["size"]>, number> = {
  sm: 17,
  md: 21,
  lg: 30,
  hero: 52,
};

export function Stat({ label, value, hint, tone = "default", size = "md" }: StatProps) {
  const px = SIZE_PX[size];
  return (
    <div>
      <div className="label-cap">{label}</div>
      <div
        // Figures are MONO and nothing else. The old markup asked for the
        // display face and the mono face on the same element and let the
        // cascade settle it, which is how columns of money stopped lining up.
        className="mono-num mt-1"
        style={{
          fontSize: px,
          color: TONE_COLOR[tone],
          lineHeight: 1.05,
          fontWeight: px >= 30 ? 400 : 500,
        }}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted mt-1.5 leading-snug">{hint}</div>}
    </div>
  );
}

// Stats sit in a band ruled off top and bottom, divided by hairlines rather
// than gutters — the way a paper sets a summary strip.
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    // The gap IS the rule: a 1px grid gap over a rule-coloured ground draws
    // hairlines between cells without any child needing a border of its own,
    // and it stays correct however the columns wrap.
    <div className="border-t-2 border-t-[var(--ink)] border-b border-b-[var(--rule)] mt-6 bg-[var(--rule)]">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px stagger [&>*]:bg-[var(--paper)] [&>*]:px-4 [&>*]:py-4">
        {children}
      </div>
    </div>
  );
}

// One figure the page is about, set large with its supporting detail beside it.
export function StatLead({
  label,
  value,
  tone = "default",
  detail,
}: {
  label: React.ReactNode;
  value: string | number;
  tone?: NonNullable<StatProps["tone"]>;
  detail?: React.ReactNode;
}) {
  return (
    <div className="fade-in-up">
      <div className="label-cap">{label}</div>
      <div
        className="mono-num mt-2"
        style={{ fontSize: "clamp(38px, 7vw, 60px)", color: TONE_COLOR[tone], lineHeight: 0.95, fontWeight: 400 }}
      >
        {value}
      </div>
      {detail && <div className="mt-2 text-[13px] text-muted">{detail}</div>}
    </div>
  );
}
