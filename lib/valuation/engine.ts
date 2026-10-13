// Fair value and buy zones from a share's approved assumptions. The arithmetic
// is mechanical and lives here; the inputs (normalised earnings, ROE, growth,
// multiples, discounts, governance) are judgements, kept as versioned
// assumptions the owner approves (lib/models/ValuationAssumption.ts).
//
//   The hurdle: r = the 12-month T-bill + an equity premium (3.5 points for a
//   quality name, 4.5 for the rest), so every zone moves when rates move.
//   Growth is held to ROE x retention and to 4 points under r.
//   At least three methods, matched to the business:
//     dividend discount   D1 / (r - g)
//     justified P/B       BVPS x (ROE - g) / (r - g)
//     earnings power      EPS x (1 - g/ROE) / (r - g)
//     P/E                 EPS x multiple, or EPS / (r - spread) to move with rates
//     sum of the parts    [sum of parts x (1 - haircut) - net debt] x (1 - discount) / shares
//   Zones: accumulate and strong at the policy's two margins of safety under
//   fair value, trim at a multiple of it.
//   Expected return = cash yield + per-share value growth + re-rating (the
//   gap to fair value closing over three years; a holding company's only to
//   a 40% discount to its NAV).
//   Gates: red governance gets no buy signal at any price, amber only after
//   its confirmation event, a thesis older than the latest filing is stale,
//   a thin share is watched, not zoned.
// Pure, so scripts/test-valuation.ts runs it.

export type BusinessType = "bank" | "insurer" | "operating" | "opco-investments" | "holdco" | "shell";
export type Policy = "quality" | "standard" | "holdco" | "shell";
export type Governance = "green" | "amber" | "red";
export type Method = "ddm" | "pb" | "ep" | "pe" | "sotp";
export const METHODS: Method[] = ["ddm", "pb", "ep", "pe", "sotp"];

export type SotpPart = {
  label: string;
  kind: "listed" | "unlisted" | "operating" | "cash";
  symbol?: string; // listed: marked at its close each day
  shares?: number; // listed: shares held
  value?: number; // the rest: rupees
  haircut?: number; // 0 to 1
};
export type Sotp = { parts: SotpPart[]; netDebt: number; discount: number; shares: number };

export type Assumption = {
  symbol: string;
  type: BusinessType;
  policy: Policy;
  governance: Governance;
  confirm?: string; // amber: the event awaited
  eps: number | null; // next year's, normalised
  dps: number | null; // next year's dividend, D1
  bvps: number | null; // ex revaluation surplus, or marked to market
  roe: number | null; // %, sustainable and economic
  g: number | null; // %
  valueGrowth?: number | null; // %, per-share value growth for the expected return; g by default
  pe?: number | null; // a multiple
  peSpread?: number | null; // points: P/E = 1 / (r - spread)
  premium?: number | null; // points over the T-bill
  sotp?: Sotp | null;
  weights?: Partial<Record<Method, number>> | null;
  margins?: { first?: number; second?: number; trim?: number } | null;
  illiquid?: boolean;
  metrics?: Record<string, number> | null; // a filing's own figures for triggers (combined ratio, ...)
};

export const PREMIUM: Record<Policy, number> = { quality: 3.5, standard: 4.5, holdco: 4.5, shell: 4.5 };
export const MARGINS: Record<Policy, { first: number; second: number; trim: number }> = {
  quality: { first: 0, second: 0.08, trim: 1.35 },
  standard: { first: 0.12, second: 0.2, trim: 1.2 },
  holdco: { first: 0.48, second: 0.55, trim: 0.75 },
  shell: { first: 0.55, second: 0.6, trim: 0.75 },
};
export const WEIGHTS: Record<BusinessType, Partial<Record<Method, number>>> = {
  bank: { ddm: 1, pb: 1, ep: 1 },
  insurer: { pe: 1, pb: 1, sotp: 1 },
  "opco-investments": { sotp: 0.4, pe: 0.4, pb: 0.2 },
  holdco: { sotp: 1 },
  shell: { sotp: 1 },
  operating: { ddm: 1, ep: 1, pe: 1 },
};
export const MIN_SPREAD = 4; // r - g, points
export const NAV_DISCOUNT_FLOOR = 0.4; // a holding company re-rates to this discount at most
const REVERSION_YEARS = 3;

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const pos = (v: number | null | undefined): v is number => ok(v) && v > 0;

export function hurdle(tbillPct: number, a: Pick<Assumption, "policy" | "premium">): number {
  return tbillPct + (ok(a.premium) ? a.premium : PREMIUM[a.policy]);
}

// Growth, held to ROE x retention and to 4 points under r.
export function cappedGrowth(a: Pick<Assumption, "g" | "roe" | "eps" | "dps">, r: number): number {
  const caps = [ok(a.g) ? a.g : 0, r - MIN_SPREAD];
  if (ok(a.roe) && pos(a.eps) && ok(a.dps)) caps.push(a.roe * Math.max(0, 1 - a.dps / a.eps));
  return Math.min(...caps);
}

