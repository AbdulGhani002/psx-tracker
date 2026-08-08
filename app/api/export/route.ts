import { NextRequest, NextResponse } from "next/server";
import { getIntrinsicValuations, getDividendForecast, getPortfolioSummary, getFbrPack } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          const s = c == null ? "" : String(c);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\n");
}

const n = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "" : Number(v).toFixed(d));

// GET /api/export?sheet=valuation|holdings|forecast -> CSV (opens in Excel)
export async function GET(req: NextRequest) {
  const sheet = req.nextUrl.searchParams.get("sheet") ?? "valuation";
  let rows: (string | number | null)[][] = [];
  let name = sheet;

  if (sheet === "holdings") {
    const s = await getPortfolioSummary();
    rows = [["Symbol", "Name", "Sector", "Shares", "Avg cost", "Price", "Market value", "Unrealised P/L", "Unrealised %", "% of portfolio"]];
    for (const p of s.positions) {
      rows.push([p.symbol, p.name, p.sector, n(p.shares, 0), n(p.avgCost), n(p.currentPrice), n(p.marketValue, 0), n(p.unrealizedPL, 0), n(p.unrealizedPct * 100, 1), n(p.currentPercent, 1)]);
    }
  } else if (sheet === "fbr") {
    const yearParam = Number(req.nextUrl.searchParams.get("year"));
    const pack = await getFbrPack(Number.isFinite(yearParam) && yearParam > 2000 ? yearParam : undefined);
    name = `fbr-${pack.year.endYear}`;
    rows = [
      [`FBR filing pack — ${pack.year.fbrName} (${pack.year.label}, 1 Jul ${pack.year.startYear} – 30 Jun ${pack.year.endYear})`],
      [],
      ["DIVIDENDS BY PAYER (Sec 150) — from recorded warrants"],
      ["Symbol", "Payouts", "Gross", "WHT withheld", "Zakat deducted", "Net received"],
      ...pack.dividends.map((r): (string | number | null)[] => [r.symbol, r.count, n(r.gross), n(r.wht), n(r.zakat), n(r.net)]),
      ["TOTAL", pack.dividends.reduce((s, r) => s + r.count, 0), n(pack.divTotals.gross), n(pack.divTotals.wht), n(pack.divTotals.zakat), n(pack.divTotals.net)],
      [],
      ["CAPITAL GAINS — FIFO DISPOSALS"],
      ["Sold", "Symbol", "Shares", "Acquired", "Held (days)", "Long-term", "Cost", "Proceeds", "Gain"],
      ...pack.disposals.map((d): (string | number | null)[] => [d.soldDate, d.symbol, n(d.shares, 0), d.acquired, d.holdingDays, d.longTerm ? "yes" : "no", n(d.cost), n(d.proceeds), n(d.gain)]),
      ["CGT SUMMARY", "", `net gain ${n(pack.cgt.netGain)}`, `long-term ${n(pack.cgt.longTermGain)}`, `short-term ${n(pack.cgt.shortTermGain)}`, `CGT @ ${pack.cgt.rate}% = ${n(pack.cgt.cgt)}`],
      [],
      ["NOTES"],
      ["Savings profit-on-debt (Sec 151): file from the bank's WHT certificate — not estimated here."],
      ["Zakat above is what payers deducted at source, per the recorded warrants."],
      ["CGT uses FIFO lots with actual holding periods; verify rates against the current FBR schedule before filing."],
    ];
  } else if (sheet === "forecast") {
    const f = await getDividendForecast();
    name = "dividend-forecast";
    rows = [["Symbol", "Cadence", "EPS", "Payout %", "Declared/yr", "Fwd DPS/yr", "Yield %", "Cover", "Est. income/yr", "Health", "Confidence"]];
    for (const p of f.profiles) {
      rows.push([p.symbol, p.cadence, n(p.latestEps), n(p.appliedPayoutRatioPct, 0), n(p.declaredAnnualDps), n(p.forwardDpsAnnual), n(p.forwardYieldPct, 1), p.dividendCover == null ? "" : n(p.dividendCover, 1), n(p.expectedAnnualIncome, 0), p.sustainability, p.confidence]);
    }
  } else {
    const { items } = await getIntrinsicValuations();
    name = "valuation";
    rows = [["Symbol", "Price", "Intrinsic", "Low", "High", "Margin of safety %", "Buy below", "Zone", "Confidence"]];
    for (const v of items) {
      rows.push([v.symbol, n(v.price), n(v.intrinsic), n(v.low), n(v.high), n(v.marginOfSafetyPct, 0), n(v.buyBelow), v.zone, v.confidence]);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv(rows), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="psx-${name}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
