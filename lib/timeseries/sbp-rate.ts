// SBP (State Bank of Pakistan) policy-rate history as a step function.
//
// This table is HISTORY ONLY — every entry is a real, past MPC decision. The
// CURRENT rate is never hardcoded here: it is fetched live from SBP by
// `lib/feeds/sbp.ts` and prepended to this list by `getSbpRateSteps()`.
// The user can still override the whole curve from Settings (SbpRate
// collection); when the DB has entries, those win.
//
// NEVER add a future-dated or guessed entry to this table. It previously held
// two steps commented "illustrative"; their dates passed, so a placeholder
// became the live rate and silently drove required return, intrinsic value and
// buy-zone alerts. (The placeholder 10.5 was in fact SBP's corridor FLOOR, not
// the policy rate, which was 11.5.) If the live feed is down we fall back to the
// newest real step below and label it stale — we do not invent a number.
//
// Source of truth: https://www.sbp.org.pk/ecodata/rates/tbill/tbill.asp

export type RateStep = { from: string; rate: number };

export const SBP_POLICY_RATE_DEFAULTS: RateStep[] = [
  { from: "2025-05-05", rate: 11.0 },
  { from: "2025-01-27", rate: 12.0 },
  { from: "2024-12-16", rate: 13.0 },
  { from: "2024-11-04", rate: 15.0 },
  { from: "2024-09-12", rate: 17.5 },
  { from: "2024-07-29", rate: 19.5 },
  { from: "2024-06-10", rate: 20.5 },
  { from: "2023-06-26", rate: 22.0 },
];

// Most recent rate effective on or before the given ISO date.
// `steps` may be in any order; we copy + sort descending so callers don't have to.
export function policyRateOn(isoDate: string, steps: RateStep[] = SBP_POLICY_RATE_DEFAULTS): number {
  const sorted = [...steps].sort((a, b) => b.from.localeCompare(a.from));
  for (const step of sorted) {
    if (step.from <= isoDate) return step.rate;
  }
  return sorted.length > 0 ? sorted[sorted.length - 1].rate : 0;
}

// Build a "risk-free" index over ascending ISO dates, starting at `base`
// (default 100) and compounding daily at the policy rate in force.
// Daily growth factor for an annual rate r% = (1 + r/100)^(1/365).
export function riskFreeIndex(
  dates: string[],
  steps: RateStep[] = SBP_POLICY_RATE_DEFAULTS,
  base = 100
): number[] {
  const out: number[] = [];
  let value = base;
  let prev: string | null = null;
  for (const d of dates) {
    if (prev) {
      const days = daysBetween(prev, d);
      const annual = policyRateOn(prev, steps) / 100;
      const dailyFactor = Math.pow(1 + annual, 1 / 365);
      value *= Math.pow(dailyFactor, Math.max(0, days));
    }
    out.push(value);
    prev = d;
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
