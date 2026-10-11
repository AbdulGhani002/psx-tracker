// Where to buy the KSE-100 on the way down, from evidence rather than set
// percentages under the high:
//   model    the Model page's buy zone for the next 20 sessions: half of
//            past paths from days like this dipped to its top, a quarter to
//            its bottom (it moves with each close)
//   support  where the index turned up before: closes that stayed the
//            lowest for two weeks either side; the nearest group below, and
//            the next one at least 3% deeper
//   fall     a bad quarter: two of the index's usual three-month moves under
//            today (about one quarter in twenty goes further)
//   value    the level at which stocks earn 3 points more than the 12-month
//            T-bill (the plan's "cheap"), at today's earnings
// Zones never overlap: one inside another merges, one partly inside is cut
// at the other's edge. Levels too far under today to plan for are left out.
// Only DPS closes go in. Pure, so scripts/test-strategy-zones.ts runs it.

export type ZoneKind = "model" | "support" | "fall" | "value";
export type BuyZone = { kind: ZoneKind; low: number; high: number; why: string };
export type Close = { date: string; close: number };

export type ZoneInput = {
  closes: Close[]; // the KSE-100, oldest first
  model: { buyHigh: number; buyLow: number } | null;
  pe: number | null; // the market's P/E
  tbillPct: number | null; // the 12-month T-bill
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
const round = (v: number) => Math.round(v / 50) * 50;

// Closes that were the lowest for `k` sessions either side, over the last
// `lookback` sessions; the last `k` sessions cannot be one yet.
export function pivotLows(closes: Close[], k = 10, lookback = 500): Close[] {
  const out: Close[] = [];
  for (let i = Math.max(k, closes.length - lookback); i < closes.length - k; i++) {
    const c = closes[i].close;
    let low = true;
    for (let j = i - k; j <= i + k && low; j++) if (j !== i && (closes[j].close < c || (closes[j].close === c && j < i))) low = false;
    if (low) out.push(closes[i]);
  }
  return out;
}

// Lows within 2% of each other, as one level with every date it held.
export function supportLevels(lows: Close[]): Array<{ low: number; high: number; dates: string[] }> {
  const sorted = [...lows].sort((a, b) => a.close - b.close);
  const out: Array<{ low: number; high: number; dates: string[] }> = [];
  for (const p of sorted) {
    const g = out[out.length - 1];
    if (g && p.close <= g.low * 1.02) {
      g.high = p.close;
      g.dates.push(p.date);
    } else out.push({ low: p.close, high: p.close, dates: [p.date] });
  }
  return out;
}

// The standard deviation of daily log returns over the last year.
export function dailySigma(closes: Close[], days = 252): number | null {
  const tail = closes.slice(-(days + 1));
  if (tail.length < 61) return null;
  const r: number[] = [];
  for (let i = 1; i < tail.length; i++) if (tail[i].close > 0 && tail[i - 1].close > 0) r.push(Math.log(tail[i].close / tail[i - 1].close));
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  return Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, r.length - 1));
}

export function buyZones(i: ZoneInput): BuyZone[] {
  const last = i.closes[i.closes.length - 1]?.close ?? 0;
  if (!(last > 0)) return [];
  const zones: BuyZone[] = [];
  const m = i.model && i.model.buyHigh > 0 && i.model.buyLow > 0 && i.model.buyHigh < last * 1.001 ? i.model : null;
  if (m) zones.push({ kind: "model", low: Math.min(m.buyLow, m.buyHigh), high: Math.max(m.buyLow, m.buyHigh), why: "Model, next 20 days" });

  // Past lows under the model's zone (or under today), within a third of
  // today (lows from before a long rally are not a plan): the nearest, and
  // the next one at least 3% under it.
  const below = (m ? Math.min(m.buyLow, m.buyHigh) : last) * 0.995;
  const levels = supportLevels(pivotLows(i.closes)).filter((s) => s.high < below && s.low >= last * 0.65).sort((a, b) => b.high - a.high);
  const picked = levels.slice(0, 1);
  const deeper = levels[0] ? levels.find((s) => s.high < levels[0].low * 0.97) : undefined;
  if (deeper) picked.push(deeper);
  for (const s of picked) {
    const months = [...new Set([...s.dates].sort().map(monthOf))].slice(-2);
    zones.push({ kind: "support", low: round(s.low * 0.99), high: round(s.high * 1.01), why: `Past lows, ${months.join(" and ")}` });
  }

  // A bad quarter: two three-month sigmas under today.
  const sd = dailySigma(i.closes);
  if (sd != null && sd > 0) {
    const q = sd * Math.sqrt(63);
    const at = last * Math.exp(-2 * q);
    zones.push({ kind: "fall", low: round(at * Math.exp(-0.25 * q)), high: round(at * Math.exp(0.25 * q)), why: "A bad quarter, 1 in 20" });
  }

  // Cheap against the T-bill: an earnings yield 3 points over it. Left out
  // when that is more than 40% under today: too far to plan for.
  if (i.pe != null && i.pe > 0 && i.tbillPct != null && i.tbillPct > 0) {
    const ey = 100 / i.pe;
    const at = Math.min(last, (last * ey) / (i.tbillPct + 3));
    if (at >= last * 0.6) zones.push({ kind: "value", low: round(at * 0.97), high: round(at), why: at >= last ? "Cheap against T-bills now" : "Cheap against T-bills" });
  }

  return pickZones(zones);
}

// Four at most: past lows are stronger evidence than the bad quarter, so it
// goes first; then the deepest.
export function pickZones(zones: BuyZone[]): BuyZone[] {
  let out = mergeZones(zones);
  if (out.length > 4) out = mergeZones(zones.filter((z) => z.kind !== "fall"));
  return out.slice(0, 4);
}

// Deepest last, none overlapping. A zone mostly inside the one above is that
// zone, for two reasons (while it stays under 6% wide); one partly inside
// starts where the one above ends, and goes into it when that leaves under 1%.
export function mergeZones(zones: BuyZone[]): BuyZone[] {
  const out: BuyZone[] = [];
  for (const z0 of [...zones].sort((a, b) => b.high - a.high)) {
    const z = { ...z0 };
    const prev = out[out.length - 1];
    if (prev && z.high > prev.low) {
      if ((z.low + z.high) / 2 >= prev.low && Math.min(prev.low, z.low) >= prev.high * 0.94) {
        prev.low = Math.min(prev.low, z.low);
        prev.why = `${prev.why} · ${z.why}`;
        continue;
      }
      z.high = prev.low;
      if (z.high - z.low < z.high * 0.01) {
        prev.why = `${prev.why} · ${z.why}`;
        continue;
      }
    }
    out.push(z);
  }
  return out;
}

// The money for each zone: more the deeper it is.
export function zoneWeights(n: number): number[] {
  return n >= 4 ? [0.2, 0.25, 0.25, 0.3] : n === 3 ? [0.25, 0.35, 0.4] : n === 2 ? [0.4, 0.6] : n === 1 ? [1] : [];
}