// The parts at their marks: a listed stake at its close, the rest as entered.
export function sotpValue(s: Sotp, prices: Map<string, number>): number | null {
  if (!pos(s.shares)) return null;
  let total = 0;
  for (const p of s.parts) {
    let v: number;
    if (p.kind === "listed") {
      const px = p.symbol ? prices.get(p.symbol) : undefined;
      if (!pos(px) || !pos(p.shares)) return null;
      v = px * p.shares;
    } else v = ok(p.value) ? p.value : 0;
    total += v * (1 - Math.min(1, Math.max(0, p.haircut ?? 0)));
  }
  const per = ((total - (s.netDebt || 0)) * (1 - Math.min(1, Math.max(0, s.discount || 0)))) / s.shares;
  return per > 0 ? per : null;
}

export function methodValues(a: Assumption, r: number, g: number, prices: Map<string, number>): Record<Method, number | null> {
  const rg = r - g;
  const keep = (v: number) => (Number.isFinite(v) && v > 0 ? v : null);
  return {
    ddm: pos(a.dps) && rg > 0 ? keep(a.dps / (rg / 100)) : null,
    pb: pos(a.bvps) && ok(a.roe) && rg > 0 ? keep((a.bvps * (a.roe - g)) / rg) : null,
    ep: pos(a.eps) && pos(a.roe) && rg > 0 ? keep((a.eps * (1 - g / a.roe)) / (rg / 100)) : null,
    pe: pos(a.eps) ? (pos(a.pe) ? keep(a.eps * a.pe) : ok(a.peSpread) && r - a.peSpread > 0 ? keep(a.eps / ((r - a.peSpread) / 100)) : null) : null,
    sotp: a.sotp ? sotpValue(a.sotp, prices) : null,
  };
}

// The weighted mean of the methods that gave a value, weights rescaled over
// them.
export function blend(values: Record<Method, number | null>, weights: Partial<Record<Method, number>>): number | null {
  let sw = 0, sv = 0;
  for (const m of METHODS) {
    const w = weights[m] ?? 0;
    const v = values[m];
    if (w > 0 && v != null) {
      sw += w;
      sv += w * v;
    }
  }
  return sw > 0 ? sv / sw : null;
}

export function roundLevel(v: number): number {
  return v >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
}

export function fairValueAt(a: Assumption, r: number, prices: Map<string, number>): { g: number; values: Record<Method, number | null>; fair: number | null } {
  const g = cappedGrowth(a, r);
  const values = methodValues(a, r, g, prices);
  return { g, values, fair: blend(values, { ...WEIGHTS[a.type], ...(a.weights ?? {}) }) };
}

export type Signal = "STRONG" | "ACCUMULATE" | "CONFIRM" | "WAIT" | "HOLD" | "TRIM" | "AVOID" | "STALE" | "WATCH" | "NO VALUE";

export type Valuation = {
  symbol: string;
  price: number;
  tbillPct: number;
  r: number;
  g: number;
  values: Record<Method, number | null>;
  weights: Partial<Record<Method, number>>;
  fairValue: number | null;
  band: [number, number] | null; // at r + 1 and r - 1
  zones: { accumulate: number; strong: number; trim: number } | null;
  expected: { yield: number; growth: number; rerate: number; total: number; atZone: number | null } | null;
  excess: number | null; // expected return less the hurdle, points
  signal: Signal;
  gates: { governance: Governance; stale: boolean; illiquid: boolean; zoneClears: boolean | null };
  notes: string[];
};

// What a share returns a year from a price: the cash yield, the value growth,
// and the gap to the target closing over three years.
export function expectedReturn(a: Assumption, fair: number, price: number, g: number): { yield: number; growth: number; rerate: number; total: number } {
  const y = pos(a.dps) && price > 0 ? (a.dps / price) * 100 : 0;
  const growth = ok(a.valueGrowth) ? a.valueGrowth : g;
  const nav = a.type === "holdco" || a.type === "shell";
  const target = nav ? fair * (1 - NAV_DISCOUNT_FLOOR) : fair;
  let rerate = price > 0 && target > 0 ? (Math.pow(target / price, 1 / REVERSION_YEARS) - 1) * 100 : 0;
  if (nav && rerate < 0) rerate = 0;
  return { yield: y, growth, rerate, total: y + growth + rerate };
}

