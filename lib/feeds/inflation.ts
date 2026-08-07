// Pakistan CPI inflation, straight from the Pakistan Bureau of Statistics.
//
// Source: https://www.pbs.gov.pk/cpi
// PBS publishes an SDMX 2.1 feed (the IMF ECOFIN data structure) — proper
// machine-readable statistics, not a PDF. It carries the headline national CPI
// index (INDICATOR="PCPI_IX", monthly, base 2015/2016) plus the COICOP group
// sub-indices (food, housing, transport, ...).
//
// We do NOT read a published "inflation rate" anywhere: PBS gives an INDEX, and
// we compute year-on-year ourselves from index(t) vs index(t-12). That is the
// same arithmetic PBS/SBP use, and it means the number is derived from official
// data rather than transcribed by hand and left to rot. (The app previously
// defaulted inflation to 0 and the income planner hardcoded 10.)
//
// Everything is null-on-failure: no CPI is honest, a guessed CPI is not.

const PBS_CPI_URL = "https://www.pbs.gov.pk/cpi";

// Pakistan's YoY CPI has ranged from roughly 2% to 38% in living memory. A value
// outside this band means we parsed the wrong series (the feed also carries
// weights and sub-indices), so we refuse it rather than publish it.
const YOY_MIN = -10;
const YOY_MAX = 60;

export type CpiPoint = { period: string; index: number };

export type InflationData = {
  yoyPct: number | null; // headline CPI inflation, year on year
  latest: CpiPoint | null; // most recent monthly index
  yearAgo: CpiPoint | null; // the index 12 months earlier (the comparison base)
  basePeriod: string; // e.g. "2015/2016" — the index's own base
  history: CpiPoint[]; // full monthly index series, ascending
  fetchedAt: string;
  sourceUrl: string;
};

const EMPTY: Omit<InflationData, "fetchedAt" | "sourceUrl"> = {
  yoyPct: null,
  latest: null,
  yearAgo: null,
  basePeriod: "",
  history: [],
};

// Pull one SDMX series out by INDICATOR code, with its observations.
function seriesFor(xml: string, indicator: string): { attrs: string; points: CpiPoint[] } | null {
  // Split on Series start tags (namespace prefix varies by producer).
  const blocks = xml.split(/<(?=\w*:?Series\b)/);
  for (const b of blocks) {
    const head = /^\w*:?Series\b([^>]*)>/.exec(b);
    if (!head) continue;
    const attrs = head[1];
    const ind = /INDICATOR="([^"]+)"/.exec(attrs);
    if (!ind || ind[1] !== indicator) continue;
    const points: CpiPoint[] = [];
    const re = /TIME_PERIOD="([^"]+)"\s+OBS_VALUE="([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b))) {
      const v = Number(m[2]);
      if (Number.isFinite(v) && v > 0) points.push({ period: m[1], index: v });
    }
    points.sort((a, b2) => a.period.localeCompare(b2.period));
    return { attrs, points };
  }
  return null;
}

export function parseCpiSdmx(xml: string): Omit<InflationData, "fetchedAt" | "sourceUrl"> {
  // PCPI_IX = headline national Consumer Price Index, all items.
  const s = seriesFor(xml, "PCPI_IX");
  if (!s || s.points.length < 13) return { ...EMPTY };

  const base = /BASE_PER="([^"]+)"/.exec(s.attrs)?.[1] ?? "";
  const points = s.points;
  const latest = points[points.length - 1];
  // Same calendar month one year earlier — YoY must compare like months, because
  // CPI is seasonal (food especially). The series is monthly and contiguous, so
  // that is 12 observations back; verify by label rather than trusting position.
  const wantPeriod = shiftMonths(latest.period, -12);
  const yearAgo = points.find((p) => p.period === wantPeriod) ?? null;
  if (!yearAgo) return { ...EMPTY, basePeriod: base, history: points, latest };

  const yoy = (latest.index / yearAgo.index - 1) * 100;
  const ok = Number.isFinite(yoy) && yoy > YOY_MIN && yoy < YOY_MAX;

  return {
    yoyPct: ok ? yoy : null,
    latest,
    yearAgo,
    basePeriod: base,
    history: points,
  };
}

// "2026-06" minus 12 months -> "2025-06"
export function shiftMonths(period: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return "";
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  return `${y}-${String(mo).padStart(2, "0")}`;
}

export async function fetchInflation(): Promise<InflationData | null> {
  try {
    const res = await fetch(PBS_CPI_URL, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/xml,text/xml,*/*" },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const parsed = parseCpiSdmx(await res.text());
    if (parsed.yoyPct == null) return null; // no rate we trust → say nothing
    return { ...parsed, fetchedAt: new Date().toISOString(), sourceUrl: PBS_CPI_URL };
  } catch {
    return null;
  }
}

// Real (inflation-adjusted) return, done properly. The lazy `nominal - inflation`
// overstates the real return whenever inflation is high — and Pakistan's is.
// Fisher: (1+nominal)/(1+inflation) - 1.
export function realReturnPct(nominalPct: number, inflationPct: number): number {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}
