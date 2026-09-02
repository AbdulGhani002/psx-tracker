// Assemble the filing pack for one tax year.
//
// getFbrPack already produces the dividends and the FIFO disposals. What it
// does not produce, and what nobody can reconstruct nine months later, is the
// position you actually held on 30 June and what those specific shares cost.
// That comes from re-running the lot engine over transactions truncated at the
// year end: the lots still open on that date ARE the wealth-statement holding,
// at the cost the wealth statement wants.

import { getFbrPack, getAllTransactions, getAppSettings } from "@/lib/data";
import { buildLots } from "@/lib/calculations/lots";
import { buildTaxPackTex, type TaxPackData } from "./tax-pack-template";

export { buildTaxPackTex };
export type { TaxPackData };

export async function assembleTaxPack(endYear?: number): Promise<TaxPackData> {
  const [pack, txs, settings] = await Promise.all([
    getFbrPack(endYear),
    getAllTransactions(),
    getAppSettings().catch(() => ({}) as any),
  ]);

  const yearEnd = `${pack.year.endYear}-06-30`;

  // Positions as they stood at the close of the year. Truncating the ledger and
  // re-running the same engine is the only way to get this right: a sale in
  // September changes today's average cost but must not change what you held in
  // June.
  const bySymbol = new Map<string, typeof txs>();
  for (const t of txs) {
    const d = new Date(t.date).toISOString().slice(0, 10);
    if (d > yearEnd) continue;
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }

  const holdings: TaxPackData["holdings"] = [];
  for (const [symbol, list] of bySymbol) {
    const { openLots } = buildLots(symbol, list);
    const shares = openLots.reduce((s, l) => s + l.shares, 0);
    if (shares <= 0.000001) continue;
    const cost = openLots.reduce((s, l) => s + l.shares * l.costPerShare, 0);
    const oldest = openLots.reduce((a, l) => (a === "" || l.acquired < a ? l.acquired : a), "");
    holdings.push({ symbol, shares, cost, lots: openLots.length, oldest });
  }
  holdings.sort((a, b) => b.cost - a.cost);
  const holdingsCost = holdings.reduce((s, h) => s + h.cost, 0);

  const notes = [
    "Profit on bank deposits and savings accounts (Section 151). The bank's withholding certificate is the filing document for that, and an estimate sitting next to exact figures is worse than a gap.",
    "Mutual fund income and redemptions. Fund gains are taxed on their own basis and the asset management company issues its own certificate.",
    "Salary, business income, rent, foreign income, and any asset outside this app. The wealth statement covers everything you own, not only your shares.",
    "Bonus shares issued to you. They appear here at zero cost, which is what the FIFO engine records, but the tax treatment at issue is a separate question for your accountant.",
    "Anything you did not record in the app. This pack is only as complete as the transactions in it.",
  ];

  const warnings: string[] = [];

  // A dividend with no tax recorded against it is almost always a gap in the
  // data rather than a payer that withheld nothing, and it silently understates
  // the credit you are owed.
  const noWht = pack.dividends.filter((r) => r.gross > 0 && r.wht === 0);
  if (noWht.length > 0) {
    warnings.push(
      `${noWht.map((r) => r.symbol).join(", ")}: dividends recorded with no withholding tax against them. Payers withhold at source, so this is usually a figure missing from the warrant entry rather than tax that was never deducted, and it understates the credit you can claim.`
    );
  }

  const zeroCost = holdings.filter((h) => h.cost <= 0);
  if (zeroCost.length > 0) {
    warnings.push(
      `${zeroCost.map((h) => h.symbol).join(", ")}: held at zero cost, which happens when a position came entirely from bonus shares. Correct for FIFO, but check it is what your broker also shows.`
    );
  }

  if (pack.disposals.length > 0 && !settings?.filerStatus) {
    warnings.push(
      "No filer status is set in the app, so the capital gains rate shown is a default. Set it before relying on that figure."
    );
  }

  const monthly = { day: "numeric", month: "long", year: "numeric" } as const;
  return {
    yearLabel: pack.year.label,
    fbrName: pack.year.fbrName,
    periodLine: `1 July ${pack.year.startYear} to 30 June ${pack.year.endYear}`,
    generatedOn: new Date().toLocaleDateString("en-GB", monthly),
    filerStatus: settings?.filerStatus === "filer" ? "a filer" : settings?.filerStatus === "non-filer" ? "a non-filer" : "unset",
    dividends: pack.dividends,
    divTotals: pack.divTotals,
    disposals: pack.disposals.map((x) => ({
      soldDate: x.soldDate,
      symbol: x.symbol,
      shares: x.shares,
      acquired: x.acquired,
      holdingDays: x.holdingDays,
      longTerm: x.longTerm,
      cost: x.cost,
      proceeds: x.proceeds,
      gain: x.gain,
    })),
    cgt: pack.cgt,
    yearEndDate: `30 June ${pack.year.endYear}`,
    holdings,
    holdingsCost,
    notes,
    warnings,
  };
}
