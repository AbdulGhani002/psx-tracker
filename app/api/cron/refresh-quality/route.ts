import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { HoldingModel, FundamentalModel } from "@/lib/models";
import { fetchCompanyPage, parseFinancials } from "@/lib/prices/fundamentals";
import { parseFilings } from "@/lib/prices/filings";
import { fetchPayouts } from "@/lib/prices/payouts";
import { fetchBalanceSheet, FILED_REPORT } from "@/lib/prices/balance-sheet";
import { kse100Symbols } from "@/lib/quant/universe";
import { refreshQualityInputs } from "@/lib/fundamentals/board";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 900;

// Machine-only, daily (psx-quality.timer): the company pages behind the
// quality and price figures (lib/fundamentals/quality.ts), for the KSE-100,
// every name held and the watchlist. A run takes the `max` names checked
// longest ago (30 by default), so the whole universe turns over in a few
// days and a run stays short. Each name's page is read once for its
// financials and its filings, and its payouts are read (the dividend yield
// of a name not held, and the weekly refresh getFundamentals would otherwise
// skip once this run has marked the page fresh); the balance sheet is read from the newest
// filed report only when that report is new (a scanned filing is not
// downloaded again). Annual rows are merged, so the history grows past the
// four years the page shows. Body {symbols:[...]} refreshes just those;
// {reread:true} reads the newest report's balance sheet even if it was read
// before (after a fix to the statement reader).
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const max = Math.max(1, Math.min(150, Number(body?.max ?? 30)));
  const reread = body?.reread === true;
  const t0 = Date.now();

  let symbols: string[] = Array.isArray(body?.symbols) ? body.symbols.map((s: string) => String(s).toUpperCase()) : [];
  if (symbols.length === 0) {
    const held = (await HoldingModel.find({}, { symbol: 1 }).lean()).map((h: any) => h.symbol as string);
    const uni = await kse100Symbols().catch(() => ({ symbols: [] as string[] }));
    const all = [...new Set([...held, ...uni.symbols])];
    const docs = (await FundamentalModel.find({ symbol: { $in: all } }, { symbol: 1, qualityCheckedAt: 1 }).lean()) as any[];
    const checked = new Map(docs.map((d) => [d.symbol, d.qualityCheckedAt ? new Date(d.qualityCheckedAt).getTime() : 0]));
    symbols = all.sort((a, b) => (checked.get(a) ?? 0) - (checked.get(b) ?? 0)).slice(0, max);
  }

  const report: Record<string, string> = {};
  for (const s of symbols) {
    try {
      const html = await fetchCompanyPage(s);
      if (!html) {
        report[s] = "page unavailable";
        await FundamentalModel.updateOne({ symbol: s }, { $set: { qualityCheckedAt: new Date() } });
        continue;
      }
      const fund = parseFinancials(html, s);
      const payouts = await fetchPayouts(s).catch(() => null);
      const prev: any = await FundamentalModel.findOne({ symbol: s }).lean();
      // The years on the page, and any older ones kept from earlier runs.
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

      // The balance sheet, from the newest filed report when it is new.
      const reports = parseFilings(html, s)
        .filter((f) => f.pdfUrl && FILED_REPORT.test(f.title))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((f) => ({ title: f.title, pdfUrl: f.pdfUrl!, date: f.date }));
      const newest = reports[0]?.pdfUrl ?? null;
      let bsNote = "no report";
      if (newest && (reread || newest !== prev?.balanceTried?.url)) {
        const bs = await fetchBalanceSheet(reports, 3, { shares: fund?.sharesOutstanding ?? prev?.sharesOutstanding ?? null, faceValue: prev?.faceValue ?? 10 });
        update.balanceTried = { url: newest, at: new Date(), ok: !!bs };
        if (bs) {
          update.balanceSheet = { ...bs, readAt: new Date() };
          bsNote = `equity Rs ${(bs.equity / 1e9).toFixed(2)}B at ${bs.periodEnd} (${bs.consolidated ? "consolidated" : "standalone"}, ${bs.method})`;
        } else bsNote = "report not readable";
      } else if (newest) bsNote = prev?.balanceSheet ? `kept ${prev.balanceSheet.periodEnd}` : "report not readable (seen)";
      await FundamentalModel.findOneAndUpdate({ symbol: s }, { $set: update }, { upsert: true });
      report[s] = `${annual.length} years; ${bsNote}`;
    } catch (e) {
      report[s] = `error: ${String(e).slice(0, 120)}`;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  // The pages' inputs gathered afresh, so what was just read shows at once.
  await refreshQualityInputs().catch(() => {});
  return NextResponse.json({ ok: true, seconds: Math.round((Date.now() - t0) / 1000), refreshed: symbols.length, report });
}
