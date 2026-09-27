import { Card } from "@/components/ui/Card";
import type { EventRecord } from "@/lib/quant/event-record";

// What happened around this company's dividends, bonus issues and splits:
// the price against the market in the 20 sessions before each ex-date and
// the 5 and 20 after, beside the same averages across every listed name.

const pct = (v: number | null, d = 1) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const tone = (v: number | null) => (v == null ? undefined : v >= 0 ? "var(--positive)" : "var(--negative)");
const fmtDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Splits come in standard ratios; the sheets' factor can sit off them when a
// payout settled the same day (MARI 2024 reads 9.35 for its 1:10).
const SPLITS = [2, 3, 4, 5, 10, 20, 25, 50, 100];
const splitRatio = (ratioPct: number) => {
  const f = 1 + ratioPct / 100;
  return SPLITS.reduce((best, s) => (Math.abs(Math.log(s / f)) < Math.abs(Math.log(best / f)) ? s : best), SPLITS[0]);
};

function what(r: EventRecord["rows"][number]): string {
  if (r.kind === "cash") return `Dividend Rs ${r.cash.toFixed(2)}`;
  if (r.kind === "split") return `Split 1:${splitRatio(r.ratioPct)}`;
  return `Bonus ${r.ratioPct.toFixed(0)}%`;
}

function Stat({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="text-[18px] font-bold mono-num" style={{ color }}>{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function EventRecordCard({ record }: { record: EventRecord | null }) {
  if (!record) {
    return (
      <Card>
        <p className="text-[13px] text-muted">No dividends, bonus issues or splits on record for this name.</p>
      </Card>
    );
  }
  const { own, market } = record;
  return (
    <Card>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label={`Dividends${own.since ? ` since ${own.since.slice(0, 4)}` : ""}`} value={String(own.dividends)} />
        <Stat label="Paid in the last 12 months" value={`${own.yield12Pct.toFixed(1)}%`} hint="as a yield on the price each was paid at" />
        <Stat label="20 days before the ex-date" value={pct(own.before20Pct)} color={tone(own.before20Pct)} hint={own.beatBefore != null ? `ahead of the market ${Math.round(own.beatBefore * 100)}% of the time` : undefined} />
        <Stat label="20 days after" value={pct(own.after20Pct)} color={tone(own.after20Pct)} hint="against the market" />
      </div>
      <div className="mt-3 text-[12px] text-muted">
        Every stock, {market.n.toLocaleString("en-US")} dividends: {pct(market.before20Pct, 2)} in the 20 days before, {pct(market.after20Pct, 2)} in the 20 after.
      </div>
      <div className="mt-4 overflow-x-auto -mx-2">
        <table className="table-zar">
          <thead>
            <tr><th>Ex-date</th><th>What</th><th className="text-right">Yield</th><th className="text-right">20 days before</th><th className="text-right">5 after</th><th className="text-right">20 after</th></tr>
          </thead>
          <tbody>
            {record.rows.slice(0, 10).map((r) => (
              <tr key={r.date + r.kind}>
                <td className="mono-num whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="whitespace-nowrap">{what(r)}</td>
                <td className="text-right mono-num">{r.kind === "cash" ? `${r.yieldPct.toFixed(1)}%` : "–"}</td>
                <td className="text-right mono-num" style={{ color: tone(r.before20Pct) }}>{pct(r.before20Pct)}</td>
                <td className="text-right mono-num" style={{ color: tone(r.after5Pct) }}>{pct(r.after5Pct)}</td>
                <td className="text-right mono-num" style={{ color: tone(r.after20Pct) }}>{pct(r.after20Pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted">
        Moves are against the market, on prices adjusted for the payout. From the exchange&apos;s closing sheets to {fmtDate(record.dataTo)}; they carry no record for 2006 to 2012.
      </p>
    </Card>
  );
}
