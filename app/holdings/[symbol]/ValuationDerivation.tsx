import { fmtRs } from "@/lib/format";
import type { IntrinsicResult, ValuationMethod } from "@/lib/calculations/intrinsic";

// The full working, shown rather than summarised.
//
// A single intrinsic figure is a claim; this is the evidence for it. Every
// model that ran, what it produced, the weight it carried, whether it made the
// blend, and the arithmetic that turns those into one number — so the figure
// can be argued with instead of merely believed.
//
// Collapsed by default via <details>, which needs no JavaScript and stays
// keyboard-accessible and printable.

const CONFIDENCE_NOTE: Record<IntrinsicResult["confidence"], string> = {
  high: "Four or more models ran and landed close together.",
  medium: "The models broadly agree, but on fewer inputs or a wider spread.",
  low: "Few models applied, or they disagree materially. Treat the range, not the midpoint, as the answer.",
};

export function ValuationDerivation({ intrinsic }: { intrinsic: IntrinsicResult }) {
  const applied: ValuationMethod[] = intrinsic.methods.filter((m) => m.value != null && m.weight > 0);
  const notApplied: ValuationMethod[] = intrinsic.methods.filter((m) => m.value == null || m.weight === 0);
  const weightSum = applied.reduce((s, m) => s + m.weight, 0);

  return (
    <details className="mt-8 border-t border-[var(--rule)] pt-4 group">
      <summary className="cursor-pointer list-none flex items-baseline justify-between gap-4">
        <span className="section-eyebrow">Show the full derivation</span>
        <span className="label-cap group-open:hidden">expand ▾</span>
        <span className="label-cap hidden group-open:inline">collapse ▴</span>
      </summary>

      <div className="mt-5">
        <div className="label-cap mb-2">Models that ran</div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-t border-b border-[var(--ink)]">
                <th className="px-2 py-2 text-left font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Model</th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Value</th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Weight</th>
                <th className="px-2 py-2 text-right font-mono text-[10px] uppercase tracking-stat text-muted font-medium">Share</th>
                <th className="px-2 py-2 text-left font-mono text-[10px] uppercase tracking-stat text-muted font-medium">In blend</th>
              </tr>
            </thead>
            <tbody>
              {applied.map((m) => (
                <tr key={m.key} className="border-b border-[var(--rule)] align-top">
                  <td className="px-2 py-2">
                    <div>{m.label}</div>
                    <div className="text-[11px] text-muted mt-1 leading-snug max-w-[52ch]">{m.note}</div>
                  </td>
                  <td className="px-2 py-2 text-right mono-num whitespace-nowrap">{fmtRs(m.value as number, true)}</td>
                  <td className="px-2 py-2 text-right mono-num">{m.weight.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right mono-num text-muted">
                    {weightSum > 0 ? `${((m.weight / weightSum) * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-2 py-2">
                    {m.included ? (
                      <span style={{ color: "var(--positive)" }}>yes</span>
                    ) : (
                      <span style={{ color: "var(--amber)" }} title="More than 50% from the lead estimate, so capped before it entered the blend">
                        capped
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 border-t-2 border-t-[var(--ink)] pt-3">
          <div className="label-cap mb-2">The arithmetic</div>
          <p className="text-[13px] leading-relaxed max-w-[76ch]">
            Each model contributes in proportion to its weight, after being capped to within ±50% of the lead model —
            so a single broken input bends the answer without hijacking it. The weighted mean of{" "}
            <span className="mono-num">{applied.length}</span> models
            {weightSum > 0 && <> across <span className="mono-num">{weightSum.toFixed(1)}</span> total weight</>} gives an
            intrinsic value of <span className="mono-num">{fmtRs(intrinsic.intrinsic ?? 0, true)}</span>.
            {intrinsic.low != null && intrinsic.high != null && (
              <>
                {" "}The individual estimates span <span className="mono-num">{fmtRs(intrinsic.low, true)}</span> to{" "}
                <span className="mono-num">{fmtRs(intrinsic.high, true)}</span>.
              </>
            )}
          </p>
          <p className="text-[13px] leading-relaxed mt-3 max-w-[76ch]">
            A <span className="mono-num">{intrinsic.requiredMosPct.toFixed(0)}%</span> margin of safety is then demanded
            against that value, which is what sets the buy line at{" "}
            <span className="mono-num">{intrinsic.buyBelow != null ? fmtRs(intrinsic.buyBelow, true) : "—"}</span>. The
            discount rate throughout is <span className="mono-num">{intrinsic.requiredReturnPct.toFixed(1)}%</span> and
            the growth assumption <span className="mono-num">{intrinsic.growthPct.toFixed(1)}%</span>.
          </p>
          <p className="text-[13px] mt-3">
            <span className="label-cap">Confidence</span>{" "}
            <span
              style={{
                color:
                  intrinsic.confidence === "high"
                    ? "var(--positive)"
                    : intrinsic.confidence === "medium"
                      ? "var(--amber)"
                      : "var(--negative)",
              }}
            >
              {intrinsic.confidence}
            </span>{" "}
            <span className="text-muted">— {CONFIDENCE_NOTE[intrinsic.confidence]}</span>
          </p>
        </div>

        {notApplied.length > 0 && (
          <div className="mt-6">
            <div className="label-cap mb-2">Models that did not apply, and why</div>
            <ul className="space-y-2">
              {notApplied.map((m) => (
                <li key={m.key} className="text-[12px] leading-snug flex gap-2">
                  <span className="text-muted shrink-0">{m.label}</span>
                  <span className="text-muted">— {m.note}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted mt-3 max-w-[76ch]">
              A model that does not fit the business is switched off rather than given a small weight. A number that
              answers the wrong question does not become partly right by counting for less.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
