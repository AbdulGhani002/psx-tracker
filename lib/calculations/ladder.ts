// The buying ladder: index level in, rupees out.
//
// The per-name deployment plan in deploy-plan.ts answers "which shares do I buy
// with this money". It cannot answer the question that comes first: "should I
// be buying at all today, and how much". That is what this file is for.
//
// A ladder is a list of rungs. Each rung names an index level and a slice of
// the pool. When the index trades at or below a rung's level, that rung is
// READY and its slice becomes spendable. Nothing else arms it — not a headline,
// not a feeling, not a green candle.
//
// Two properties make it a discipline rather than a suggestion:
//
//   1. Slices are cut from the pool as it stood when the ladder was armed, not
//      from whatever is left today. A ladder that re-cut itself every time you
//      spent would shrink each rung and quietly stop you buying the lows, which
//      is the exact opposite of the point.
//
//   2. A rung fires ONCE. Firing is recorded against the rung, so a market that
//      oscillates around a level cannot drain the pool by crossing it fifty
//      times. Re-arming is a deliberate act, never automatic.
//
// A reserve slice is held back permanently. If every rung fires, the reserve is
// what is still there for the level nobody modelled.
//
// Pure arithmetic. No dates, no fetching, no side effects.

export type LadderRung = {
  level: number; // index level at or below which this rung arms
  pct: number; // share of the pool, in per cent
  label: string; // free text, e.g. "first real support"
  firedAt: string; // ISO date, "" when still armed
  firedAmount: number; // what actually went out, may differ from plan
};

export type RungStatus = "FIRED" | "READY" | "WAITING";

// How much of the record the index has spent at least this far below its own
// running high. Supplied by the caller from real history; the ladder does no
// fetching of its own.
export type FallStat = { fallPct: number; sharePct: number };

// Build that record from a close series. On the KSE-100 the index has been 4%
// below its high in about half of all sessions and 22% below it in one session
// in five hundred, so splitting a pool evenly across those two levels is not
// balance — it is half the money doing nothing for years.
const FALL_BUCKETS = [0, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40];

export function fallDistributionOf(series: Array<{ close: number }>): FallStat[] {
  const closes = (series ?? []).map((b) => b.close).filter((c) => c > 0);
  if (closes.length === 0) return [];
  const counts = new Map<number, number>(FALL_BUCKETS.map((b) => [b, 0]));
  let peak = closes[0];
  for (const c of closes) {
    if (c > peak) peak = c;
    const fall = ((peak - c) / peak) * 100;
    for (const b of FALL_BUCKETS) if (fall >= b) counts.set(b, counts.get(b)! + 1);
  }
  return FALL_BUCKETS.map((b) => ({ fallPct: b, sharePct: (counts.get(b)! / closes.length) * 100 }));
}

// A rung's verdict once its level is compared against that record.
//   "dead" - holds real money behind a level the market almost never reaches
//   "thin" - reachable, but rarely enough to question the weight on it
export type RungReach = "" | "dead" | "thin";

export type LadderRungRow = LadderRung & {
  amount: number; // pct of the pool, in rupees
  cumulativePct: number; // this rung and every rung above it
  cumulativeAmount: number;
  poolAfter: number; // pool left once this rung has fired
  status: RungStatus;
  // The move the index still has to make to arm this rung, in per cent.
  // Negative is a fall, which is the normal case for a rung below today.
  // Positive would mean the index is already through it.
  moveRequiredPct: number;
  // How far below the reference high this rung sits, and how much of the
  // record the index has actually spent down there. Null when no history was
  // supplied. This is what turns "22% down feels like a good level" into a
  // number you can argue with.
  fallFromHighPct: number | null;
  reachedSharePct: number | null;
  reach: RungReach;
};

export type LadderPlan = {
  indexName: string;
  indexLevel: number;
  indexAsOf: string;
  poolAtArming: number; // the base every slice is cut from
  poolNow: number; // what is actually left to spend
  reservePct: number;
  reserveAmount: number;
  ladderPool: number; // poolAtArming minus the reserve — what the rungs divide
  rows: LadderRungRow[]; // ordered highest level first, the order they trigger
  ready: LadderRungRow[]; // armed and triggered right now
  readyAmount: number; // rupees the rules say to deploy today
  next: LadderRungRow | null; // nearest rung still waiting
  firedCount: number;
  firedAmount: number;
  allocatedPct: number; // sum of every rung's pct
  warnings: string[];
  // The always-invested slice. A ladder with no core is a GATE: no dip, no
  // buying, which in a market that drifts upward is a standing bet against the
  // drift. With a core it is a TILT: money works as it arrives, and a fall
  // decides how much extra goes in.
  corePct: number;
  coreAmount: number;
  referenceHigh: number;
  // Share of the pool sitting behind levels the index has rarely reached.
  deadPct: number;
  diagnostics: string[];
};

