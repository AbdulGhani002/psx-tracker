// A suggested set of valuation inputs for a share, from what the record says
// (the home machine works these out each evening, scripts/dps-push.ts, and
// hands them over as drafts; nothing is valued until the owner approves one):
//   EPS: the latest year's on today's share count, averaged with its 3-year
//   median when the two are far apart (a one-off is likelier than a new
//   level); a newer annual results filing counts as the latest year, a newer
//   part-year one makes a trailing year;
//   D1: the cash paid over the last year;
//   BVPS: equity from the latest balance sheet (the filing's where newer)
//   over today's shares; ROE from the two;
//   g: the EPS trend, at most 10%; the engine holds it further;
//   the business type from the sector, the policy from the quality grade.
// The owner's own judgements on the version before (governance and its
// confirmation, the type and policy, a sum-of-the-parts, weights, margins,
// a multiple, filing figures) are carried over unchanged. Pure, so
// scripts/test-valuation.ts runs it.

import type { Assumption, BusinessType, Policy } from "./engine";
import type { ResultFigures } from "@/lib/prices/results";
import { epsOnToday, type AnnualRow } from "@/lib/macro/valuation";

export type DraftInput = {
  symbol: string;
  sector: string; // the normalised key (sectorKey)
  grade: string | null; // the quality board's
  thin: boolean;
  annual: AnnualRow[];
  sharesNow: number | null;
  fiscalYearEndMonth: number | null;
  equity: number | null; // rupees
  equityAt: string | null;
  cashDividends: Array<{ date: string; cash: number }>; // rupees a share
  today: string;
  previous: (Partial<Assumption> & { asOf?: string }) | null;
  filing?: (ResultFigures & { date: string; title: string; url: string }) | null;
};

export type Draft = Assumption & { asOf: string; note: string; evidence: Record<string, unknown> };

export function typeOfSector(sector: string): BusinessType {
  const s = sector.toUpperCase();
  if (/COMMERCIAL BANKS/.test(s)) return "bank";
  if (/INSURANCE/.test(s)) return "insurer";
  if (/INV\.? BANKS|INV COS|SECURITIES/.test(s)) return "holdco";
  if (/MODARABA|CLOSE.?END|MUTUAL FUND|LEASING/.test(s)) return "shell";
  return "operating";
}

