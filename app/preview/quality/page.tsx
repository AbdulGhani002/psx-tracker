import { notFound } from "next/navigation";
import { Section } from "@/components/layout/Section";
import { QualityView } from "@/app/portfolio/tabs/QualityTab";
import { CompanyQualityView } from "@/components/quality/CompanyQualityPanel";
import { quality, portfolioQuality, median, type CpiPoint } from "@/lib/fundamentals/quality";
import type { QualityBoard, QualityRow } from "@/lib/fundamentals/board";

// The Quality tab and a company's Quality & value section on sample
// companies, for looking at the design on a machine with no database.
// Development only.
export const dynamic = "force-dynamic";

const R = 17;
const cpi: CpiPoint[] = [];
for (let y = 2019, idx = 100; y <= 2026; y++) for (let m = 1; m <= 12 && !(y === 2026 && m > 8); m++, idx *= 1.007) cpi.push({ period: `${y}-${String(m).padStart(2, "0")}`, index: idx });

// A company from a few traits: its latest EPS and how it grew, its ROE,
// payout, margin and leverage, and the price it trades at.
function sample(symbol: string, sector: string, price: number, eps: number, growth: number, roe: number, payout: number, margin: number, lev: number, held = 0, statement = true) {
  const shares = 100e6;
  const annual = [0, 1, 2, 3].map((k) => {
    const e = eps / Math.pow(1 + growth, k);
    const pat = (e * shares) / 1000;
    return { fiscalYear: 2026 - k, eps: e, profitAfterTax: pat, revenue: pat / margin, netMarginPct: margin * 100 };
  });
  const equity = (eps * shares) / roe;
  return { symbol, sector, price, shares, held, annual, balance: statement ? { periodEnd: "2026-06-30", equity, totalAssets: equity * lev } : null, dividendsTtm: eps * payout };
}

const COMPANIES = [
  sample("MUREB", "Food & personal care", 936, 137, 0.44, 0.18, 0.29, 0.12, 1.3, 31, false),
  sample("HINOON", "Pharmaceuticals", 1180, 98, 0.22, 0.34, 0.55, 0.19, 1.4, 23),
  sample("MEBL", "Commercial banks", 560, 50, 0.18, 0.31, 0.45, 0.42, 14, 21),
  sample("AHCL", "Inv. banks / securities", 210, 140, 0.9, 0.66, 0, 0.8, 1.1, 17),
  sample("PTL", "Automobile parts", 48, 7.7, 0.05, 0.14, 0.5, 0.06, 2.1, 8),
  ...["MARI", "OGDC", "PPL", "HUBC", "LUCK", "FFC", "ENGRO", "MCB", "UBL", "HBL", "SYS", "INDU", "EFERT", "NBP", "FABL", "BAHL", "DGKC", "MLCF", "PSO", "SNGP", "TRG", "SEARL", "ATRL", "NML", "KOHC"].map((s, k) =>
    sample(s, ["Oil & gas", "Cement", "Banks", "Fertilizer", "Technology"][k % 5], 100 + ((k * 37) % 300), 10 + ((k * 13) % 40), ((k * 7) % 30) / 100 - 0.05, 0.08 + ((k * 11) % 30) / 100, ((k * 17) % 70) / 100, 0.05 + ((k * 5) % 25) / 100, 1.2 + ((k * 3) % 9))
  ),
];

function board(): QualityBoard {
  const first = COMPANIES.map((c) => quality({ price: c.price, shares: c.shares, annual: c.annual, fiscalYearEndMonth: 6, dividendsTtm: c.dividendsTtm, balance: c.balance, manualBvps: null, cpi, costOfEquityPct: R }));
  const medianCape = median(first.map((q) => q.cape).filter((v): v is number => v != null));
  const total = COMPANIES.reduce((s, c) => s + c.held, 0);
  const rows: QualityRow[] = COMPANIES.map((c) => {
    const q = quality({ price: c.price, shares: c.shares, annual: c.annual, fiscalYearEndMonth: 6, dividendsTtm: c.dividendsTtm, balance: c.balance, manualBvps: null, cpi, costOfEquityPct: R, marketMedianCape: medianCape });
    return {
      symbol: c.symbol,
      sector: c.sector,
      held: c.held > 0,
      inIndex: true,
      shares: c.held * 100,
      value: c.held * 100000,
      weightPct: c.held > 0 ? (c.held / total) * 100 : null,
      price: c.price,
      priceFrom: c.held > 0 ? "live" : "close",
      marketCap: c.shares * c.price,
      q,
      balance: c.balance ? { ...c.balance, consolidated: false, method: "equity-line", source: "https://dps.psx.com.pk/", reportTitle: "Transmission of Annual Report" } : null,
      fiscalYearEndMonth: 6,
      peTtm: null,
      checkedAt: new Date().toISOString(),
    };
  });
  const held = rows.filter((r) => r.held);
  return {
    costOfEquityPct: R,
    sbpRatePct: 11,
    equityRiskPremiumPct: 6,
    marketMedianCape: medianCape,
    cpiPeriod: "2026-08",
    inputsAt: new Date().toISOString(),
    rows,
    portfolio: portfolioQuality(held.map((r) => ({ value: r.value, q: r.q }))),
    market: portfolioQuality(rows.map((r) => ({ value: r.marketCap!, q: r.q }))),
    counts: { companies: rows.length, withStatement: rows.filter((r) => r.q.bookSource === "statement").length, withRoe: rows.filter((r) => r.q.roePct != null).length, withCape: rows.filter((r) => r.q.cape != null).length, held: held.length },
  };
}

export default async function QualityPreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const b = board();
  const ctx = { costOfEquityPct: b.costOfEquityPct, sbpRatePct: b.sbpRatePct, equityRiskPremiumPct: b.equityRiskPremiumPct, marketMedianCape: b.marketMedianCape, cpiPeriod: b.cpiPeriod, inputsAt: b.inputsAt };
  return (
    <div>
      <QualityView b={b} />
      <Section title="Quality & value" description="A company's section, as on its holding page.">
        <CompanyQualityView row={b.rows.find((r) => r.symbol === "HINOON")!} ctx={ctx} />
      </Section>
      <Section title="Quality & value, no statement" description="A company whose filing could not be read.">
        <CompanyQualityView row={b.rows.find((r) => r.symbol === "MUREB")!} ctx={ctx} />
      </Section>
    </div>
  );
}
