import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { MutualFundModel } from "@/lib/models";
import { extractLines } from "@/lib/pdf/pos-text";
import { parseIsaveStatement, walkCost, ISAVE_CODE_TO_MUFAP } from "@/lib/funds/isave-parse";
import { getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MUFAP_NAVS_KEY = "mufapNavs";

type FundResult = {
  code: string;
  mufapName: string | null;
  units: number;
  nav: number;
  value: number;
  asOf: string;
  tracked: boolean;
  unitsBefore: number | null;
  unitsDelta: number | null;
  applied: boolean;
  note: string;
  activityRows: number;
  avgCostBefore: number | null;
  avgCostProposed: number | null; // from the statement's own transaction rows
  costNote: string;
};

// One statement PDF in, reconciliation out. Preview by default; ?apply=1 writes
// units + anchorDate on the user's tracked funds and refreshes the durable NAV
// snapshot. Refuses to write anything if the statement fails its own arithmetic
// (problems non-empty). Cost basis is NEVER touched here — units on a statement
// say nothing about what you paid.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("files");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "not_pdf" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  const apply = req.nextUrl.searchParams.get("apply") === "1" || form.get("apply") === "1";

  let statement;
  try {
    const pages = await extractLines(new Uint8Array(await file.arrayBuffer()));
    statement = parseIsaveStatement(pages);
  } catch (err) {
    return NextResponse.json({ error: "parse_failed", detail: String(err) }, { status: 422 });
  }

  await connectDb();
  const userId = await uid();
  const tracked = await MutualFundModel.find({ userId }).lean();
  const byMufapName = new Map(tracked.map((t) => [t.mufapName.toLowerCase(), t]));

  const canApply = statement.problems.length === 0;
  const funds: FundResult[] = [];
  let appliedCount = 0;

  for (const f of statement.funds) {
    const mufapName = ISAVE_CODE_TO_MUFAP[f.code] ?? null;
    const doc = mufapName ? byMufapName.get(mufapName.toLowerCase()) : undefined;
    const r: FundResult = {
      code: f.code,
      mufapName,
      units: f.units,
      nav: f.nav,
      value: f.value,
      asOf: f.asOf,
      tracked: !!doc,
      unitsBefore: doc ? doc.units : null,
      unitsDelta: doc ? Math.round((f.units - doc.units) * 10000) / 10000 : null,
      applied: false,
      note: "",
      activityRows: f.activity?.rows.length ?? 0,
      avgCostBefore: doc ? doc.avgCost : null,
      avgCostProposed: null,
      costNote: "",
    };
    // Cost proposal from the statement's own rows: only meaningful when the
    // window STARTS where our books stand (opening balance = tracked units),
    // the unit chain reconciles, and every row's nature is classifiable.
    let costWalk: ReturnType<typeof walkCost> | null = null;
    if (doc && f.activity) {
      if (Math.abs(f.activity.lastBalance - doc.units) > 0.002) {
        r.costNote = `statement window opens at ${f.activity.lastBalance} units but you're tracked at ${doc.units} — a statement in between is missing, cost untouched`;
      } else {
        costWalk = walkCost(f.activity, doc.avgCost);
        if (costWalk.ok) {
          r.avgCostProposed = Math.round(costWalk.newAvgCost * 1e6) / 1e6;
          const bits: string[] = [];
          if (costWalk.moneyIn > 0) bits.push(`Rs ${costWalk.moneyIn.toFixed(2)} new money in`);
          if (costWalk.costOut > 0) bits.push(`Rs ${costWalk.costOut.toFixed(2)} cost out at your average`);
          if (bits.length === 0) bits.push("only reinvested dividends — units free, cost unchanged");
          r.costNote = bits.join("; ");
        } else {
          r.costNote = `cost untouched: ${costWalk.reason}`;
        }
      }
    }
    if (!mufapName) {
      r.note = "unknown iSave code — not applied, tell me and I'll map it";
    } else if (!doc) {
      r.note = `on statement but not tracked (Rs ${f.value.toFixed(2)}) — add it in Assets if you want it counted`;
    } else if (doc.anchorDate && doc.anchorDate > f.asOf) {
      r.note = `tracked units are anchored ${doc.anchorDate}, newer than this statement (${f.asOf}) — not applied`;
    } else if (apply && canApply) {
      const set: Record<string, unknown> = { units: f.units, anchorDate: f.asOf };
      if (r.avgCostProposed != null) set.avgCost = r.avgCostProposed;
      await MutualFundModel.updateOne({ _id: doc._id, userId }, { $set: set });
      r.applied = true;
      const costPart =
        r.avgCostProposed != null
          ? `, avg cost ${doc.avgCost} → ${r.avgCostProposed} from the statement's own rows`
          : r.unitsDelta !== 0
            ? " (cost basis untouched — no clean transaction rows to derive it from)"
            : "";
      r.note = (r.unitsDelta === 0 ? "units confirmed, anchor moved" : `units ${doc.units} → ${f.units}`) + costPart;
      appliedCount++;
    } else if (apply && !canApply) {
      r.note = "statement failed its own arithmetic — nothing applied";
    }
    funds.push(r);
  }

  // Refresh the durable NAV snapshot from the statement's repurchase prices —
  // fund-level truth, useful even while MUFAP 403s us. Never regress a newer
  // snapshot, and merge by name so fundIds already stored are preserved.
  let navSeeded = false;
  if (apply && canApply && statement.funds.length > 0) {
    const asOf = statement.funds.map((f) => f.asOf).sort().at(-1)!;
    const snap = await getFeedSnapshot<{ at: string; navs: Array<{ name: string; amc: string; nav: number; fundId?: number | null }> }>(MUFAP_NAVS_KEY);
    const existingAt = snap.data?.at ?? "";
    if (asOf >= existingAt) {
      const navs = [...(snap.data?.navs ?? [])];
      for (const f of statement.funds) {
        const name = ISAVE_CODE_TO_MUFAP[f.code];
        if (!name) continue;
        const i = navs.findIndex((n) => n.name.toLowerCase() === name.toLowerCase());
        if (i >= 0) navs[i] = { ...navs[i], nav: f.nav };
        else navs.push({ name, amc: "", nav: f.nav, fundId: null });
      }
      await saveFeedSnapshot(MUFAP_NAVS_KEY, { at: asOf, navs }, "ok", `iSave statement ${asOf}`);
      navSeeded = true;
    }
  }

  return NextResponse.json({
    ok: canApply,
    applied: apply && canApply,
    appliedCount,
    navSeeded,
    registration: statement.registration,
    totalStated: statement.totalStated,
    totalComputed: statement.totalComputed,
    problems: statement.problems,
    funds,
  });
}
