// One figure on a white card: label above, value below, the change to the
// right in green or red. The shape every metric strip on the app is made of.
export function StatCard({ label, value, delta, tone, deltaTone, hint, action }: { label: string; value: string; delta?: string; tone?: "positive" | "negative" | "muted"; deltaTone?: "positive" | "negative" | "muted"; hint?: string; action?: React.ReactNode }) {
  const color = tone === "positive" ? "var(--positive)" : tone === "negative" ? "var(--negative)" : tone === "muted" ? "var(--muted)" : "var(--ink)";
  const dcolor = deltaTone === "positive" ? "var(--positive)" : deltaTone === "negative" ? "var(--negative)" : "var(--muted)";
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="value" style={{ color }}>{value}</div>
        {delta && <div className="text-[12px] font-medium mono-num pb-[1px]" style={{ color: dcolor }}>{delta}</div>}
        {action}
      </div>
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  );
}
