// Run the ladder against the real KSE-100 record and print the table.
//
//   npx tsx scripts/backtest-run.ts [--yield 11] [--monthly 25000] [--start 100000]
//
// Reads the same end-of-day feed the app uses, so what comes out here is what
// the Plan page will show.

import { fetchEodSeries } from "../lib/timeseries/psx-eod";
import { runBacktest, DEFAULT_CONFIG, type BacktestConfig } from "../lib/calculations/backtest";

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const rs = (v: number) => Math.round(v).toLocaleString("en-PK");
const pad = (s: string, n: number) => s.padEnd(n);
const padL = (s: string, n: number) => s.padStart(n);

async function main() {
  const series = await fetchEodSeries("KSE100");
  if (series.length === 0) {
    console.log("No index history came back. The PSX feed is unreachable from here.");
    process.exit(1);
  }

  const config: Partial<BacktestConfig> = {
    startCash: arg("start", DEFAULT_CONFIG.startCash),
    monthlyContribution: arg("monthly", DEFAULT_CONFIG.monthlyContribution),
    cashYieldPct: arg("yield", DEFAULT_CONFIG.cashYieldPct),
  };

  const r = runBacktest(series, config);

  console.log("");
  console.log("KSE-100, " + r.from + " to " + r.to + "  (" + r.bars + " sessions, " + r.years.toFixed(1) + " years)");
  console.log(
    "Index " + rs(r.indexStart) + " to " + rs(r.indexEnd) + "   " +
    (r.indexReturnPct >= 0 ? "+" : "") + r.indexReturnPct.toFixed(1) + "%" +
    "   worst fall " + r.indexMaxDrawdownPct.toFixed(1) + "%"
  );
  console.log(
    "Rs " + rs(r.config.startCash) + " to start, Rs " + rs(r.config.monthlyContribution) +
    " a month, cash earning " + r.config.cashYieldPct + "%"
  );
  console.log("Rungs: " + r.config.rungs.map((x) => "-" + x.fallPct + "% -> " + x.pct + "%").join("  "));
  console.log("");

  const head =
    pad("Strategy", 30) + padL("Final", 14) + padL("In", 13) + padL("Return", 10) +
    padL("A year", 9) + padL("Worst", 8) + padL("Buys", 6) + padL("Invested", 10);
  console.log(head);
  console.log("-".repeat(head.length));
  for (const s of r.strategies) {
    console.log(
      pad(s.label, 30) +
        padL(rs(s.finalValue), 14) +
        padL(rs(s.contributed), 13) +
        padL((s.returnPct >= 0 ? "+" : "") + s.returnPct.toFixed(1) + "%", 10) +
        padL(s.xirrPct == null ? "n/a" : (s.xirrPct >= 0 ? "+" : "") + s.xirrPct.toFixed(1) + "%", 9) +
        padL(s.maxDrawdownPct.toFixed(1) + "%", 8) +
        padL(String(s.buys), 6) +
        padL(s.avgTimeInvestedPct.toFixed(0) + "%", 10)
    );
  }

  console.log("");
  console.log("Average index level over the period: " + rs(r.avgIndexLevel));
  for (const s of r.strategies) {
    if (s.avgBuyLevel > 0) {
      const gap = ((s.avgBuyLevel - r.avgIndexLevel) / r.avgIndexLevel) * 100;
      console.log(
        "  " + pad(s.label, 30) + "bought at " + padL(rs(s.avgBuyLevel), 8) +
        "  (" + (gap >= 0 ? "+" : "") + gap.toFixed(1) + "% vs average)"
      );
    }
  }

  console.log("");
  console.log(r.verdict);
  for (const n of r.notes) console.log("Note: " + n);

  // Sensitivity: the cash yield is the assumption that decides this, so show
  // what a different one would do rather than letting one number stand alone.
  console.log("");
  console.log("Same run at other cash yields (money-weighted, a year):");
  console.log(
    "  " + pad("yield", 8) + padL("always in", 12) + padL("ladder", 12) + padL("+regime", 12) + padL("cash only", 12)
  );
  for (const y of [0, 6, 11, 15, 20]) {
    const alt = runBacktest(series, { ...config, cashYieldPct: y });
    const cell = (k: string) => {
      const s = alt.strategies.find((x) => x.key === k);
      return padL(s?.xirrPct == null ? "n/a" : s.xirrPct.toFixed(1) + "%", 12);
    };
    console.log("  " + pad(y + "%", 8) + cell("alwaysIn") + cell("ladder") + cell("ladderRegime") + cell("cashOnly"));
  }
  // Sub-periods. One five-year number hides everything: the same rule that
  // drags in a rally is the one that saves you in a bear. Splitting the record
  // is the difference between a backtest and an advertisement.
  console.log("Broken into windows (money-weighted, a year):");
  const windows: Array<[string, string, string]> = [
    ["the whole record", series[0].date, series[series.length - 1].date],
    ["the 2021-23 bear", "2021-01-01", "2023-06-30"],
    ["the 2023-26 rally", "2023-07-01", series[series.length - 1].date],
    ["last three years", isoYearsAgo(3), series[series.length - 1].date],
    ["last two years", isoYearsAgo(2), series[series.length - 1].date],
  ];
  console.log(
    "  " + pad("window", 20) + padL("index", 10) + padL("always in", 12) +
    padL("ladder", 12) + padL("+regime", 12) + padL("cash", 10) + padL("ladder dd", 11) + padL("always dd", 11)
  );
  for (const [label, from, to] of windows) {
    const slice = series.filter((b) => b.date >= from && b.date <= to);
    if (slice.length < 260) {
      console.log("  " + pad(label, 20) + "  not enough history in the feed (" + slice.length + " sessions)");
      continue;
    }
    const w = runBacktest(slice, config);
    const g = (k: string) => w.strategies.find((x) => x.key === k);
    const p = (v: number | null | undefined) =>
      padL(v == null ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%", 12);
    console.log(
      "  " + pad(label, 20) +
        padL((w.indexReturnPct >= 0 ? "+" : "") + w.indexReturnPct.toFixed(0) + "%", 10) +
        p(g("alwaysIn")?.xirrPct) + p(g("ladder")?.xirrPct) + p(g("ladderRegime")?.xirrPct) +
        padL((g("cashOnly")?.xirrPct ?? 0).toFixed(1) + "%", 10) +
        padL((g("ladder")?.maxDrawdownPct ?? 0).toFixed(1) + "%", 11) +
        padL((g("alwaysIn")?.maxDrawdownPct ?? 0).toFixed(1) + "%", 11)
    );
  }
  console.log("");
}

function isoYearsAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
