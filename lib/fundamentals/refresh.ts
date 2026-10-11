import "server-only";
import { connectDb } from "@/lib/db";
import { HoldingModel, FundamentalModel, WatchlistModel } from "@/lib/models";
import { fetchCompanyPage, parseFinancials } from "@/lib/prices/fundamentals";
import { parseFilings } from "@/lib/prices/filings";
import { fetchPayouts } from "@/lib/prices/payouts";
import { fetchBalanceSheet, FILED_REPORT } from "@/lib/prices/balance-sheet";
import { kse100Symbols } from "@/lib/quant/universe";
import { refreshQualityInputs } from "@/lib/fundamentals/board";
import { latestCloses } from "@/lib/quant/sheet-bars";
import { listings } from "@/lib/watchlist";

// Reading a company's page on the exchange for the quality and price figures
// (lib/fundamentals/quality.ts): the nightly run (/api/cron/refresh-quality)
// and the watchlist's Save, which reads the never-read shares of a newly
// ticked sector at once.

// The KSE-100, every name held and every share of a sector someone watches.
export async function qualityUniverse(): Promise<string[]> {
  await connectDb();
  const [held, uni, lists] = await Promise.all([
    HoldingModel.find({}, { symbol: 1 }).lean(),
    kse100Symbols().catch(() => ({ symbols: [] as string[] })),
    WatchlistModel.find({}, { sectors: 1 }).lean(),
  ]);
  const sectors = new Set((lists as any[]).flatMap((w) => w.sectors ?? []));
  const watched = listings().filter((l) => sectors.has(l.sector)).map((l) => l.symbol);
  return [...new Set([...(held as any[]).map((h) => h.symbol as string), ...uni.symbols, ...watched])];
}

// When each name's page was last read (0 for never).
export async function lastRead(symbols: string[]): Promise<Map<string, number>> {
  const docs = (await FundamentalModel.find({ symbol: { $in: symbols } }, { symbol: 1, qualityCheckedAt: 1 }).lean()) as any[];
  return new Map(docs.map((d) => [d.symbol, d.qualityCheckedAt ? new Date(d.qualityCheckedAt).getTime() : 0]));
}

// One company: its page once for the financials and the filings, its payouts
// (the dividend yield of a name not held), and the balance sheet from the
// newest filed report when that report is new. Annual rows are merged, so the
// history grows past the four years the page shows. `lite` reads the page
// only, leaving payouts and the balance sheet to the nightly run; `reread`
// reads the newest report's balance sheet even if it was read before.
export async function readCompany(s: string, o: { lite?: boolean; reread?: boolean } = {}): Promise<string> {
  try {
    const html = await fetchCompanyPage(s);
    if (!html) {
      await FundamentalModel.updateOne({ symbol: s }, { $set: { qualityCheckedAt: new Date() } });
      return "page unavailable";
    }
    const fund = parseFinancials(html, s);
    const payouts = o.lite ? null : await fetchPayouts(s).catch(() => null);
    const prev: any = await FundamentalModel.findOne({ symbol: s }).lean();
    const byYear = new Map<number, any>();
    for (const r of prev?.annual ?? []) byYear.set(r.fiscalYear, r);
    for (const r of fund?.annual ?? []) if (r.eps != null || r.profitAfterTax != null) byYear.set(r.fiscalYear, r);
    const annual = [...byYear.values()].sort((a, b) => b.fiscalYear - a.fiscalYear);

    const update: Record<string, unknown> = {
      symbol: s,
      annual,
      qualityCheckedAt: new Date(),
      ...(fund
        ? {
            sector: fund.sector || prev?.sector || "",
            latestEps: fund.latestEps,
            epsGrowthPct: fund.epsGrowthPct,
            latestNetMarginPct: fund.latestNetMarginPct,
            marginTrendPct: fund.marginTrendPct,
            revenueGrowthPct: fund.revenueGrowthPct,
            peTtm: fund.peTtm,
            pegTtm: fund.pegTtm,
            sharesOutstanding: fund.sharesOutstanding,
            marketCapThousands: fund.marketCapThousands,
            fiscalYearEndMonth: fund.fiscalYearEndMonth ?? prev?.fiscalYearEndMonth ?? null,
            faceValue: fund.faceValue ?? prev?.faceValue ?? 10,
            // Fresh only when the payouts were read too, as getFundamentals
            // takes it to mean both.
            ...(payouts != null ? { fetchedAt: new Date() } : {}),
          }
        : {}),
      ...(payouts != null
        ? { payouts: payouts.map((p) => ({ date: p.announceDate ?? p.bookClosureStart, bookClosure: p.bookClosureStart, pctOfFace: p.pctOfFace, cycle: p.cycle, payoutType: p.payoutType })) }
        : {}),
    };

    const reports = parseFilings(html, s)
      .filter((f) => f.pdfUrl && FILED_REPORT.test(f.title))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((f) => ({ title: f.title, pdfUrl: f.pdfUrl!, date: f.date }));
    const newest = reports[0]?.pdfUrl ?? null;
    let bsNote = "no report";
    if (o.lite) bsNote = "page only";
    else if (newest && (o.reread || newest !== prev?.balanceTried?.url)) {
      const bs = await fetchBalanceSheet(reports, 3, { shares: fund?.sharesOutstanding ?? prev?.sharesOutstanding ?? null, faceValue: prev?.faceValue ?? 10 });
      update.balanceTried = { url: newest, at: new Date(), ok: !!bs };
      if (bs) {
        update.balanceSheet = { ...bs, readAt: new Date() };
        bsNote = `equity Rs ${(bs.equity / 1e9).toFixed(2)}B at ${bs.periodEnd} (${bs.consolidated ? "consolidated" : "standalone"}, ${bs.method})`;
      } else bsNote = "report not readable";
    } else if (newest) bsNote = prev?.balanceSheet ? `kept ${prev.balanceSheet.periodEnd}` : "report not readable (seen)";
    await FundamentalModel.findOneAndUpdate({ symbol: s }, { $set: update }, { upsert: true });
    return `${annual.length} years; ${bsNote}`;
  } catch (e) {
    return `error: ${String(e).slice(0, 120)}`;
  }
}

// Several companies, one at a time (the requests themselves are spaced by
// lib/prices/dps.ts), then the pages' inputs gathered afresh so what was read
// shows at once.
export async function readCompanies(symbols: string[], o: { lite?: boolean; reread?: boolean } = {}): Promise<Record<string, string>> {
  const report: Record<string, string> = {};
  for (const s of symbols) {
    report[s] = await readCompany(s, o);
  }
  await refreshQualityInputs().catch(() => {});
  return report;
}

// The watched shares that traded this week and whose page has never been
// read, read page-only in the background (one run at a time in this
// process). Returns how many it took.
let reading: Promise<unknown> | null = null;
export async function readNewlyWatched(max = 80): Promise<number> {
  if (reading) return 0;
  const [all, closes] = await Promise.all([qualityUniverse(), latestCloses().catch(() => new Map())]);
  const seen = await lastRead(all);
  const fresh = all.filter((s) => !seen.get(s) && closes.has(s)).slice(0, max);
  if (fresh.length === 0) return 0;
  reading = readCompanies(fresh, { lite: true })
    .catch(() => null)
    .finally(() => {
      reading = null;
    });
  return fresh.length;
}
