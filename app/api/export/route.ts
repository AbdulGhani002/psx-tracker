import { NextRequest, NextResponse } from "next/server";
import { getValuations, getDividendForecast, getPortfolioSummary } from "@/lib/data";

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
  } else if (sheet === "forecast") {
    const f = await getDividendForecast();
    name = "dividend-forecast";
    rows = [["Symbol", "Cadence", "EPS", "Payout %", "Declared/yr", "Fwd DPS/yr", "Yield %", "Cover", "Est. income/yr", "Health", "Confidence"]];
    for (const p of f.profiles) {
      rows.push([p.symbol, p.cadence, n(p.latestEps), n(p.appliedPayoutRatioPct, 0), n(p.declaredAnnualDps), n(p.forwardDpsAnnual), n(p.forwardYieldPct, 1), p.dividendCover == null ? "" : n(p.dividendCover, 1), n(p.expectedAnnualIncome, 0), p.sustainability, p.confidence]);
    }
  } else {
    const { valuations } = await getValuations();
    name = "valuation";
    rows = [["Symbol", "Price", "EPS", "Par", "P/E", "P/B", "ROE %", "Earn. yield %", "Div. yield %", "Fair value", "Margin of safety %", "Verdict"]];
    for (const v of valuations) {
      rows.push([v.symbol, n(v.price), n(v.eps), n(v.bookValuePerShare), n(v.pe, 1), n(v.pb, 1), n(v.roePct, 0), n(v.earningsYieldPct, 1), n(v.dividendYieldPct, 1), n(v.fairValue), n(v.marginOfSafetyPct, 0), v.verdict]);
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
