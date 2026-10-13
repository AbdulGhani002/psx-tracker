// A price line with a buy zone in green, a sell zone in red, an optional stop
// as a red tick and today's price as a dot. Everything is placed as a
// percentage of a range that holds every level, so it reads the same at any
// width; the numbers sit in a row under the line, never on it, so they cannot
// collide on a phone.

export const money = (v: number) => (v >= 10000 ? Math.round(v).toLocaleString("en-US") : v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

type Props = {
  price: number;
  buyLow: number;
  buyHigh: number;
  sellLow: number;
  sellHigh: number;
  stop?: number | null;
  compact?: boolean;
};

export function ZoneBar({ price, buyLow, buyHigh, sellLow, sellHigh, stop, compact = false }: Props) {
  const levels = [price, buyLow, buyHigh, sellLow, sellHigh, stop ?? 0].filter((v) => v > 0);
  const lo0 = Math.min(...levels), hi0 = Math.max(...levels);
  const pad = (hi0 - lo0) * 0.05 || hi0 * 0.02;
  const lo = lo0 - pad, hi = hi0 + pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const zone = (a: number, b: number) => {
    const l = x(Math.min(a, b)), w = Math.max(1.5, x(Math.max(a, b)) - l);
    return { left: `${l}%`, width: `${w}%` };
  };
  const where = price <= buyHigh ? "in the buy zone" : price >= sellLow ? "in the sell zone" : "between the zones";

  return (
    <div role="img" aria-label={`Price ${money(price)}, ${where}. Buy ${money(buyLow)} to ${money(buyHigh)}, sell ${money(sellLow)} to ${money(sellHigh)}${stop ? `, stop ${money(stop)}` : ""}.`}>
      <div className={`relative ${compact ? "h-5" : "h-7"}`}>
        <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full" style={{ background: "var(--rule-strong)" }} />
        <div
          className="absolute top-0.5 bottom-0.5 rounded-md"
          style={{ ...zone(buyLow, buyHigh), background: "color-mix(in srgb, var(--positive) 24%, transparent)", border: "1px solid color-mix(in srgb, var(--positive) 60%, transparent)" }}
        />
        <div
          className="absolute top-0.5 bottom-0.5 rounded-md"
          style={{ ...zone(sellLow, sellHigh), background: "color-mix(in srgb, var(--negative) 20%, transparent)", border: "1px solid color-mix(in srgb, var(--negative) 55%, transparent)" }}
        />
        {stop != null && stop > 0 && (
          <div className="absolute top-0 bottom-0 w-[2px] rounded-full" style={{ left: `${x(stop)}%`, background: "var(--negative)" }} />
        )}
        <div
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${compact ? "w-3 h-3" : "w-4 h-4"}`}
          style={{ left: `${x(price)}%`, background: "var(--ink)", border: "2px solid var(--surface)", boxShadow: "0 0 0 1px var(--ink)" }}
        />
      </div>
      <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 mt-1.5 ${compact ? "text-[11.5px]" : "text-[12.5px]"}`}>
        <span style={{ color: "var(--positive)" }}>
          Buy <span className="font-semibold mono-num">{money(buyLow)}–{money(buyHigh)}</span>
        </span>
        <span className="text-muted">
          Now <span className="font-semibold mono-num" style={{ color: "var(--ink)" }}>{money(price)}</span>
        </span>
        <span style={{ color: "var(--negative)" }}>
          Sell <span className="font-semibold mono-num">{money(sellLow)}–{money(sellHigh)}</span>
        </span>
      </div>
    </div>
  );
}
