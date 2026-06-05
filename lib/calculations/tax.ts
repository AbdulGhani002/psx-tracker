import type { Transaction } from "@/lib/types";
import { taxYearOf } from "@/lib/dates";

export type TaxSettings = {
  filerStatus: string; // "filer" | "non-filer"
  dividendWhtFiler: number;
  dividendWhtNonFiler: number;
  cgtRateFiler: number;
  cgtRateNonFiler: number;
};

export type DividendTaxRow = {
  taxYear: number;
  label: string;
  gross: number;
  taxWithheld: number;
  zakat: number;
  net: number;
  count: number;
};

export type TaxReport = {
  byYear: DividendTaxRow[];
  totalGross: number;
  totalWithheld: number;
  totalZakat: number;
  totalNet: number;
  realizedGains: number; // net realized P/L from sells
  estCgt: number; // estimate on positive realized gains
  // Filer/non-filer comparison on this year's dividends
  currentRate: number;
  otherRate: number;
  currentStatus: string;
  // What you saved (or would lose) by being a filer, on dividends this tax year
  dividendPenaltyIfNonFiler: number;
  wht: { filer: number; nonFiler: number };
  cgt: { filer: number; nonFiler: number };
};

export function buildTaxReport(
  transactions: Transaction[],
  realizedPL: number,
  settings: TaxSettings
): TaxReport {
  const map = new Map<number, DividendTaxRow>();
  for (const t of transactions) {
    if (t.type !== "DIVIDEND") continue;
    const ty = taxYearOf(new Date(t.date));
    const row =
      map.get(ty.endYear) ??
      { taxYear: ty.endYear, label: ty.label, gross: 0, taxWithheld: 0, zakat: 0, net: 0, count: 0 };
    row.gross += t.totalAmount;
    row.taxWithheld += t.taxDeducted ?? 0;
    row.zakat += t.zakatDeducted ?? 0;
    row.net += t.netAmount;
    row.count += 1;
    map.set(ty.endYear, row);
  }
  const byYear = [...map.values()].sort((a, b) => b.taxYear - a.taxYear);

  const totalGross = byYear.reduce((s, r) => s + r.gross, 0);
  const totalWithheld = byYear.reduce((s, r) => s + r.taxWithheld, 0);
  const totalZakat = byYear.reduce((s, r) => s + r.zakat, 0);
  const totalNet = byYear.reduce((s, r) => s + r.net, 0);

  const isFiler = settings.filerStatus === "filer";
  const currentRate = isFiler ? settings.dividendWhtFiler : settings.dividendWhtNonFiler;
  const otherRate = isFiler ? settings.dividendWhtNonFiler : settings.dividendWhtFiler;

  // This tax year's gross dividends.
  const thisYear = taxYearOf(new Date()).endYear;
  const thisYearGross = map.get(thisYear)?.gross ?? 0;
  const whtFiler = (thisYearGross * settings.dividendWhtFiler) / 100;
  const whtNonFiler = (thisYearGross * settings.dividendWhtNonFiler) / 100;
  const dividendPenaltyIfNonFiler = whtNonFiler - whtFiler;

  const positiveGain = Math.max(0, realizedPL);
  const cgtRate = isFiler ? settings.cgtRateFiler : settings.cgtRateNonFiler;
  const estCgt = (positiveGain * cgtRate) / 100;
  const cgtFiler = (positiveGain * settings.cgtRateFiler) / 100;
  const cgtNonFiler = (positiveGain * settings.cgtRateNonFiler) / 100;

  return {
    byYear,
    totalGross,
    totalWithheld,
    totalZakat,
    totalNet,
    realizedGains: realizedPL,
    estCgt,
    currentRate,
    otherRate,
    currentStatus: settings.filerStatus,
    dividendPenaltyIfNonFiler,
    wht: { filer: whtFiler, nonFiler: whtNonFiler },
    cgt: { filer: cgtFiler, nonFiler: cgtNonFiler },
  };
}

// Flag dividends whose effective WHT rate is materially off the expected band.
export function dividendWhtFlags(
  transactions: Transaction[],
  expectedFilerRate: number
): Array<{ symbol: string; date: string; effectiveRate: number; expected: number; note: string }> {
  const flags = [];
  for (const t of transactions) {
    if (t.type !== "DIVIDEND" || t.totalAmount <= 0) continue;
    const eff = ((t.taxDeducted ?? 0) / t.totalAmount) * 100;
    // Allow a band: 0 (exempt), ~10% (some IPPs), 15% (filer), 30% (non-filer).
    const near = (x: number) => Math.abs(eff - x) <= 1.5;
    if (!near(0) && !near(10) && !near(expectedFilerRate) && !near(expectedFilerRate * 2) && !near(25)) {
      flags.push({
        symbol: t.symbol,
        date: new Date(t.date).toISOString().slice(0, 10),
        effectiveRate: eff,
        expected: expectedFilerRate,
        note: `Effective WHT ${eff.toFixed(1)}% is off the usual ${expectedFilerRate}% filer band`,
      });
    }
  }
  return flags;
}
