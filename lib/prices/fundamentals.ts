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
  netMarginPct: number | null; // net profit margin %
  revenue: number | null; // sales / total income (thousands), as PSX reports
  grossMarginPct?: number | null; // gross profit margin %, where the portal gives one
};

export type CompanyFundamentals = {
  symbol: string;
  faceValue: number; // par value; PSX standard is Rs 10
  sector: string; // PSX sector name
  annual: AnnualFinancial[]; // newest first
  latestEps: number | null; // most recent annual EPS
  epsGrowthPct: number | null; // latest vs prior annual EPS, in %
  // Richer fundamentals (for better, sector-aware valuation + display):
  latestNetMarginPct: number | null; // newest net profit margin
  marginTrendPct: number | null; // newest − prior margin (pp); +ve = improving
  revenueGrowthPct: number | null; // newest vs prior revenue, %
  peTtm: number | null; // PSX's reported trailing P/E
  pegTtm: number | null; // PSX's reported PEG
  sharesOutstanding: number | null; // PSX "Shares" stat
  marketCapThousands: number | null; // PSX "Market Cap (000's)"
  fiscalYearEndMonth: number | null; // 1..12, from the company profile ("Fiscal Year End June")
  fetchedAt: string; // ISO
  source: string;
};

// Pull a single PSX header "stat": <div class="stats_label">LABEL ...</div>
// <div class="stats_value">VALUE</div>.
function parseStat(html: string, label: string): number | null {
  const re = new RegExp(`stats_label">\\s*${label}[^<]*</div>\\s*<div class="stats_value">([^<]+)</div>`, "i");
  return parseNum(html.match(re)?.[1] ?? null);
}

function parseSector(html: string): string {
  const m = html.match(/class="quote__sector"[^>]*>\s*<span[^>]*>([^<]+)<|class="quote__sector"[^>]*>([^<]+)</i);
  const raw = (m?.[1] ?? m?.[2] ?? "").trim();
  if (!raw) return "";
  // Title Case (lowercase first so all-caps PSX strings normalise consistently).
  const s = raw.replace(/&amp;/gi, "&").replace(/\s+/g, " ").toLowerCase();
  return s.replace(/(^|\s|-|\/|&)([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

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
  const marginCells = extractRow(panel, "Net Profit Margin \\(%\\)").map(parseNum);
  const grossCells = extractRow(panel, "Gross Profit Margin \\(%\\)").map(parseNum);
  // Revenue is labelled differently by sector: Sales for manufacturers, Total
  // Income / Mark-up Earned for banks. Use whichever row exists.
  const revLabels = ["Sales", "Net Sales", "Total Income", "Mark-up Earned", "Revenue"];
  let revCells: (number | null)[] = [];
  for (const lbl of revLabels) {
    const cells = extractRow(panel, lbl).map(parseNum);
    if (cells.some((c) => c != null)) {
      revCells = cells;
      break;
    }
  }

  const annual: AnnualFinancial[] = years.map((fiscalYear, i) => ({
    fiscalYear,
    eps: epsCells[i] ?? null,
    profitAfterTax: profitCells[i] ?? null,
    netMarginPct: marginCells[i] ?? null,
    revenue: revCells[i] ?? null,
    grossMarginPct: grossCells[i] ?? null,
  }));

  const latestEps = annual[0]?.eps ?? null;
  const priorEps = annual[1]?.eps ?? null;
  const epsGrowthPct =
    latestEps != null && priorEps != null && priorEps !== 0
      ? ((latestEps - priorEps) / Math.abs(priorEps)) * 100
      : null;

  const latestNetMarginPct = annual[0]?.netMarginPct ?? null;
  const priorMargin = annual[1]?.netMarginPct ?? null;
  const marginTrendPct = latestNetMarginPct != null && priorMargin != null ? latestNetMarginPct - priorMargin : null;
  const latestRev = annual[0]?.revenue ?? null;
  const priorRev = annual[1]?.revenue ?? null;
  const revenueGrowthPct = latestRev != null && priorRev != null && priorRev !== 0 ? ((latestRev - priorRev) / Math.abs(priorRev)) * 100 : null;

  return {
    symbol: symbol.toUpperCase(),
    faceValue: 10,
    sector: parseSector(html),
    annual,
    latestEps,
    epsGrowthPct,
    latestNetMarginPct,
    marginTrendPct,
    revenueGrowthPct,
    peTtm: parseStat(html, "P/E Ratio \\(TTM\\)"),
    pegTtm: parseStat(html, "PEG"),
    sharesOutstanding: parseStat(html, "Shares"),
    marketCapThousands: parseStat(html, "Market Cap"),
    fiscalYearEndMonth: parseFiscalYearEnd(html),
    fetchedAt: new Date().toISOString(),
    source: "psx-dps",
  };
}

const FY_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
// "Fiscal Year End June" in the company profile -> 6.
export function parseFiscalYearEnd(html: string): number | null {
  const t = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const m = /Fiscal Year End\s+([A-Za-z]+)/i.exec(t);
  const k = m ? FY_MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3))) : -1;
  return k >= 0 ? k + 1 : null;
}

// The company page itself, for callers that read more than one thing off it.
export async function fetchCompanyPage(symbol: string): Promise<string | null> {
  try {
    const res = await fetch(PSX_URL(symbol.toUpperCase()), { headers: { "user-agent": UA, accept: "text/html" }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

export async function fetchFundamentals(symbol: string): Promise<CompanyFundamentals | null> {
  try {
    const res = await fetch(PSX_URL(symbol.toUpperCase()), {
      headers: { "user-agent": UA, accept: "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000), // don't let one hung request stall a bulk run
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parseFinancials(html, symbol);
  } catch {
    return null;
  }
}
