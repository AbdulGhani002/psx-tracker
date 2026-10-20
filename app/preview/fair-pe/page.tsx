import { notFound } from "next/navigation";
import { FairPeView } from "@/app/fair-pe/FairPeView";
import { buildHistory, type CompanyInput, type Macro } from "@/lib/fair-pe/calc";

// The Fair P/E page on made-up companies, through the real figures, for
// looking at the design on a machine with no database. Development only.
export const dynamic = "force-dynamic";

const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const MARKET_PE = [9, 9.5, 8, 6.5, 7, 7.5, 4.5, 3.6, 4.6, 6.6, 8];
const RATES = [6, 6, 7, 13, 7.5, 7.6, 15, 22, 18.5, 10.9, 11.8];

function company(symbol: string, sector: string, tilt: number, profit: number, fyEndMonth: number, payout: number, k: number): CompanyInput {
  const shares = 1e9;
  const annual = YEARS.slice(5).map((y, i) => ({ fiscalYear: y, profit: profit * (1 + 0.12 * i) * (1 + 0.05 * Math.sin(k + i)) }));
  const c: CompanyInput = { symbol, sector, shares, fyEndMonth, annual, at: {}, priceNow: null, cash: [] };
  YEARS.forEach((y, i) => {
    const earn = profit * (1 + 0.12 * Math.max(0, i - 5)) * 0.9;
    const price = (MARKET_PE[i] * tilt * (1 + 0.06 * Math.cos(k * 3 + i)) * earn) / shares;
    c.at[`${y}-06-30`] = { adj: price, actual: price };
    c.cash.push({ date: `${y - 1}-10-15`, cash: (payout * earn) / shares });
  });
  c.priceNow = (c.at["2026-06-30"].adj ?? 0) * 1.08;
  return c;
}

export default function FairPePreview() {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const cos: CompanyInput[] = [
    company("MEBL", "Commercial Banks", 0.8, 90e9, 12, 0.5, 1),
    company("MCB", "Commercial Banks", 0.85, 70e9, 12, 0.6, 2),
    company("UBL", "Commercial Banks", 0.75, 80e9, 12, 0.55, 3),
    company("OGDC", "Oil & Gas Exploration Companies", 0.7, 240e9, 6, 0.35, 4),
    company("PPL", "Oil & Gas Exploration Companies", 0.65, 120e9, 6, 0.25, 5),
    company("MARI", "Oil & Gas Exploration Companies", 1.1, 85e9, 6, 0.3, 6),
    company("LUCK", "Cement", 1.3, 46e9, 6, 0.15, 7),
    company("DGKC", "Cement", 1.2, 10e9, 6, 0.1, 8),
    company("FFC", "Fertilizer", 1.1, 70e9, 12, 0.8, 9),
    company("EFERT", "Fertilizer", 1.0, 30e9, 12, 0.85, 10),
    company("HUBC", "Power Generation & Distribution", 0.8, 60e9, 6, 0.6, 11),
    company("KAPCO", "Power Generation & Distribution", 0.6, 15e9, 6, 0.7, 12),
    company("INDU", "Automobile Assembler", 1.2, 25e9, 6, 0.6, 13),
    company("ATLH", "Automobile Assembler", 1.3, 15e9, 3, 0.7, 14),
  ];
  const dates = YEARS.map((y) => `${y}-06-30`);
  const history = buildHistory(cos, dates, "2026-10-20", [{ symbol: "XYZ", why: "sample" }]);
  const years: Record<string, Macro> = Object.fromEntries(YEARS.map((y, i) => [String(y), { tbill: RATES[i], policy: null, cpi: null }]));
  return (
    <FairPeView
      board={{
        history,
        inputs: { now: {}, years: {} },
        known: { now: { tbill: 12.5, policy: 11, cpi: 5.6 }, years },
        held: ["MEBL", "LUCK", "HUBC", "INDU", "ATLH"],
        builtAt: "2026-10-20T10:00:00.000Z",
      }}
    />
  );
}
