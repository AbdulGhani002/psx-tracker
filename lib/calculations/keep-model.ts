// The keep-percent sell model: "I want to keep K% of this position — how many
// shares do I sell to end up nearest that?" PSX trades whole shares, so the
// exact percentage is usually unreachable. This returns the whole-share sell
// quantity whose resulting keep-percentage lands closest to the target, plus
// the percentage actually achieved — shown, never silently substituted.
// A dead-even tie between the two neighbouring quantities goes to selling
// FEWER shares: when the arithmetic is indifferent, stay invested.
// Pure arithmetic, no I/O. Invalid input returns null — never a guessed 0.

export type KeepPlan = {
  targetKeepPct: number; // the requested target, clamped into [0, 100]
  sellShares: number; // whole shares to sell, 0..floor(totalShares)
  keepShares: number; // what remains (fractional only if the holding itself is)
  actualKeepPct: number; // keepShares / totalShares × 100 — what you really keep
};

export function planKeepPct(totalShares: number, targetKeepPct: number): KeepPlan | null {
  if (!Number.isFinite(totalShares) || totalShares <= 0) return null;
  if (!Number.isFinite(targetKeepPct)) return null;
  const target = Math.min(100, Math.max(0, targetKeepPct));
  const maxSell = Math.floor(totalShares); // a fractional tail can't be sold on PSX
  const ideal = totalShares * (1 - target / 100);
  const candidates = Array.from(
    new Set([Math.floor(ideal), Math.ceil(ideal)].map((s) => Math.min(maxSell, Math.max(0, s))))
  ).sort((a, b) => a - b); // ascending, so on a tie the smaller sell wins below
  let best: KeepPlan | null = null;
  let bestMiss = Infinity;
  for (const sellShares of candidates) {
    const keepShares = totalShares - sellShares;
    const actualKeepPct = (keepShares / totalShares) * 100;
    const miss = Math.abs(actualKeepPct - target);
    if (miss < bestMiss - 1e-12) {
      best = { targetKeepPct: target, sellShares, keepShares, actualKeepPct };
      bestMiss = miss;
    }
  }
  return best;
}
