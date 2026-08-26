import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { getAllHoldings } from "@/lib/data";
import { fetchFilings, FILING_CATEGORIES, type Filing } from "@/lib/prices/filings";

export const dynamic = "force-dynamic";

// What each company you own has actually filed. The PDFs behind these links are
// the primary source for every earnings figure in this app, so being one click
// from the filing — rather than from a number somebody typed in — is the point.
//
// Filings come from the PSX data portal and are cached for an hour. A company
// whose page cannot be read says so: an empty list and a fetch that failed are
// different things, and showing them the same way would be a quiet lie.

type Row = {
  symbol: string;
  name: string;
  sector: string;
  shares: number;
  filings: Filing[];
  error: string | null;
};

function fmtDate(f: Filing): string {
  return f.date ? f.date : f.dateLabel || "—";
}

export default async function CompaniesPage() {
  const holdings = await getAllHoldings().catch(() => []);
  const owned = holdings
    .filter((h) => (h.currentShares ?? 0) > 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  // One request per company, all at once, none allowed to sink the page.
  const rows: Row[] = await Promise.all(
    owned.map(async (h) => {
      try {
        const filings = await fetchFilings(h.symbol);
        return { symbol: h.symbol, name: h.name ?? "", sector: h.sector ?? "", shares: h.currentShares ?? 0, filings, error: null };
      } catch (e) {
        return {
          symbol: h.symbol,
          name: h.name ?? "",
          sector: h.sector ?? "",
          shares: h.currentShares ?? 0,
          filings: [],
          error: String(e instanceof Error ? e.message : e).slice(0, 120),
        };
      }
    })
  );

  const totalFilings = rows.reduce((s, r) => s + r.filings.length, 0);
  const failed = rows.filter((r) => r.error).length;

  return (
    <div>
      <PageHeader
        eyebrow="The companies behind the positions"
        title="What they filed."
        subtitle="Every company you hold, with the announcements it has actually lodged with the exchange — results, board meetings and everything else. The PDFs are the primary source behind the earnings figures used elsewhere in this app, so read them here rather than take a number on trust."
      />

      {owned.length === 0 && (
        <p className="text-[14px] text-muted">No open positions, so there is nothing to follow.</p>
      )}

      {owned.length > 0 && (
        <div className="label-cap mb-8">
          {owned.length} companies · {totalFilings} filings
          {failed > 0 && <span style={{ color: "var(--negative)" }}> · {failed} could not be read</span>}
        </div>
      )}

      <div className="space-y-12">
        {rows.map((r) => (
          <section key={r.symbol} className="fade-in-up">
            <div className="border-t-2 border-t-[var(--ink)] pt-4 flex items-start gap-4">
              <CompanyMark symbol={r.symbol} sector={r.sector} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <Link href={`/holdings/${r.symbol}`} className="font-display text-[26px] leading-none link-underline">
                    {r.symbol}
                  </Link>
                  <span className="text-[14px] text-muted truncate">{r.name}</span>
                </div>
                <div className="label-cap mt-2">
                  {r.sector || "sector not recorded"} · <span className="mono-num">{r.shares.toLocaleString()}</span> shares held
                </div>
              </div>
              <a
                href={`https://dps.psx.com.pk/company/${r.symbol}`}
                target="_blank"
                rel="noreferrer noopener"
                className="label-cap link-underline shrink-0"
              >
                PSX ↗
              </a>
            </div>

            {r.error && (
              <p className="mt-4 text-[13px]" style={{ color: "var(--negative)" }}>
                The exchange page for {r.symbol} could not be read ({r.error}). That is a failed fetch, not an absence of
                filings — try again shortly.
              </p>
            )}

            {!r.error && r.filings.length === 0 && (
              <p className="mt-4 text-[13px] text-muted">
                The exchange page loaded but lists no announcements for {r.symbol}.
              </p>
            )}

            {r.filings.length > 0 && (
              <div className="mt-5 grid gap-8 md:grid-cols-3">
                {FILING_CATEGORIES.map((cat) => {
                  const items = r.filings.filter((f) => f.category === cat);
                  if (items.length === 0) return null;
                  return (
                    <div key={cat}>
                      <div className="section-eyebrow border-b border-[var(--rule)] pb-2 mb-3">{cat}</div>
                      <ul className="space-y-3">
                        {items.map((f, i) => (
                          <li key={`${f.pdfUrl ?? f.title}-${i}`} className="row-hover -mx-2 px-2 py-1">
                            <div className="label-cap">{fmtDate(f)}</div>
                            <div className="text-[13px] leading-snug mt-0.5">
                              {f.pdfUrl ? (
                                <a href={f.pdfUrl} target="_blank" rel="noreferrer noopener" className="link-underline">
                                  {f.title}
                                </a>
                              ) : (
                                <span>{f.title}</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>

      {owned.length > 0 && (
        <p className="mt-16 pt-4 border-t border-[var(--rule)] text-[12px] text-muted max-w-[70ch]">
          Filings are read from the PSX data portal and cached for an hour. The portal publishes no company logos, so the
          marks above are monograms tinted by sector rather than artwork taken from anywhere else.
        </p>
      )}
    </div>
  );
}
