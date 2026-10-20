import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds } from "@/lib/data";
import { getFairPeBoard } from "@/lib/fair-pe/data";
import { fairOf, rateOf, shareFair, yearOf, type Macro } from "@/lib/fair-pe/calc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only: the Fair P/E page's figures for one user, to check from the
// server (the page needs a signed-in session). Body {user: n, rebuild: true}
// builds the history again.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const one = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
  const out = await runAsUser(uid, async () => {
    const b = await getFairPeBoard({ rebuild: body?.rebuild === true });
    const h = b.history;
    const pick = (typed: Macro | undefined, fallback: Macro | undefined): Macro => ({ tbill: typed?.tbill ?? fallback?.tbill ?? null, policy: typed?.policy ?? fallback?.policy ?? null, cpi: typed?.cpi ?? fallback?.cpi ?? null });
    const years: Record<string, Macro> = Object.fromEntries(h.dates.map((d) => [yearOf(d), pick(b.inputs.years[yearOf(d)], b.known.years[yearOf(d)])]));
    const nowM = pick(b.inputs.now, b.known.now);
    const rate = rateOf(nowM), extra = b.inputs.now.extraRisk ?? 0;
    const skip = b.inputs.skip ?? [];
    const fair = new Map([h.all, ...h.sectors].map((s) => [s.sector, fairOf(s, h.dates, years, rate, extra, skip)]));
    return {
      builtAt: b.builtAt,
      dates: h.dates,
      now: nowM,
      known: b.known,
      entered: b.inputs,
      companies: h.companies.length,
      excluded: h.excluded,
      sectors: [h.all, ...h.sectors].map((s) => {
        const f = fair.get(s.sector)!;
        return {
          sector: s.sector,
          n: `${s.now.profitable}/${s.now.companies}`,
          pe: Object.fromEntries(h.dates.filter((d) => s.years[d]?.pe != null).map((d) => [yearOf(d), one(s.years[d].pe)])),
          dy: Object.fromEntries(h.dates.filter((d) => s.years[d]?.dy != null).map((d) => [yearOf(d), one(s.years[d].dy)])),
          payout: Object.fromEntries(h.dates.filter((d) => s.years[d]?.payout != null).map((d) => [yearOf(d), one((s.years[d].payout ?? 0) * 100)])),
          peNow: one(f.peNow),
          dyNow: one(f.dyNow),
          premiums: f.premiums.map((p) => `${yearOf(p.date)} ${one(p.premium)}`),
          line: f.fit ? { a: one(f.fit.a), b: Math.round(f.fit.b * 100) / 100, miss: one(f.fit.miss), years: f.fit.years, rates: [one(f.fit.rmin), one(f.fit.rmax)] } : null,
          fairPe: one(f.fairPe),
          range: [one(f.fairPeLow), one(f.fairPeHigh)],
          fairDy: one(f.fairDy),
        };
      }),
      shares: [...new Set([...b.held, ...(b.inputs.watch ?? [])])].flatMap((sym): Array<Record<string, unknown>> => {
        const c = h.companies.find((x) => x.symbol === sym);
        const s = c ? h.sectors.find((x) => x.sector === c.sector) : undefined;
        if (!c || !s) return [{ symbol: sym, missing: true }];
        const f = shareFair(c, s, h.dates, fair.get(s.sector)?.fairPe ?? null);
        return [{ symbol: sym, sector: c.sector, peNow: one(f.peNow), ratio: f.ratio == null ? null : Math.round(f.ratio * 100) / 100, fairPe: one(f.fairPe), dyNow: one(f.dyNow), pe: Object.fromEntries(h.dates.filter((d) => c.years[d]?.pe != null).map((d) => [yearOf(d), one(c.years[d].pe)])) }];
      }),
    };
  });
  return NextResponse.json({ ok: true, ...out });
}
