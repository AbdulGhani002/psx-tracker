import "server-only";
import { connectDb } from "@/lib/db";
import { FundamentalModel } from "@/lib/models";
import { fetchMarketWatch, isInIndex } from "@/lib/prices/marketwatch";
import { fetchFundamentals } from "@/lib/prices/fundamentals";
import { deriveSharesOutstanding } from "@/lib/calculations/sotp";
import { aggregateSectorWeights, type SectorMember, type SectorWeight } from "@/lib/calculations/sector-weights";

// Heavy, scheduled job: build the KSE-100's own sector mix from free PSX data,
// so the Risk page can show "your sectors vs the index" instantly off a stored
// snapshot. For each index member we take the live price from market-watch and
// derive shares outstanding from the company's financials (profit ÷ EPS); the
// sector NAME comes from the company page (market-watch only gives a numeric
// code). Members are cached in the Fundamental collection so re-runs are cheap.

export const SECTOR_WEIGHTS_KEY = "kse100SectorWeights";
const SHARES_TTL_MS = 7 * 24 * 60 * 60 * 1000; // refresh a member's financials weekly

export type SectorWeightsSnapshot = {
  index: string;
  asOf: string; // ISO
  totalMarketCap: number; // of the priced members, in rupees
  members: number; // index members found in market-watch
  priced: number; // members we could value (price × derived shares)
  sectors: SectorWeight[];
  missing: string[]; // members we couldn't value (e.g. losses → no EPS-derived shares)
};

export async function buildKse100SectorWeights(opts: { politeMs?: number } = {}): Promise<SectorWeightsSnapshot> {
  const politeMs = opts.politeMs ?? 700;
  await connectDb();

  const mw = await fetchMarketWatch();
  if (!mw || mw.size === 0) throw new Error("market-watch unavailable");
  const members = [...mw.values()].filter((r) => isInIndex(r, "KSE100"));
  if (members.length === 0) throw new Error("no KSE100 members parsed from market-watch");

  const syms = members.map((m) => m.symbol);
  const cached = await FundamentalModel.find({ symbol: { $in: syms } }).lean();
  const bySym = new Map<string, any>(cached.map((c: any) => [c.symbol, c]));
  const now = Date.now();

  const sectorMembers: SectorMember[] = [];
  const missing: string[] = [];

  for (const m of members) {
    let doc: any = bySym.get(m.symbol);
    // Refresh if missing, no financials, NO SECTOR (docs cached before the
    // sector field existed — e.g. held symbols), or past the weekly TTL.
    const stale =
      !doc || !(doc.annual?.length > 0) || !doc.sector || now - new Date(doc.fetchedAt).getTime() > SHARES_TTL_MS;
    if (stale) {
      // One retry with backoff — a burst of ~97 requests can trip transient
      // throttling / challenge pages that clear on a second try.
      let fresh = await fetchFundamentals(m.symbol);
      if (!fresh) {
        await new Promise((r) => setTimeout(r, 1500));
        fresh = await fetchFundamentals(m.symbol);
      }
      if (fresh) {
        doc = await FundamentalModel.findOneAndUpdate(
          { symbol: m.symbol },
          {
            symbol: m.symbol,
            faceValue: fresh.faceValue ?? doc?.faceValue ?? 10,
            sector: fresh.sector || doc?.sector || "",
            annual: fresh.annual ?? doc?.annual ?? [],
            latestEps: fresh.latestEps ?? doc?.latestEps ?? null,
            epsGrowthPct: fresh.epsGrowthPct ?? doc?.epsGrowthPct ?? null,
            // keep any existing payouts; this job doesn't refresh them
            source: fresh.source ?? "psx-dps",
            fetchedAt: new Date(),
          },
          { upsert: true, new: true }
        ).lean();
      }
      await new Promise((r) => setTimeout(r, politeMs)); // be polite to PSX
    }

    // Derive shares from the most recent annual row that actually has both
    // figures — the newest column is sometimes blank (results not out yet).
    const valid = (doc?.annual ?? []).find((a: any) => a && a.eps != null && a.eps !== 0 && a.profitAfterTax != null);
    const shares = deriveSharesOutstanding(valid?.profitAfterTax ?? null, valid?.eps ?? null);
    const sector = (doc?.sector ?? "").trim();
    const marketCap = m.price > 0 && shares > 0 ? m.price * shares : 0;
    if (marketCap > 0 && sector) sectorMembers.push({ symbol: m.symbol, sector, marketCap });
    else missing.push(m.symbol);
  }

  const sectors = aggregateSectorWeights(sectorMembers);
  const totalMarketCap = sectorMembers.reduce((s, x) => s + x.marketCap, 0);

  return {
    index: "KSE100",
    asOf: new Date().toISOString(),
    totalMarketCap,
    members: members.length,
    priced: sectorMembers.length,
    sectors,
    missing,
  };
}