export type LadderInput = {
  indexName?: string;
  indexLevel: number;
  indexAsOf?: string;
  rungs: LadderRung[];
  poolAtArming: number;
  poolNow: number;
  reservePct?: number;
  corePct?: number;
  // The high the levels were written against, and the record of falls from a
  // running high. Both optional: without them the ladder works exactly as
  // before and simply says nothing about reachability.
  referenceHigh?: number;
  fallDistribution?: FallStat[];
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rs = (v: number) => Math.round(v).toLocaleString("en-PK");

// What share of the record did the index spend at least `fallPct` below its own
// running high? Linear between the points we have; below the first point the
// answer is 100 (every session is at least 0% down), past the last it is 0.
export function reachShare(dist: FallStat[], fallPct: number): number | null {
  const d = [...(dist ?? [])].filter((x) => Number.isFinite(x.fallPct) && Number.isFinite(x.sharePct))
    .sort((a, b) => a.fallPct - b.fallPct);
  if (d.length === 0) return null;
  if (fallPct <= d[0].fallPct) return d[0].sharePct;
  if (fallPct >= d[d.length - 1].fallPct) return 0;
  for (let i = 1; i < d.length; i++) {
    if (fallPct <= d[i].fallPct) {
      const a = d[i - 1];
      const b = d[i];
      const span = b.fallPct - a.fallPct;
      if (span <= 0) return b.sharePct;
      return a.sharePct + ((fallPct - a.fallPct) / span) * (b.sharePct - a.sharePct);
    }
  }
  return 0;
}

// The inverse: how far down does the index have to be for that to describe a
// given share of the record?
export function fallAtShare(dist: FallStat[], sharePct: number): number | null {
  const d = [...(dist ?? [])].filter((x) => Number.isFinite(x.fallPct) && Number.isFinite(x.sharePct))
    .sort((a, b) => a.fallPct - b.fallPct);
  if (d.length === 0) return null;
  for (let i = 1; i < d.length; i++) {
    if (sharePct >= d[i].sharePct) {
      const a = d[i - 1];
      const b = d[i];
      const span = a.sharePct - b.sharePct;
      if (span <= 0) return b.fallPct;
      return a.fallPct + ((a.sharePct - sharePct) / span) * (b.fallPct - a.fallPct);
    }
  }
  return d[d.length - 1].fallPct;
}

// A rung is DEAD when it holds real money behind something that almost never
// happens. The thresholds are deliberately loose: this flags an obvious
// mistake, it does not fine-tune a portfolio.
const DEAD_SHARE = 2; // reached in under 2% of sessions
const THIN_SHARE = 8;
const MATERIAL_PCT = 15; // and holds at least this much of the pool

export function planLadder({
  indexName = "KSE-100",
  indexLevel,
  indexAsOf = "",
  rungs,
  poolAtArming,
  poolNow,
  reservePct = 0,
  corePct = 0,
  referenceHigh = 0,
  fallDistribution,
}: LadderInput): LadderPlan {
  const level = num(indexLevel);
  const base = Math.max(0, num(poolAtArming));
  const now = Math.max(0, num(poolNow));
  const resPct = Math.min(100, Math.max(0, num(reservePct)));
  const reserveAmount = (base * resPct) / 100;
  const afterReserve = Math.max(0, base - reserveAmount);
  // The core is taken off the top: it is invested regardless of level, so it is
  // not the rungs' money to divide.
  const corePctClamped = Math.min(100, Math.max(0, num(corePct)));
  const coreAmount = (afterReserve * corePctClamped) / 100;
  const ladderPool = Math.max(0, afterReserve - coreAmount);
  const refHigh = Math.max(0, num(referenceHigh));
  const dist = fallDistribution ?? [];

  const warnings: string[] = [];

  // Highest level first: on the way down, that is the order they arm.
  const sorted = [...(rungs ?? [])]
    .map((r) => ({
      level: num(r.level),
      pct: Math.max(0, num(r.pct)),
      label: String(r.label ?? ""),
      firedAt: String(r.firedAt ?? ""),
      firedAmount: Math.max(0, num(r.firedAmount)),
    }))
    .filter((r) => r.level > 0)
    .sort((a, b) => b.level - a.level);

  const allocatedPct = sorted.reduce((s, r) => s + r.pct, 0);
  if (allocatedPct > 100 + 1e-9) {
    warnings.push(
      `Your rungs add up to ${allocatedPct.toFixed(0)}% of the pool. Anything over 100% cannot be funded — trim a rung.`
    );
  }

  const seen = new Set<number>();
  for (const r of sorted) {
    if (seen.has(r.level)) {
      warnings.push(`Two rungs sit on ${rs(r.level)}. The lower one can never arm on its own.`);
    }
    seen.add(r.level);
  }

  let cumulativePct = 0;
  const rows: LadderRungRow[] = sorted.map((r) => {
    const amount = (ladderPool * r.pct) / 100;
    cumulativePct += r.pct;
    const cumulativeAmount = (ladderPool * cumulativePct) / 100;
    const status: RungStatus = r.firedAt ? "FIRED" : level > 0 && level <= r.level ? "READY" : "WAITING";

    const fallFromHighPct = refHigh > 0 ? ((refHigh - r.level) / refHigh) * 100 : null;
    const reachedSharePct =
      fallFromHighPct != null && dist.length > 0 ? reachShare(dist, fallFromHighPct) : null;
    let reach: RungReach = "";
    if (reachedSharePct != null && r.pct >= MATERIAL_PCT) {
      if (reachedSharePct < DEAD_SHARE) reach = "dead";
      else if (reachedSharePct < THIN_SHARE) reach = "thin";
    }

    return {
      ...r,
      amount,
      cumulativePct,
      cumulativeAmount,
      poolAfter: Math.max(0, base - cumulativeAmount),
      status,
      moveRequiredPct: level > 0 ? ((r.level - level) / level) * 100 : 0,
      fallFromHighPct,
      reachedSharePct,
      reach,
    };
  });

  const ready = rows.filter((r) => r.status === "READY");
  const waiting = rows.filter((r) => r.status === "WAITING");
  // The nearest one below today's level: the smallest fall that arms something.
  const next = waiting.length > 0 ? waiting[0] : null;

  const readyPlanned = ready.reduce((s, r) => s + r.amount, 0);
  // Never instruct a spend larger than the money actually left.
  const readyAmount = Math.min(readyPlanned, Math.max(0, now - reserveAmount));
  if (readyPlanned > readyAmount + 1) {
    warnings.push(
      `The rules call for Rs ${rs(readyPlanned)} but only Rs ${rs(readyAmount)} sits above your reserve. Deploy what is there; do not raid the reserve.`
    );
  }

  const firedRows = rows.filter((r) => r.status === "FIRED");
  if (level > 0 && rows.length === 0) {
    warnings.push("No rungs set. Until you write the levels down, there is no rule — only mood.");
  }

  // --- what the record says about this ladder --------------------------------
  // A ladder is a set of bets on how far the market falls. Written from a blank
  // page it tends to weight the dramatic level heavily and the ordinary one
  // lightly, which is exactly backwards: the dramatic level is the one that
  // almost never arrives, so the money behind it never gets spent.
  const diagnostics: string[] = [];
  const scored = rows.filter((r) => r.reachedSharePct != null);
  const deadPct = rows
    .filter((r) => r.reach === "dead")
    .reduce((s, r) => s + r.pct, 0);
  const thinPct = rows.filter((r) => r.reach === "thin").reduce((s, r) => s + r.pct, 0);

  if (scored.length > 0) {
    for (const r of rows) {
      if (r.reach === "dead") {
        diagnostics.push(
          `${rs(r.level)} is ${r.fallFromHighPct!.toFixed(0)}% below the high, and the index has been that low in ${r.reachedSharePct!.toFixed(1)}% of sessions on record. It holds ${r.pct.toFixed(0)}% of your pool — Rs ${rs(r.amount)} — against something that essentially does not happen.`
        );
      } else if (r.reach === "thin") {
        diagnostics.push(
          `${rs(r.level)} has been reached in ${r.reachedSharePct!.toFixed(0)}% of sessions. Holding ${r.pct.toFixed(0)}% of the pool there is a long wait for a rare price.`
        );
      }
    }
    if (deadPct + thinPct >= 30) {
      diagnostics.push(
        `${(deadPct + thinPct).toFixed(0)}% of the pool sits behind levels the index has rarely reached. That money is not being patient, it is idle: it earns the fund rate while the market compounds without it. Weight the rungs by how often each level actually turns up, not by how bad the day would feel.`
      );
    }
    if (corePctClamped === 0 && deadPct > 0) {
      diagnostics.push(
        "With no core, this ladder only buys on a fall. In a market that drifts upward that is a standing bet against the drift. Setting a core invests part of the pool regardless of level and leaves the rungs to add on weakness."
      );
    }
  }

  return {
    indexName,
    indexLevel: level,
    indexAsOf,
    poolAtArming: base,
    poolNow: now,
    reservePct: resPct,
    reserveAmount,
    ladderPool,
    rows,
    ready,
    readyAmount,
    next,
    firedCount: firedRows.length,
    firedAmount: firedRows.reduce((s, r) => s + r.firedAmount, 0),
    allocatedPct,
    warnings,
    corePct: corePctClamped,
    coreAmount,
    referenceHigh: refHigh,
    deadPct,
    diagnostics,
  };
}

// Propose a ladder from the record instead of from a blank page.
//
// Each rung is placed at the fall that describes a target share of history, and
// weighted in proportion to that share. So the level you sit at half the time
// carries most of the money and the once-a-decade level carries a little. That
// is the opposite of how a ladder gets written by hand, and it is the whole
// point.
export function suggestLadder(
  dist: FallStat[],
  referenceHigh: number,
  count = 4
): Array<{ level: number; pct: number; label: string; fallPct: number; reachedSharePct: number }> {
  if (!(referenceHigh > 0) || (dist ?? []).length === 0) return [];
  const TARGETS: Record<number, number[]> = {
    2: [50, 22],
    3: [48, 28, 12],
    4: [45, 30, 15, 6],
    5: [50, 35, 22, 12, 5],
  };
  const targets = TARGETS[Math.min(5, Math.max(2, Math.round(count)))] ?? TARGETS[4];

  const raw = targets.map((share) => {
    const fall = fallAtShare(dist, share) ?? 0;
    // Round the level to something a person would actually write down.
    const level = Math.round((referenceHigh * (1 - fall / 100)) / 500) * 500;
    return { share, fall, level };
  });

  const totalShare = raw.reduce((s, r) => s + r.share, 0);
  const pcts = raw.map((r) => Math.round((r.share / totalShare) * 100));
  // Rounding has to land on 100 exactly; the remainder goes to the rung that
  // fires most often, which is where an extra point does the most work.
  const drift = 100 - pcts.reduce((s, p) => s + p, 0);
  pcts[0] += drift;

  return raw.map((r, i) => ({
    level: r.level,
    pct: pcts[i],
    label: `${r.fall.toFixed(0)}% off the high`,
    fallPct: r.fall,
    reachedSharePct: r.share,
  }));
}

// One line for the dashboard. Says what to do, or says wait and how far away
// the next decision is. Never hedges.
export function ladderVerdict(plan: LadderPlan): { action: "DEPLOY" | "WAIT" | "SET_UP"; line: string } {
  if (plan.rows.length === 0) {
    return { action: "SET_UP", line: "No ladder set. Write your levels down before the market writes them for you." };
  }
  if (plan.ready.length > 0 && plan.readyAmount > 0) {
    const names = plan.ready.map((r) => (r.label ? r.label : `${rs(r.level)}`)).join(" and ");
    return {
      action: "DEPLOY",
      line: `${plan.indexName} is ${rs(plan.indexLevel)}. ${names} armed. Deploy Rs ${rs(plan.readyAmount)}.`,
    };
  }
  if (plan.next) {
    const fall = Math.abs(plan.next.moveRequiredPct);
    return {
      action: "WAIT",
      line: `${plan.indexName} is ${rs(plan.indexLevel)}. Next rung ${rs(plan.next.level)}, a ${fall.toFixed(1)}% fall away. Deploy Rs ${rs(plan.next.amount)} then. Until then, nothing.`,
    };
  }
  return {
    action: "WAIT",
    line: `${plan.indexName} is ${rs(plan.indexLevel)}. Every rung has fired. Rs ${rs(plan.reserveAmount)} is reserve and stays put.`,
  };
}
