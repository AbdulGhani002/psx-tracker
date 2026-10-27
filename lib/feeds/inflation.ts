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

// PBS moved its site in October 2026 and the SDMX feed above is gone. Mettis
// Global's CPI chart carries the year-on-year rate for the last months
// ("Sep 30", 10.3), oldest first and with no year: the last row is the latest
// month out, before this one, and each row before it a month earlier. A month
// after the kept index is extended from the index a year before it. Months
// both have must agree (to rounding), or it is not the same series and
// nothing is added.
const METTIS_CPI_URL = "https://mettisglobal.news/Home/CPIChart";
const MONTHS3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function extendCpi(history: CpiPoint[], rows: Array<{ Value?: unknown; Date?: unknown }>, today: string): CpiPoint[] | null {
  const named = rows.map((r) => ({ m: MONTHS3.indexOf(String(r.Date ?? "").trim().slice(0, 3).toLowerCase()) + 1, v: Number(r.Value) }));
  if (named.length === 0 || named.some((r) => r.m < 1 || !Number.isFinite(r.v))) return null;
  const [y, mo] = today.slice(0, 7).split("-").map(Number);
  const last = named[named.length - 1].m;
  let period = `${last < mo ? y : y - 1}-${String(last).padStart(2, "0")}`;
  const dated: Array<{ period: string; yoy: number }> = [];
  for (let k = named.length - 1; k >= 0; k--) {
    if (Number(period.slice(5)) !== named[k].m) return null;
    dated.unshift({ period, yoy: named[k].v });
    period = shiftMonths(period, -1);
  }
  const index = new Map(history.map((p) => [p.period, p.index]));
  const both = dated.filter((d) => index.has(d.period) && index.has(shiftMonths(d.period, -12)));
  if (both.length === 0 || both.some((d) => Math.abs((index.get(d.period)! / index.get(shiftMonths(d.period, -12))! - 1) * 100 - d.yoy) > 0.15)) return null;
  const out = [...history];
  for (const d of dated) {
    if (index.has(d.period)) continue;
    const base = index.get(shiftMonths(d.period, -12));
    if (!base) continue;
    const v = base * (1 + d.yoy / 100);
    index.set(d.period, v);
    out.push({ period: d.period, index: v });
  }
  return out.length > history.length ? out : null;
}

export async function fetchMettisCpi(prev: InflationData | null, today: string): Promise<InflationData | null> {
  if (!prev?.history?.length) return null;
  try {
    const res = await fetch(METTIS_CPI_URL, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; psx-tracker/0.1)", accept: "application/json,text/plain,*/*" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const rows = JSON.parse(await res.text());
    const history = extendCpi(prev.history, Array.isArray(rows) ? rows : [], today);
    if (!history) return null;
    const latest = history[history.length - 1];
    const yearAgo = history.find((p) => p.period === shiftMonths(latest.period, -12)) ?? null;
    const yoy = yearAgo ? (latest.index / yearAgo.index - 1) * 100 : null;
    if (yoy == null || !(yoy > YOY_MIN && yoy < YOY_MAX)) return null;
    return { ...prev, history, latest, yearAgo, yoyPct: yoy, fetchedAt: new Date().toISOString(), sourceUrl: METTIS_CPI_URL };
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
