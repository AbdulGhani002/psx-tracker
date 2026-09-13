import { notFound } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { AllocationDonut } from "@/components/charts/AllocationDonut";
import { Heatmap } from "@/components/charts/Heatmap";
import { Sparkline } from "@/components/ui/Sparkline";
import { NetWorthChart } from "@/components/dashboard/NetWorthChart";
import { StackedPayoutBars, AssetBars } from "@/components/charts/DividendBars";
import { HoldingsTable, type HoldingRow } from "@/app/holdings/HoldingsTable";
import { monthlyTable, type MonthlyCell } from "@/lib/analytics/performance";

// The overview and the holding tab on sample data, for looking at the design
// on a machine with no database. Development only.
export const dynamic = "force-dynamic";

function series(n: number, start: number, drift: number, vol: number, seed = 7) {
  let x = seed;
  const rnd = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const out: Array<{ date: string; value: number; bench: number }> = [];
  let v = start;
  let invested = start * 0.82;
  const d = new Date("2025-09-12T00:00:00Z");
  for (let i = 0; i < n; i++) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      v *= Math.exp(drift + vol * (rnd() - 0.5) * 2);
      if (i % 60 === 30) invested += 40000;
      out.push({ date: d.toISOString().slice(0, 10), value: v, bench: invested });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-US")}`;
const signed = (v: number) => `${v >= 0 ? "+" : "-"}Rs ${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

export default function PreviewPage({ searchParams }: { searchParams?: { view?: string } }) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const pts = series(365, 1180000, 0.0007, 0.014);
  const cells: MonthlyCell[] = [];
  let s = 3;
  for (let y = 2024; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 9) break;
      s = (s * 9301 + 49297) % 233280;
      cells.push({ year: y, month: m, ret: (s / 233280 - 0.42) * 0.16 });
    }
  }
  const table = monthlyTable(cells);
  const names = [
    ["MEBL", "Meezan Bank Limited", "Banks", 290, 425.09, 554.09, 3.34, 2110, 3400],
    ["MARI", "Mari Energies Limited", "Oil & Gas", 221, 564.01, 676.12, 1.25, 1851, 0],
    ["HINOON", "Highnoon Laboratories", "Pharma", 40, 812.5, 925.0, 1.5, 3270, 1200],
    ["MUREB", "Murree Brewery", "Food", 60, 870.0, 909.0, -0.2, -460, 0],
    ["AHCL", "Arif Habib Corporation", "Inv. Banks", 750, 14.5, 14.95, 0.13, 250, 0],
    ["PTL", "Panther Tyres", "Auto Parts", 200, 48.0, 49.4, -0.4, -210, 0],
  ] as const;
  const rows: HoldingRow[] = names.map(([symbol, name, sector, shares, avg, price, chg, profit, divs]) => ({
    symbol,
    name,
    sector,
    shares,
    avgCost: avg,
    price,
    priceKnown: true,
    marketValue: shares * price,
    unrealizedPL: shares * (price - avg),
    unrealizedPct: (price - avg) / avg,
    dividendsReceived: divs,
    totalCost: shares * avg,
    currentPercent: (shares * price) / 4100,
    targetPercent: 20,
    deviation: 0,
    staleDays: null,
    spark: pts.slice(-30).map((p) => p.value),
    todayPct: chg / 100,
    todayProfit: profit,
    shariah: symbol === "MUREB" ? "NON" : "KMIALL",
  }));
  const view = searchParams?.view ?? "overview";

  if (view === "holding") {
    return (
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-3">
            <span className="initials text-[12px]" style={{ background: "#dcfce7", color: "#16a34a" }}>MA</span>
            <div>
              <div className="text-[18px] font-semibold leading-tight">Main</div>
              <div className="text-[11.5px] text-muted flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--positive)" }} /> Priced at the last close · BMA Capital</div>
            </div>
          </div>
          <div className="flex items-center gap-2"><span className="btn-ghost">Import</span><span className="btn-primary">Add trade</span></div>
        </div>
        <div className="tabs mb-4">
          {["Holding", "Analytics", "Trade history", "Payouts", "Cash", "CGT", "Zakat", "Rebalance", "Settings"].map((t, i) => (
            <Link key={t} href={i === 3 ? "/preview?view=payouts" : "/preview?view=holding"} data-active={i === 0}>{t}</Link>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 stagger">
          <StatCard label="Investment value" value="Rs 914,610" />
          <StatCard label="Unrealized gain/loss" value="+Rs 204,120" tone="positive" delta="+22.32%" deltaTone="positive" />
          <StatCard label="Today's return" value="+Rs 10,177" tone="positive" delta="+0.88%" deltaTone="positive" />
          <StatCard label="Dividends" value="Rs 21,334" action={<span className="text-[11px] link-underline">View details</span>} />
          <StatCard label="Dividend tax" value="Rs 3,200" />
          <StatCard label="Available cash" value="Rs 237,632" />
          <StatCard label="Realized gain/loss" value="+Rs 87,430" tone="positive" />
          <StatCard label="Total return" value="+Rs 312,884" tone="positive" delta="+34.21%" deltaTone="positive" />
          <StatCard label="Deductions" value="Rs 4,118" hint="Brokerage and levies on trades" />
          <StatCard label="CGT (FY26-27)" value="Rs 13,115" hint="15% on +Rs 87,430 net gain" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
          <div className="xl:col-span-2 min-h-[340px]"><NetWorthChart title="Market value" value={1172567} samplePoints={pts} /></div>
          <Card title="Holdings" action={<span className="text-[12px] text-muted">6 positions</span>}>
            <AllocationDonut slices={rows.map((r) => ({ label: r.symbol, value: r.marketValue }))} centerValue="6" centerLabel="names" />
          </Card>
        </div>
        <Card className="mt-3"><HoldingsTable rows={rows} staleAfterDays={7} /></Card>
      </div>
    );
  }

  if (view === "payouts") {
    const months = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8 - 23 + i, 1));
      const k = d.toISOString().slice(0, 7);
      const byAsset: Record<string, number> = {};
      if (i % 3 === 1) byAsset.MEBL = 4000 + (i % 5) * 900;
      if (i % 4 === 2) byAsset.HINOON = 2500 + (i % 3) * 700;
      if (i % 6 === 5) byAsset.MARI = 3200;
      return { month: k, byAsset };
    });
    return (
      <div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger">
          <StatCard label="Gross dividend" value="Rs 124,071" hint="41 warrants" />
          <StatCard label="Tax" value="Rs 19,046" tone="negative" />
          <StatCard label="Zakat" value="Rs 2,692" tone="negative" />
          <StatCard label="Net dividend" value="Rs 105,024" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
          <Card title="Dividend income over time" eyebrow="Net dividend per asset per month, last 24 months"><StackedPayoutBars months={months} assets={["MEBL", "HINOON", "MARI"]} /></Card>
          <Card title="Dividends received by asset" eyebrow="Total net dividends over the life of the portfolio"><AssetBars rows={[{ label: "MEBL", value: 26000 }, { label: "HINOON", value: 19500 }, { label: "MARI", value: 12800 }, { label: "AHCL", value: 4000 }]} /></Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 stagger">
        <StatCard label="Total net worth" value="Rs 1,410,199" />
        <StatCard label="Today's P&L" value="+Rs 10,177" tone="positive" delta="+0.88%" deltaTone="positive" />
        <StatCard label="Total return" value="+Rs 312,884" tone="positive" delta="+34.21%" deltaTone="positive" />
        <StatCard label="Invested" value="Rs 914,610" />
        <StatCard label="Available cash" value="Rs 237,632" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2 min-h-[340px]"><NetWorthChart title="Market value" value={1172567} samplePoints={pts} /></div>
        <Card title="Asset allocation">
          <AllocationDonut slices={[{ label: "Equity", value: 1172567 }, { label: "Mutual fund", value: 237632 }, { label: "Cash", value: 12000 }]} centerValue="3" centerLabel="Classes" />
        </Card>
      </div>
      <div className="mt-5">
        <div className="flex items-baseline justify-between mb-2"><div className="text-[12px] text-muted">2 portfolios</div><span className="text-[12px] link-underline">Manage</span></div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[["Main", "MA", "#16a34a", 1227799, 9496, 0.89, 995511, 60390, 103120], ["Trading book", "TB", "#26a69a", 182400, -1092, -0.41, 170000, 12400, 12400]].map(([n, ini, c, v, dp, dpct, inv, unr, tot]) => (
            <div key={String(n)} className="card card-pad">
              <div className="flex items-center gap-2.5"><span className="initials text-[11px]" style={{ background: `color-mix(in srgb, ${c} 18%, white)`, color: String(c) }}>{ini}</span><span className="text-[13px] font-semibold">{n}</span></div>
              <div className="flex items-end justify-between gap-3 mt-3">
                <div><div className="fig text-[17px] whitespace-nowrap">{rs(Number(v))}</div><span className="pill mt-1.5" data-tone={Number(dp) >= 0 ? "positive" : "negative"}>{signed(Number(dp))} ({Number(dpct) >= 0 ? "+" : ""}{dpct}%)</span></div>
                <Sparkline points={pts.slice(-30).map((p) => p.value)} width={72} height={28} />
              </div>
              <div className="mini-stats mt-3">
                <div><div className="label">Invested</div><div className="value">{rs(Number(inv))}</div></div>
                <div><div className="label">Unrealized</div><div className="value" style={{ color: "var(--positive)" }}>{signed(Number(unr))}</div></div>
                <div><div className="label">Total return</div><div className="value" style={{ color: "var(--positive)" }}>{signed(Number(tot))}</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-5">
        <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card title="Top gainers" eyebrow="11 Sep 2026">
            <div className="hairline-list">
              {names.filter((n) => n[6] > 0).map((n) => (
                <div key={n[0]} className="flex items-center justify-between"><div><div className="font-semibold text-[13px]">{n[0]}</div><div className="text-[11px] text-muted">{n[1]}</div></div><div className="text-right"><div className="mono-num text-[13px]">{n[5].toFixed(2)}</div><div className="mono-num text-[11.5px]" style={{ color: "var(--positive)" }}>+{n[6]}% · {signed(n[7])}</div></div></div>
              ))}
            </div>
          </Card>
          <Card title="Top losers" eyebrow="11 Sep 2026">
            <div className="hairline-list">
              {names.filter((n) => n[6] < 0).map((n) => (
                <div key={n[0]} className="flex items-center justify-between"><div><div className="font-semibold text-[13px]">{n[0]}</div><div className="text-[11px] text-muted">{n[1]}</div></div><div className="text-right"><div className="mono-num text-[13px]">{n[5].toFixed(2)}</div><div className="mono-num text-[11.5px]" style={{ color: "var(--negative)" }}>{n[6]}% · {signed(n[7])}</div></div></div>
              ))}
            </div>
          </Card>
        </div>
        <Card title="Recent activity" action={<span className="text-[12px] link-underline">All</span>}>
          <div className="hairline-list">
            {[["Bought", "AHCL", "750 @ 14.50", -10900.88, "11 Sep"], ["Bought", "PTL", "200 @ 48.00", -9616.56, "11 Sep"], ["Dividend", "ABL", "250 sh × 3.40", 850, "9 Sep"], ["Sold", "ABL", "250 @ 172.10", 42613.86, "7 Sep"], ["Bought", "MEBL", "70 @ 565.90", -39616.83, "7 Sep"]].map(([k, sym, t, amt, d], i) => (
              <div key={i} className="flex items-center justify-between">
                <div><div className="text-[13px]"><span className="text-muted">{k}</span> <span className="font-semibold">{sym}</span></div><div className="text-[11px] text-muted">{t}</div></div>
                <div className="text-right"><div className="mono-num text-[12.5px]" style={{ color: Number(amt) > 0 ? "var(--positive)" : "var(--ink)" }}>{signed(Number(amt))}</div><div className="text-[10.5px]" style={{ color: "var(--faint)" }}>{d}</div></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mt-3">
        <div className="xl:col-span-2"><Card title="Performance heatmap" eyebrow="Monthly time-weighted return"><Heatmap table={table} years={3} /></Card></div>
        <Card title="What moved it" eyebrow="Last 30 days, price only" action={<span className="mono-num text-[13px] font-semibold" style={{ color: "var(--positive)" }}>+Rs 41,200</span>}>
          <div className="space-y-2.5">
            {[["MEBL", 21000], ["LUCK", 12400], ["HINOON", 8100], ["MARI", -2600], ["PTL", -1200]].map(([s2, v]) => (
              <div key={String(s2)} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 text-[12.5px]">
                <span className="font-semibold">{s2}</span>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}><div className="h-full rounded-full" style={{ width: `${Math.abs(Number(v)) / 210}%`, background: Number(v) >= 0 ? "var(--positive)" : "var(--negative)" }} /></div>
                <span className="mono-num" style={{ color: Number(v) >= 0 ? "var(--positive)" : "var(--negative)" }}>{signed(Number(v))}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
