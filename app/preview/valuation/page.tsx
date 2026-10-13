import { notFound } from "next/navigation";
import { ValuationView } from "@/app/valuation/ValuationView";
import { CompanyView } from "@/app/valuation/[symbol]/CompanyView";
import { value, type Assumption } from "@/lib/valuation/engine";

// The valuation pages on made-up assumptions, valued by the real engine, for
// looking at the design on a machine with no database. ?symbol=MCB shows one
// share. Development only.
export const dynamic = "force-dynamic";

const TBILL = 12.49;
const PRICES = new Map<string, number>([["MCB", 360], ["AICL", 92], ["DGKC", 120], ["NML", 118], ["LPL", 17.5]]);
const A: Record<string, Assumption & { asOf: string; version: number; note?: string }> = {
  MCB: { symbol: "MCB", type: "bank", policy: "quality", governance: "green", eps: 45, dps: 30, bvps: 230, roe: 20, g: 7, asOf: "2026-10-12", version: 3, note: "−Rs3 a share for the remittance incentive and 52% tax." },
  AICL: { symbol: "AICL", type: "insurer", policy: "standard", governance: "green", eps: 14, dps: 6, bvps: 125, roe: 15, g: 6, valueGrowth: 11.2, peSpread: 4, margins: { trim: 1.15 }, metrics: { combinedRatio: 96 }, asOf: "2026-10-12", version: 2 },
  DGKC: {
    symbol: "DGKC", type: "opco-investments", policy: "standard", governance: "amber", confirm: "1QFY27 results", eps: 18, dps: 3, bvps: 260, roe: 7, g: 5, peSpread: 4, asOf: "2026-10-12", version: 1,
    sotp: { parts: [{ label: "MCB stake", kind: "listed", symbol: "MCB", shares: 76_000_000 }, { label: "Cement", kind: "operating", value: 60_000_000_000 }], netDebt: 20_000_000_000, discount: 0.2, shares: 438_000_000 },
  },
  NML: {
    symbol: "NML", type: "holdco", policy: "holdco", governance: "amber", confirm: "Payout policy", eps: null, dps: 5, bvps: null, roe: null, g: 0, asOf: "2026-10-12", version: 1,
    sotp: { parts: [{ label: "MCB stake", kind: "listed", symbol: "MCB", shares: 120_000_000, haircut: 0 }, { label: "Textile at 5x EBITDA", kind: "operating", value: 30_000_000_000 }], netDebt: 2_600_000_000, discount: 0, shares: 351_000_000 },
  },
};
const HELD = new Set(["MCB", "NML"]);
const NAMES: Record<string, string> = { MCB: "MCB Bank Limited", AICL: "Adamjee Insurance Company Limited", DGKC: "D.G. Khan Cement Company Limited", NML: "Nishat Mills Limited", LPL: "Lalpir Power Limited" };

const run = (a: (typeof A)[string], prices = PRICES) => ({ ...value(a, { price: prices.get(a.symbol)!, tbillPct: TBILL, held: HELD.has(a.symbol), stale: false, prices }), date: "2026-10-12", fired: [] as string[] });

export default async function ValuationPreview(props: { searchParams: Promise<{ symbol?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_PREVIEW !== "1") notFound();
  const { symbol } = await props.searchParams;
  if (symbol && A[symbol]) {
    const a = A[symbol];
    const draft = { ...a, _id: "d1", version: a.version + 1, status: "draft", source: "auto", eps: (a.eps ?? 0) * 1.08, asOf: "2026-08-28", note: "Latest year from the filing of 2026-08-28.", evidence: { filing: { date: "2026-08-28", title: "Financial Results for the Year Ended June 30, 2026", url: "https://dps.psx.com.pk/download/document/1.pdf", readable: true, period: "year", periodEnd: "2026-06-30", eps: 48.6, dps: 12 } } };
    const r = run(a);
    const c = {
      symbol, name: NAMES[symbol], held: HELD.has(symbol), price: PRICES.get(symbol)!, priceDate: "2026-10-12", tbill: TBILL,
      approved: { ...a, _id: "a1", status: "approved", source: "you" }, draft, suggested: null,
      versions: [draft, { ...a, _id: "a1", status: "approved", source: "you" }, { ...a, _id: "a0", version: a.version - 1, status: "superseded", source: "auto", eps: (a.eps ?? 0) * 0.9, asOf: "2026-04-20" }],
      run: r,
      history: [],
      triggers: [{ id: "t1", metric: "pb", op: ">=", threshold: 0.9, action: "trim", note: "Marked-to-market book", active: true, lastFiredAt: "" }, { id: "t2", metric: "combinedRatio", op: ">", threshold: 100, action: "exit", note: "Two quarters", active: true, lastFiredAt: "" }],
      filings: [{ title: "Financial Results for the Year Ended June 30, 2026", date: "2026-08-28", url: null, after: false }],
      closes: Object.fromEntries(PRICES),
      draftPreview: value({ ...a, eps: (a.eps ?? 0) * 1.08 }, { price: PRICES.get(symbol)!, tbillPct: TBILL, held: HELD.has(symbol), stale: false, prices: PRICES }),
      approvedPreview: r,
      suggestedPreview: null,
    };
    return <CompanyView c={c as any} />;
  }
  const rows = Object.values(A).map((a) => ({ symbol: a.symbol, name: NAMES[a.symbol], held: HELD.has(a.symbol), run: run(a), prev: { signal: a.symbol === "AICL" ? "WAIT" : run(a).signal }, assumption: a, draft: null }));
  const b = {
    date: "2026-10-12",
    tbill: TBILL,
    hurdles: { quality: TBILL + 3.5, standard: TBILL + 4.5 },
    rows,
    review: [{ symbol: "PTL", name: "Panther Tyres Limited", draft: { _id: "x", version: 1, source: "auto", note: "No balance sheet read: P/B and earnings power wait for one.", evidence: { filing: { date: "2026-09-30" } } }, approved: null }],
    stale: [],
    heldWithout: ["HINOON", "MUREB"],
  };
  return <ValuationView b={b as any} />;
}
