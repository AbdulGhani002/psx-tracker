type Props = {
  horizon: string;
  multiple: string;
  value: string;
  cagr: string;
  emphasis?: boolean;
};

export function OutcomeCard({ horizon, multiple, value, cagr, emphasis = false }: Props) {
  return (
    <div
      className={`p-5 ${
        emphasis
          ? "bg-[var(--inverted-bg)] text-[var(--inverted-fg)]"
          : "bg-[var(--paper-2)] border-l-[4px] border-l-[var(--accent)]"
      }`}
    >
      <div
        className="text-[10px] tracking-stat uppercase font-mono"
        style={{ color: emphasis ? "rgba(245,241,232,0.65)" : "var(--muted)" }}
      >
        {horizon}
      </div>
      <div
        className="font-display mt-1 mono-num"
        style={{ fontSize: 36, fontVariationSettings: "'opsz' 144", lineHeight: 1 }}
      >
        {multiple}
      </div>
      <div className="font-mono mono-num text-[14px] mt-2">{value}</div>
      <div
        className="text-[11px] mt-1 font-mono"
        style={{ color: emphasis ? "rgba(245,241,232,0.65)" : "var(--muted)" }}
      >
        {cagr} CAGR
      </div>
    </div>
  );
}
