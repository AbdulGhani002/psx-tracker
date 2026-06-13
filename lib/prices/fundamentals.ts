// Company fundamentals scraped from the PSX data portal company page.
//
// dps.psx.com.pk/company/SYMBOL renders a "Financials" table server-side
// (powered by Capital Stake) with Profit-after-Taxation and EPS per fiscal
// year (annual) and per quarter. We parse the Annual table to anchor the
// dividend model in earnings: a company can only sustainably pay out a fraction
// of what it earns. All values are "as reported / standardized" by the source.

const PSX_URL = (sym: string) => `https://dps.psx.com.pk/company/${encodeURIComponent(sym)}`;
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";

export type AnnualFinancial = {
  fiscalYear: number; // the calendar year the fiscal year ends (PSX column header)
  eps: number | null; // rupees per share
  profitAfterTax: number | null; // in thousands of rupees, as PSX reports
};

export type CompanyFundamentals = {
  symbol: string;
  faceValue: number; // par value; PSX standard is Rs 10
  annual: AnnualFinancial[]; // newest first
  latestEps: number | null; // most recent annual EPS
  epsGrowthPct: number | null; // latest vs prior annual EPS, in %
  fetchedAt: string; // ISO
  source: string;
};

// "(972,361)" -> -972361 ; "5.64" -> 5.64 ; "" / "-" -> null
function parseNum(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = raw.replace(/,/g, "").trim();
  if (!s || s === "-" || s === "—") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// Pull the row whose first <td> label matches `label`, returning the inner text
// of each subsequent cell's <span> (or the <td> itself), in column order.
function extractRow(panelHtml: string, label: string): string[] {
  const re = new RegExp(`<td[^>]*>\\s*${label}\\s*</td>(.*?)</tr>`, "is");
  const m = panelHtml.match(re);
  if (!m) return [];
  const cells = m[1].match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
  return cells.map((c) => {
    const span = c.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
    const inner = span ? span[1] : c.replace(/<[^>]+>/g, "");
    return inner.replace(/<[^>]+>/g, "").trim();
  });
}

export function parseFinancials(html: string, symbol: string): CompanyFundamentals | null {
  // Isolate the Annual panel (not the tab button — the actual tabs__panel).
  const panelStart = html.search(/class="tabs__panel"\s+data-name="Annual"/i);
  if (panelStart < 0) return null;
  const rest = html.slice(panelStart);
  const nextPanel = rest.search(/class="tabs__panel"\s+data-name="Quarterly"/i);
  const panel = nextPanel > 0 ? rest.slice(0, nextPanel) : rest.slice(0, 4000);

  // Year columns from the header row.
  const head = panel.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? panel;
  const years = (head.match(/<th[^>]*>\s*(\d{4})\s*<\/th>/gi) ?? [])
    .map((th) => Number(th.replace(/<[^>]+>/g, "").trim()))
    .filter((y) => y > 1990 && y < 2100);
  if (years.length === 0) return null;

  const epsCells = extractRow(panel, "EPS").map(parseNum);
  const profitCells = extractRow(panel, "Profit after Taxation").map(parseNum);

  const annual: AnnualFinancial[] = years.map((fiscalYear, i) => ({
    fiscalYear,
    eps: epsCells[i] ?? null,
    profitAfterTax: profitCells[i] ?? null,
  }));

  const latestEps = annual[0]?.eps ?? null;
  const priorEps = annual[1]?.eps ?? null;
  const epsGrowthPct =
    latestEps != null && priorEps != null && priorEps !== 0
      ? ((latestEps - priorEps) / Math.abs(priorEps)) * 100
      : null;

  return {
    symbol: symbol.toUpperCase(),
    faceValue: 10,
    annual,
    latestEps,
    epsGrowthPct,
    fetchedAt: new Date().toISOString(),
    source: "psx-dps",
  };
}

export async function fetchFundamentals(symbol: string): Promise<CompanyFundamentals | null> {
  try {
    const res = await fetch(PSX_URL(symbol.toUpperCase()), {
      headers: { "user-agent": UA, accept: "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parseFinancials(html, symbol);
  } catch {
    return null;
  }
}