export function value(a: Assumption, o: { price: number; tbillPct: number; held: boolean; stale: boolean; prices: Map<string, number> }): Valuation {
  const r = hurdle(o.tbillPct, a);
  const { g, values, fair } = fairValueAt(a, r, o.prices);
  const weights = { ...WEIGHTS[a.type], ...(a.weights ?? {}) };
  const notes: string[] = [];
  const gates = { governance: a.governance, stale: o.stale, illiquid: !!a.illiquid, zoneClears: null as boolean | null };
  const base = { symbol: a.symbol, price: o.price, tbillPct: o.tbillPct, r, g, values, weights, gates, notes };
  if (fair == null) return { ...base, fairValue: null, band: null, zones: null, expected: null, excess: null, signal: "NO VALUE" };

  const lo = fairValueAt(a, r + 1, o.prices).fair;
  const hi = fairValueAt(a, r - 1, o.prices).fair;
  const m = { ...MARGINS[a.policy], ...(a.margins ?? {}) };
  const zones = { accumulate: roundLevel(fair * (1 - m.first)), strong: roundLevel(fair * (1 - m.second)), trim: roundLevel(fair * m.trim) };
  const er = expectedReturn(a, fair, o.price, g);
  const atZone = expectedReturn(a, fair, zones.accumulate, g).total;
  gates.zoneClears = atZone >= r;
  if (!gates.zoneClears) notes.push(`At ${zones.accumulate} it returns ${atZone.toFixed(1)}%, under the ${r.toFixed(1)}% hurdle.`);

  // When the methods disagree, that is information.
  const used = METHODS.filter((k) => (weights[k] ?? 0) > 0 && values[k] != null).map((k) => [k, values[k]!] as const);
  if (used.length >= 2) {
    const vs = used.map(([, v]) => v);
    const top = Math.max(...vs), bottom = Math.min(...vs);
    if (top > bottom * 1.4) notes.push(`The methods disagree: ${used.map(([k, v]) => `${k.toUpperCase()} ${roundLevel(v)}`).join(", ")}.`);
  }

  let signal: Signal;
  if (a.governance === "red") signal = "AVOID";
  else if (a.illiquid) signal = "WATCH";
  else if (o.price <= zones.accumulate) signal = a.governance === "amber" ? "CONFIRM" : o.price <= zones.strong ? "STRONG" : "ACCUMULATE";
  else if (o.price >= zones.trim) signal = o.held ? "TRIM" : "WAIT";
  else signal = o.held ? "HOLD" : "WAIT";
  // A thesis older than the latest filing gives no buy signal until reviewed.
  if (o.stale && (signal === "STRONG" || signal === "ACCUMULATE" || signal === "CONFIRM")) signal = "STALE";

  return {
    ...base,
    fairValue: fair,
    band: lo != null && hi != null ? [lo, hi] : null,
    zones,
    expected: { ...er, atZone },
    excess: er.total - r,
    signal,
  };
}

const ORDER: Record<Signal, number> = { STRONG: 0, ACCUMULATE: 1, CONFIRM: 2, STALE: 3, TRIM: 4, HOLD: 5, WAIT: 6, WATCH: 7, AVOID: 8, "NO VALUE": 9 };

// The watchlist in order: the signal first, then the expected return over the
// hurdle.
export function rank(vs: Valuation[]): Valuation[] {
  return [...vs].sort((a, b) => ORDER[a.signal] - ORDER[b.signal] || (b.excess ?? -1e9) - (a.excess ?? -1e9));
}

export function signalChanges(prev: Map<string, Signal>, next: Valuation[]): Array<{ symbol: string; from: Signal; to: Signal }> {
  return next.filter((v) => prev.has(v.symbol) && prev.get(v.symbol) !== v.signal).map((v) => ({ symbol: v.symbol, from: prev.get(v.symbol)!, to: v.signal }));
}

// --- triggers ------------------------------------------------------------------
export type TriggerOp = ">=" | "<=" | ">" | "<";
export type Trigger = { id: string; symbol: string; metric: string; op: TriggerOp; threshold: number; action: "trim" | "exit" | "buy" | "review"; note?: string };

// The figures a trigger can test: price, P/E, P/B, the dividend yield, the
// expected return over the hurdle, the discount to fair value, and any figure
// the assumption carries from a filing.
export function metricsOf(a: Assumption, v: Valuation): Record<string, number | null> {
  const p = v.price;
  return {
    price: p,
    pe: pos(a.eps) ? p / a.eps : null,
    pb: pos(a.bvps) ? p / a.bvps : null,
    yield: pos(a.dps) && p > 0 ? (a.dps / p) * 100 : null,
    excess: v.excess,
    discount: v.fairValue ? (1 - p / v.fairValue) * 100 : null,
    ...(a.metrics ?? {}),
  };
}

export function firedTriggers(triggers: Trigger[], metrics: Record<string, number | null>): Trigger[] {
  return triggers.filter((t) => {
    const x = metrics[t.metric];
    if (x == null || !Number.isFinite(x)) return false;
    return t.op === ">=" ? x >= t.threshold : t.op === "<=" ? x <= t.threshold : t.op === ">" ? x > t.threshold : x < t.threshold;
  });
}
