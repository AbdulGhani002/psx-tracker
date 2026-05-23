type Tone = "default" | "positive" | "negative" | "amber" | "accent";

type Props = {
  children: React.ReactNode;
  tone?: Tone;
};

const STYLES: Record<Tone, { bg: string; fg: string }> = {
  default: { bg: "transparent", fg: "var(--ink)" },
  positive: { bg: "transparent", fg: "var(--positive)" },
  negative: { bg: "transparent", fg: "var(--negative)" },
  amber: { bg: "transparent", fg: "var(--accent-deep)" },
  accent: { bg: "transparent", fg: "var(--accent-deep)" },
};

export function Badge({ children, tone = "default" }: Props) {
  const s = STYLES[tone];
  return (
    <span
      className="inline-flex items-center font-mono text-[10px] uppercase tracking-stat border px-1.5 py-0.5"
      style={{ background: s.bg, color: s.fg, borderColor: s.fg }}
    >
      {children}
    </span>
  );
}
