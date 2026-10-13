import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import type { getValuationBoard } from "@/lib/valuation/board";
import { RunNow, OpenShare, DraftButtons } from "./ValuationActions";
import { SIGNAL, money, level, bandText, pct, GOV } from "./signal";

// The valuation page's body, from lib/valuation/board.ts (the preview page
// draws it on sample figures).
export function ValuationView({ b }: { b: Awaited<ReturnType<typeof getValuationBoard>> }) {
  return (
    <div>
      <PageHeader title="Valuation" subtitle="Fair values and buy zones from your approved assumptions." />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="text-[12.5px] text-muted">
          {b.tbill != null ? <>12-month T-bill <span className="mono-num text-ink">{b.tbill.toFixed(2)}%</span> · hurdle <span className="mono-num text-ink">{b.hurdles!.quality.toFixed(1)}%</span> quality, <span className="mono-num text-ink">{b.hurdles!.standard.toFixed(1)}%</span> other</> : "No T-bill rate yet: enter this month's rates on Strategy."}
          {b.date ? ` · valued on the ${b.date} close` : ""}
        </div>
        <div className="flex items-center gap-2">
          <OpenShare />
          <RunNow />
        </div>
      </div>

      {(b.review.length > 0 || b.heldWithout.length > 0) && (
        <Card title="To review" className="mb-3">
          {b.review.length > 0 && (
            <ul className="divide-y divide-[var(--rule)]">
              {b.review.map((r) => (
                <li key={r.symbol} className="py-2 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0">
                    <Link href={`/valuation/${r.symbol}`} className="font-semibold hover:underline">{r.symbol}</Link>
                    <span className="text-muted"> · draft v{r.draft.version}{r.draft.source === "auto" ? " from your PC" : ""}{r.draft.evidence?.filing ? `, filing of ${r.draft.evidence.filing.date}` : ""}{r.approved ? "" : ", first version"}</span>
                    {r.draft.note && <span className="block text-[11.5px] text-muted">{r.draft.note}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Link href={`/valuation/${r.symbol}`} className="text-[12px] link-underline">Open</Link>
                    <DraftButtons id={String(r.draft._id)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {b.heldWithout.length > 0 && (
            <p className="text-[12px] text-muted mt-2">
              Held, not valued yet: {b.heldWithout.map((s, k) => (
                <span key={s}>{k > 0 && ", "}<Link href={`/valuation/${s}`} className="link-underline">{s}</Link></span>
              ))}. Your PC drafts them each evening.
            </p>
          )}
        </Card>
      )}

      <Card>
        {b.rows.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing approved yet. Open a share above, check its inputs and approve them.</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead>
                <tr>
                  <th>Share</th>
                  <th>Signal</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">Fair value</th>
                  <th className="text-right">Accumulate</th>
                  <th className="text-right">Strong</th>
                  <th className="text-right">Trim</th>
                  <th className="text-right">To zone</th>
                  <th className="text-right">Return over hurdle</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => {
                  const run = r.run;
                  const s = SIGNAL[run?.signal ?? "NO VALUE"];
                  const toZone = run?.zones && run.price ? (run.zones.accumulate / run.price - 1) * 100 : null;
                  return (
                    <tr key={r.symbol}>
                      <td>
                        <Link href={`/valuation/${r.symbol}`} className="font-semibold hover:underline">{r.symbol}</Link>
                        <span className="inline-block w-2 h-2 rounded-full ml-1.5 align-middle" style={{ background: GOV[r.assumption.governance] }} title={`Governance ${r.assumption.governance}`} />
                        {r.held && <span className="pill ml-1.5" data-tone="positive">held</span>}
                        <div className="text-[11px] text-muted truncate max-w-[180px]">{r.name}</div>
                      </td>
                      <td>
                        <span className="pill whitespace-nowrap" data-tone={s.tone}>{s.label}</span>
                        {r.prev && run && r.prev.signal !== run.signal && <div className="text-[10.5px] text-muted">was {SIGNAL[r.prev.signal]?.label ?? r.prev.signal}</div>}
                      </td>
                      <td className="text-right mono-num">{money(run?.price)}</td>
                      <td className="text-right mono-num">
                        {level(run?.fairValue)}
                        {bandText(run?.band) && <div className="text-[10.5px] text-muted">{bandText(run?.band)}</div>}
                      </td>
                      <td className="text-right mono-num">{run?.zones ? `≤${level(run.zones.accumulate)}` : "—"}</td>
                      <td className="text-right mono-num">{run?.zones ? `≤${level(run.zones.strong)}` : "—"}</td>
                      <td className="text-right mono-num">{run?.zones ? `≥${level(run.zones.trim)}` : "—"}</td>
                      <td className="text-right mono-num" style={{ color: toZone != null && toZone >= 0 ? "var(--positive)" : undefined }}>{toZone == null ? "—" : toZone >= 0 ? "in zone" : pct(toZone, 1)}</td>
                      <td className="text-right mono-num" style={{ color: run?.excess == null ? undefined : run.excess >= 0 ? "var(--positive)" : "var(--negative)" }}>
                        {run?.excess == null ? "—" : `${run.excess >= 0 ? "+" : ""}${run.excess.toFixed(1)} pts`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <details className="mt-3 text-[12.5px] text-muted">
        <summary className="cursor-pointer select-none">How it works</summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          <li>Hurdle: the 12-month T-bill + 3.5 points for a quality name, + 4.5 for the rest. Zones move when rates move.</li>
          <li>Fair value: at least three methods matched to the business (dividend discount, justified P/B, earnings power, P/E, sum of the parts). Band at the hurdle ± 1 point.</li>
          <li>Zones: accumulate and strong at the policy&apos;s margins of safety, trim at a multiple of fair value. Holding companies against their NAV.</li>
          <li>Return over hurdle: cash yield + value growth + the gap to fair value closing over 3 years, less the hurdle.</li>
          <li>Gates: red governance never buys; amber waits for its event; a new filing after your review stops buy signals until you review; thin shares are only watched.</li>
          <li>Each evening your PC reads new results letters with its own model (scanned pages too), checks EPS against profit over shares, and drafts the inputs. Nothing counts until you approve it. Not advice; no trading is automatic.</li>
        </ul>
      </details>
    </div>
  );
}
