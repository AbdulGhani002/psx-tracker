// SBP (State Bank of Pakistan) policy-rate history as a step function.
//
// There is no clean free API for the policy rate, so this is a curated table.
// The rate changes only at MPC meetings (roughly every 6 weeks), so this is
// low-maintenance: when SBP announces a change, prepend a new entry.
//
// Source to update from: https://www.sbp.org.pk/m_policy/index.asp (Monetary
// Policy Decisions). Entries are { from: ISO date the rate became effective,
// rate: annualised policy rate in percent }.
//
// NOTE: values from mid-2025 onward in a forward-dated environment are
// illustrative placeholders — update them against real SBP announcements.

export type RateStep = { from: string; rate: number };

export const SBP_POLICY_RATE: RateStep[] = [
  { from: "2026-03-09", rate: 10.5 }, // illustrative
  { from: "2025-12-15", rate: 11.0 }, // illustrative
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
export function policyRateOn(isoDate: string): number {
  for (const step of SBP_POLICY_RATE) {
    if (step.from <= isoDate) return step.rate;
  }
  // Older than our table — use the earliest known rate.
  return SBP_POLICY_RATE[SBP_POLICY_RATE.length - 1].rate;
}

// Build a "risk-free" index over a list of ascending ISO dates, starting at
// `base` (default 100) and compounding daily at the policy rate in force.
// Daily growth factor for an annual rate r% = (1 + r/100)^(1/365).
export function riskFreeIndex(dates: string[], base = 100): number[] {
  const out: number[] = [];
  let value = base;
  let prev: string | null = null;
  for (const d of dates) {
    if (prev) {
      const days = daysBetween(prev, d);
      const annual = policyRateOn(prev) / 100;
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
