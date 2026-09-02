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
};

export type LadderInput = {
  indexName?: string;
  indexLevel: number;
  indexAsOf?: string;
  rungs: LadderRung[];
  poolAtArming: number;
  poolNow: number;
  reservePct?: number;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rs = (v: number) => Math.round(v).toLocaleString("en-PK");

export function planLadder({
  indexName = "KSE-100",
  indexLevel,
  indexAsOf = "",
  rungs,
  poolAtArming,
  poolNow,
  reservePct = 0,
}: LadderInput): LadderPlan {
  const level = num(indexLevel);
  const base = Math.max(0, num(poolAtArming));
  const now = Math.max(0, num(poolNow));
  const resPct = Math.min(100, Math.max(0, num(reservePct)));
  const reserveAmount = (base * resPct) / 100;
  const ladderPool = Math.max(0, base - reserveAmount);

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
    return {
      ...r,
      amount,
      cumulativePct,
      cumulativeAmount,
      poolAfter: Math.max(0, base - cumulativeAmount),
      status,
      moveRequiredPct: level > 0 ? ((r.level - level) / level) * 100 : 0,
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
  };
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
