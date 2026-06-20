import { fmtRs } from "@/lib/format";

export type Bar = { label: string; value: number; title?: string };

function compact(v: number): string {
  if (v <= 0) return "";
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}

// Dependency-free responsive bar chart (flexbox heights). Server-renderable.
export function BarChart({
  bars,
  height = 180,
  highlightLast = false,
}: {
  bars: Bar[];
  height?: number;
  highlightLast?: boolean;
}) {
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="w-full">
      <div className="flex items-end gap-1.5" style={{ height }}>
        {bars.map((b, i) => {
          const h = (b.value / max) * 100;
          const isLast = highlightLast && i === bars.length - 1;
          return (
            <div key={`${b.label}-${i}`} className="flex-1 flex flex-col items-center justify-end h-full min-w-0">
              {b.value > 0 && <span className="text-[9px] font-mono mono-num text-muted mb-1 whitespace-nowrap">{compact(b.value)}</span>}
              <div
                className="w-full rounded-t transition-all"
                title={b.title ?? `${b.label}: ${fmtRs(b.value)}`}
                style={{
                  height: `${Math.max(h, b.value > 0 ? 2 : 0)}%`,
                  background: isLast ? "var(--accent-deep)" : "var(--accent)",
                  opacity: b.value > 0 ? 1 : 0,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-2 border-t border-rule pt-1.5">
        {bars.map((b, i) => (
          <div key={`${b.label}-l-${i}`} className="flex-1 text-center text-[9px] font-mono uppercase tracking-stat text-muted truncate">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}
