type Tone = "default" | "positive" | "negative" | "amber" | "accent";

type Props = {
  children: React.ReactNode;
  tone?: Tone;
};

// A small tinted pill. The tone is the text colour on a wash of the same.
const FG: Record<Tone, string> = {
  default: "var(--muted)",
  positive: "var(--positive)",
  negative: "var(--negative)",
  amber: "var(--gold)",
  accent: "var(--accent)",
};

export function Badge({ children, tone = "default" }: Props) {
  const fg = FG[tone];
  return (
    <span className="inline-flex items-center rounded-full text-[11px] font-semibold px-2 py-0.5 tracking-[0.01em]" style={{ color: fg, background: `color-mix(in srgb, ${fg} 12%, transparent)` }}>
      {children}
    </span>
  );
}
