import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth/cron";
import { connectDb } from "@/lib/db";
import { runAsUser } from "@/lib/auth/current-user";
import { getAllUserIds } from "@/lib/data";
import { getBookFigures } from "@/lib/analytics/dashboard";
import { getFyProfits } from "@/lib/analytics/fy";
import { getRuleBoard } from "@/lib/rules/data";
import { checksLine } from "@/lib/rules/checks";
import { getSaleReviews } from "@/lib/analytics/trade-review";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Machine-only, read-only: the Yearly tab's years, the book's totals, the
// price rules' board and the sale review for one user, to
// check from the server (the pages need a signed-in session). Body {user: n}.
export async function POST(req: Request) {
  if (!(await cronAuthorised())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await connectDb();
  const body: any = await req.json().catch(() => ({}));
  const ids = await getAllUserIds();
  const uid = ids[Math.max(0, Math.min(ids.length - 1, Number(body?.user ?? 0)))];
  if (!uid) return NextResponse.json({ ok: false, error: "no users" });
  const r0 = (v: number | null | undefined) => (v == null ? null : Math.round(v));
  const one = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10);
  const out = await runAsUser(uid, async () => {
    const [book, fy, rules, sales] = await Promise.all([getBookFigures(), getFyProfits(), getRuleBoard().catch((e) => ({ error: String(e) }) as any), getSaleReviews().catch(() => [])]);
    return {
      book: { netWorth: r0(book.netWorth), invested: r0(book.invested), totalReturn: r0(book.totalReturn), sharesTotal: r0(book.equity.total), parkedOpen: r0(book.equity.parkedOpen), funds: r0(book.funds.gain), savings: r0(book.savings.profit), fixed: r0(book.fixedIncome.profit) },
      years: fy.years.map((y) => ({ fy: y.fy.label, shares: r0(y.profit), other: { funds: r0(y.other.funds), savings: r0(y.other.savings), fixed: r0(y.other.fixed) }, total: r0(y.total), cgt: r0(y.cgt), pct: one(y.returnPct), kse: one(y.market.kse), kmi: one(y.market.kmi), tbill: one(y.market.tbill), tbillFrom: y.market.tbillFrom, tbillRate: y.market.tbillRate, tbillAuction: y.market.tbillAuction })),
      yearsTotal: r0(fy.years.reduce((s, y) => s + y.total, 0)),
      rules: rules.error ? rules : { on: rules.settings.on, usualPct: one(rules.usualPct), asOf: rules.asOf, shares: rules.shares.map((s: any) => ({ symbol: s.symbol, move: one(s.move), at: s.at ? `${s.at.move} ${s.at.action}` : null, nextAdd: s.nextAdd ? `${s.nextAdd.step.move}% at ${s.nextAdd.price.toFixed(2)}` : null, nextSell: s.nextSell ? `${s.nextSell.step.move}% at ${s.nextSell.price.toFixed(2)}` : null, addsOff: s.addsOff, since: s.since, checks: checksLine(s.checks) })) },
      sales: { count: sales.length, helped: r0(sales.reduce((s, r) => s + (r.diff ?? 0), 0)), latest: sales.slice(0, 6).map((r) => ({ date: r.date, symbol: r.symbol, shares: r.shares, price: r.price, got: r0(r.proceeds), worthNow: r0(r.worthNow), dividends: r0(r.dividends), since: one(r.changePct), diff: r0(r.diff) })) },
    };
  });
  return NextResponse.json({ ok: true, ...out });
}