const median = (v: number[]) => {
  const x = [...v].sort((a, b) => a - b);
  return x.length === 0 ? null : x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const yearBefore = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;

export function draftFrom(i: DraftInput): Draft {
  const p = i.previous ?? {};
  const notes: string[] = [];
  const years = epsOnToday(i.annual, i.sharesNow, i.fiscalYearEndMonth);
  // A newer annual result from a filing counts as the latest year; a newer
  // part year makes a trailing year: the last year, plus this year to date,
  // less the same months a year before.
  const f = i.filing;
  const lastEnd = years.length ? years[years.length - 1].end : null;
  if (f?.period === "year" && f.periodEnd && f.eps != null && (!lastEnd || f.periodEnd > lastEnd)) {
    years.push({ end: f.periodEnd, eps: f.eps });
    notes.push(`Latest year from the filing of ${f.date}.`);
  } else if (f?.period && f.period !== "year" && f.periodEnd && f.eps != null && f.epsPrior != null && lastEnd && f.periodEnd > lastEnd && yearBefore(f.periodEnd) < lastEnd) {
    const last = years[years.length - 1].eps;
    years.push({ end: f.periodEnd, eps: last + f.eps - f.epsPrior });
    notes.push(`Trailing year to ${f.periodEnd}: ${r2(last)} + ${f.eps} − ${f.epsPrior}.`);
  }
  const recent = years.slice(-3).map((y) => y.eps);
  const latest = years.length ? years[years.length - 1].eps : null;
  const mid = recent.length ? median(recent) : null;
  let eps: number | null = latest;
  if (latest != null && mid != null && mid > 0 && (latest <= 0 || Math.abs(latest / mid - 1) > 0.3)) {
    eps = latest > 0 ? (latest + mid) / 2 : mid;
    notes.push(`EPS ${r2(latest)} is far from its 3-year median ${r2(mid)}: averaged.`);
  }
  if (eps != null && eps <= 0) eps = null;

  // The EPS trend: the yearly rate between the first and the last positive
  // years, at most 10%.
  const positive = years.filter((y) => y.eps > 0);
  let g: number | null = null;
  if (positive.length >= 2) {
    const a = positive[0], b = positive[positive.length - 1];
    const span = (Date.parse(b.end) - Date.parse(a.end)) / (365.25 * 86400000);
    if (span >= 1) g = Math.max(0, Math.min(10, (Math.pow(b.eps / a.eps, 1 / span) - 1) * 100));
  }

  const yearAgo = new Date(Date.parse(i.today + "T00:00:00Z") - 365 * 86400000).toISOString().slice(0, 10);
  const paid = i.cashDividends.filter((d) => d.date > yearAgo && d.date <= i.today && d.cash > 0);
  const dps = paid.length ? paid.reduce((s, d) => s + d.cash, 0) : f?.dps ?? null;
  // The filing's own book where it is newer than the one the server holds.
  let equity = i.equity, equityAt = i.equityAt;
  if (f?.equity != null && f.equity > 0 && f.periodEnd && (!equityAt || f.periodEnd > equityAt)) {
    equity = f.equity;
    equityAt = f.periodEnd;
    notes.push(`Book from the filing of ${f.date}.`);
  }
  const bvps = equity != null && equity > 0 && i.sharesNow ? equity / i.sharesNow : null;
  const roe = eps != null && bvps != null && bvps > 0 ? (eps / bvps) * 100 : null;
  if (bvps == null) notes.push("No balance sheet read: P/B and earnings power wait for one.");

  const type = (p.type as BusinessType | undefined) ?? typeOfSector(i.sector);
  const policy = (p.policy as Policy | undefined) ?? (type === "holdco" ? "holdco" : type === "shell" ? "shell" : i.grade === "A" ? "quality" : "standard");
  const lastYear = years.length ? years[years.length - 1].end : null;
  const asOf = [lastYear, f?.periodEnd ?? null, equityAt].filter((x): x is string => !!x).sort().pop() ?? i.today;
  if ((type === "holdco" || type === "shell" || type === "insurer" || type === "opco-investments") && !p.sotp) notes.push("Enter its parts: the value sits in its stakes.");
  if (i.thin) notes.push("Thinly traded: no buy signal unless you untick it.");

  return {
    symbol: i.symbol,
    type,
    policy,
    governance: (p.governance as Assumption["governance"]) ?? "green",
    confirm: p.confirm ?? "",
    eps: eps != null ? r2(eps) : null,
    dps: dps != null ? r2(dps) : null,
    bvps: bvps != null ? r2(bvps) : null,
    roe: roe != null ? r2(roe) : null,
    g: g != null ? r2(g) : null,
    valueGrowth: p.valueGrowth ?? null,
    pe: p.pe ?? null,
    peSpread: p.peSpread ?? (p.pe ? null : 4),
    premium: p.premium ?? null,
    sotp: p.sotp ?? null,
    weights: p.weights ?? null,
    margins: p.margins ?? null,
    illiquid: i.thin,
    metrics: p.metrics ?? null,
    asOf,
    note: notes.join(" "),
    evidence: {
      years: years.map((y) => [y.end, r2(y.eps)]),
      dividends: paid.map((d) => [d.date, d.cash]),
      equity,
      equityAt,
      sharesNow: i.sharesNow,
      grade: i.grade,
      filing: f ? { date: f.date, title: f.title, url: f.url, period: f.period, periodEnd: f.periodEnd, eps: f.eps, epsPrior: f.epsPrior ?? null, profit: f.profit, equity: f.equity ?? null, dps: f.dps, basis: f.basis ?? null, source: f.source ?? "text", checks: f.checks ?? [], readable: f.text } : null,
    },
  };
}

// Whether a draft says anything new against the version it would follow: a
// results filing after it was reviewed, or figures that moved. Its date alone
// is not news (an approved version's date is the day it was reviewed).
const KEYS = ["type", "policy", "eps", "dps", "bvps", "roe", "g", "illiquid"] as const;
export function draftDiffers(draft: Draft, last: Record<string, unknown> | null): boolean {
  if (!last) return true;
  const filed = (draft.evidence?.filing as { date?: string } | null)?.date;
  if (filed && typeof last.asOf === "string" && filed > last.asOf) return true;
  return KEYS.some((k) => {
    const a = (draft as any)[k], b = last[k];
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) > Math.max(0.01, Math.abs(b) * 0.02);
    return (a ?? null) !== (b ?? null);
  });
}

// What a draft suggests, as one string: the same suggestion is never made
// twice, so one the owner rejected does not come back the next evening.
export function draftSignature(d: Draft): string {
  const n = (v: number | null | undefined, k = 2) => (v == null ? null : Number(v.toFixed(k)));
  return JSON.stringify([d.type, d.policy, n(d.eps), n(d.dps), n(d.bvps), n(d.roe, 1), n(d.g, 1), !!d.illiquid, (d.evidence?.filing as { url?: string } | null)?.url ?? null]);
}
