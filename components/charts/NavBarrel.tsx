import type { LookThrough } from "@/lib/data";
import { fmtRs } from "@/lib/format";

// Warm, petroleum-like palette (mid-tones that read on both light and dark).
const COLORS = ["#E6B422", "#DDA01A", "#CE7E12", "#B9620F", "#9C4A12", "#7B3A14", "#5E3410", "#46280E"];
const UNLISTED_COLOR = "#8C7A5C";

// A "products from one barrel" style stacked breakdown of a holding company's
// look-through NAV: every underlying stake (+ unlisted assets) sized by its
// share of gross assets, with the market price's discount called out.
export function NavBarrel({ lt }: { lt: LookThrough }) {
  const grossAssets = lt.listedValue + lt.unlistedValue;
  if (grossAssets <= 0) return null;

  type Seg = { label: string; symbol?: string; value: number; pct: number; color: string; priced: boolean };
  const segs: Seg[] = lt.constituents.map((c, i) => ({
    label: c.label,
    symbol: c.symbol,
    value: c.value,
    pct: (c.value / grossAssets) * 100,
    color: COLORS[i % COLORS.length],
    priced: c.priced,
  }));
  // Named private holdings (PIA, CPHGC, etc.) — each its own segment.
  const unlistedShades = ["#8C7A5C", "#9C8A6C", "#7C6A4C", "#A89A7C", "#6E6048"];
  (lt.unlistedHoldings ?? []).forEach((u, i) => {
    if (u.value > 0) segs.push({ label: u.label, value: u.value, pct: (u.value / grossAssets) * 100, color: unlistedShades[i % unlistedShades.length], priced: true });
  });
  const legacyLump = lt.unlistedValue - (lt.unlistedHoldings ?? []).reduce((s, u) => s + u.value, 0);
  if (legacyLump > 0) {
    segs.push({ label: "Other unlisted", value: legacyLump, pct: (legacyLump / grossAssets) * 100, color: UNLISTED_COLOR, priced: true });
  }

  const discount = lt.discountPct;
  const cheap = discount != null && discount > 0;

  return (
    <div className="border border-rule p-5 md:p-6" style={{ background: "var(--paper-2)" }}>
      <div className="flex items-baseline justify-between gap-3 mb-5">
        <div>
          <span className="font-mono font-medium text-[15px]">{lt.symbol}</span>
          <span className="text-muted text-[13px] ml-2">{lt.name}</span>
        </div>
        <span className="label-cap">Holding company</span>
      </div>

      <div className="flex gap-5 md:gap-8">
        {/* Legend */}
        <div className="flex-1 min-w-0 space-y-2.5">
          {segs.map((s) => (
            <div key={s.label} className="flex items-center gap-2.5 text-[13px]">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: s.color, opacity: s.priced ? 1 : 0.4 }} />
              <span className="font-mono font-medium shrink-0">{s.symbol ?? ""}</span>
              <span className="text-muted truncate flex-1">{s.symbol && s.symbol !== s.label ? s.label : ""}</span>
              <span className="font-mono mono-num text-muted shrink-0">{fmtRs(s.value, true)}</span>
              <span className="font-mono mono-num shrink-0 w-12 text-right" style={{ color: "var(--accent-deep)" }}>
                {s.pct.toFixed(1)}%
              </span>
            </div>
          ))}
          {lt.netDebt > 0 && (
            <div className="flex items-center gap-2.5 text-[13px] pt-1 border-t border-rule mt-1">
              <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ background: "#A6453B" }} />
              <span className="font-mono font-medium shrink-0">Net debt</span>
              <span className="text-muted flex-1" />
              <span className="font-mono mono-num shrink-0" style={{ color: "var(--negative)" }}>
                −{fmtRs(lt.netDebt, true)}
              </span>
            </div>
          )}
        </div>

        {/* The barrel: a stacked column sized by share of gross assets. */}
        <div className="shrink-0 flex flex-col items-center">
          <div
            className="w-[78px] md:w-[92px] rounded-md overflow-hidden flex flex-col border"
            style={{ height: 320, borderColor: "var(--ink)" }}
            aria-hidden
          >
            {segs.map((s) => (
              <div
                key={s.label}
                title={`${s.symbol ?? s.label} · ${s.pct.toFixed(1)}%`}
                className="w-full flex items-center justify-center"
                style={{ height: `${Math.max(s.pct, 1.5)}%`, background: s.color, opacity: s.priced ? 1 : 0.4 }}
              >
                {s.pct >= 8 && <span className="text-[10px] font-mono font-semibold" style={{ color: "rgba(0,0,0,0.55)" }}>{s.pct.toFixed(0)}%</span>}
              </div>
            ))}
          </div>
          <div className="label-cap mt-2">Gross assets</div>
        </div>
      </div>

      {/* NAV vs market price */}
      <div className="grid grid-cols-3 gap-3 mt-6 pt-5 border-t border-ink">
        <Stat label="Assets / share (NAV)" value={fmtRs(lt.navPerShare, true)} />
        <Stat label="Market price" value={fmtRs(lt.marketPrice, true)} />
        <Stat
          label={cheap ? "Discount to NAV" : "Premium to NAV"}
          value={discount == null ? "—" : `${cheap ? "−" : "+"}${Math.abs(discount).toFixed(1)}%`}
          tone={cheap ? "positive" : "negative"}
        />
      </div>
      <p className="text-[12px] text-muted mt-4 max-w-[80ch]">
        The market values {lt.symbol} at {fmtRs(lt.marketPrice, true)} a share, while the companies and assets it owns
        are worth {fmtRs(lt.navPerShare, true)} a share.{" "}
        {discount == null
          ? ""
          : cheap
          ? `That's the "extra value" — you buy ${Math.abs(discount).toFixed(1)}% more in underlying assets than you pay.`
          : `It trades ${Math.abs(discount).toFixed(1)}% above the value of what it holds.`}
        {lt.unlistedValue <= 0 && lt.netDebt <= 0 && " (Listed stakes only — add unlisted assets and net debt on the holding's page to sharpen this.)"}
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div>
      <div className="label-cap mb-1">{label}</div>
      <div
        className="font-display mono-num text-[22px]"
        style={{ fontVariationSettings: "'opsz' 144", color: tone === "positive" ? "var(--positive)" : tone === "negative" ? "var(--negative)" : "var(--ink)" }}
      >
        {value}
      </div>
    </div>
  );
}
