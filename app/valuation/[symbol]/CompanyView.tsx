import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { getValuationCompany } from "@/lib/valuation/board";
import { METHODS } from "@/lib/valuation/engine";
import { DraftButtons } from "../ValuationActions";
import { AssumptionEditor } from "./AssumptionEditor";
import { TriggerEditor } from "./TriggerEditor";
import { SIGNAL, money, level, bandText, pct, GOV } from "../signal";

// One share's valuation: a draft waiting, today's value with each method and
// its parts, the inputs to edit, the triggers, the filings since the thesis
// and every version before.

const NAMES: Record<string, string> = { ddm: "Dividend discount", pb: "Justified P/B", ep: "Earnings power", pe: "P/E", sotp: "Sum of the parts / NAV" };
const FIELDS: Array<[string, string]> = [["type", "Business"], ["policy", "Policy"], ["governance", "Governance"], ["eps", "EPS"], ["dps", "D1"], ["bvps", "Book"], ["roe", "ROE"], ["g", "Growth"], ["pe", "P/E"], ["peSpread", "P/E spread"], ["premium", "Premium"], ["illiquid", "Thin"]];

function changes(a: any, b: any | null): string[] {
  if (!b) return ["first version"];
  return FIELDS.filter(([k]) => (a?.[k] ?? null) !== (b?.[k] ?? null)).map(([k, l]) => `${l} ${b?.[k] ?? "—"} → ${a?.[k] ?? "—"}`);
}

function ZoneScale({ price, zones, fair }: { price: number; zones: { accumulate: number; strong: number; trim: number }; fair: number }) {
  const lo = Math.min(zones.strong, price) * 0.92, hi = Math.max(zones.trim, price) * 1.04;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="mt-3" role="img" aria-label={`Price ${money(price)}: strong ${level(zones.strong)}, accumulate ${level(zones.accumulate)}, fair ${level(fair)}, trim ${level(zones.trim)}`}>
      <div className="relative h-6">
        <div className="absolute top-1/2 left-0 right-0 h-[2px] -translate-y-1/2" style={{ background: "var(--rule-strong)" }} />
        <div className="absolute top-1 bottom-1 rounded" style={{ left: x(lo), width: `calc(${x(zones.strong)} - ${x(lo)})`, background: "color-mix(in srgb, var(--positive) 38%, transparent)" }} />
        <div className="absolute top-1 bottom-1 rounded" style={{ left: x(zones.strong), width: `calc(${x(zones.accumulate)} - ${x(zones.strong)})`, background: "color-mix(in srgb, var(--positive) 18%, transparent)" }} />
        <div className="absolute top-1 bottom-1 rounded" style={{ left: x(zones.trim), right: 0, background: "color-mix(in srgb, var(--negative) 18%, transparent)" }} />
        <div className="absolute top-0 bottom-0 w-[2px]" style={{ left: x(fair), background: "var(--ink)" }} />
        <div className="absolute top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: x(price), background: "var(--ink)", border: "2px solid var(--surface)", boxShadow: "0 0 0 1px var(--ink)" }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-[11.5px] mt-1">
        <span style={{ color: "var(--positive)" }}>Strong ≤{level(zones.strong)}</span>
        <span style={{ color: "var(--positive)" }}>Accumulate ≤{level(zones.accumulate)}</span>
        <span>Fair {level(fair)}</span>
        <span style={{ color: "var(--negative)" }}>Trim ≥{level(zones.trim)}</span>
        <span className="text-muted">Now {money(price)}</span>
      </div>
    </div>
  );
}

// What the home machine read from the results letter, and what it could not check.
function FilingRead({ f }: { f: any }) {
  const got = f.eps != null || f.equity != null || f.dps != null;
  return (
    <p className="text-[12px] text-muted mt-1">
      Read from <a href={f.url} className="link-underline" target="_blank" rel="noreferrer">{f.title}</a> ({f.date}){f.source === "model" ? " by your PC's model" : ""}
      {got
        ? `: ${f.period ?? "period"} to ${f.periodEnd ?? "?"}${f.basis ? `, ${f.basis}` : ""}, EPS ${f.eps ?? "—"}${f.epsPrior != null ? ` (${f.epsPrior} a year before)` : ""}${f.equity != null ? `, equity Rs ${Math.round(f.equity / 1e6).toLocaleString("en-US")}m` : ""}${f.revaluation != null ? ` (revaluation Rs ${Math.round(f.revaluation / 1e6).toLocaleString("en-US")}m)` : ""}, dividend ${f.dps ?? "—"}.`
        : ": nothing could be read; check it yourself."}
      {f.checks?.length > 0 && <span className="block">{f.checks.join(" ")}</span>}
    </p>
  );
}

export function CompanyView({ c }: { c: Awaited<ReturnType<typeof getValuationCompany>> }) {
  // Today's valuation: the evening run's, else the approved version on the
  // latest close, else what the record suggests.
  const shown = c.run ?? c.approvedPreview ?? c.suggestedPreview;
  const from = c.run ? `the ${c.run.date} close` : c.approvedPreview ? "the latest close" : c.suggestedPreview ? "the record's suggestion, not approved" : null;
  const sig = shown ? SIGNAL[shown.signal] : null;
  const initial = c.draft ?? c.approved ?? c.suggested ?? {};

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div>
          <Link href="/valuation" className="text-[12px] link-underline">Valuation</Link>
          <div className="text-[20px] font-bold leading-tight">
            {c.symbol}
            {c.approved && <span className="inline-block w-2.5 h-2.5 rounded-full ml-2 align-middle" style={{ background: GOV[c.approved.governance] }} title={`Governance ${c.approved.governance}`} />}
            {c.held && <span className="pill ml-2 align-middle" data-tone="positive">held</span>}
          </div>
          <div className="text-[12.5px] text-muted">{c.name}{c.price ? ` · ${money(c.price)} on ${c.priceDate}` : ""}</div>
        </div>
        {c.approved && <div className="text-[12px] text-muted">Approved v{c.approved.version}, reviewed {c.approved.asOf}</div>}
      </div>

      {c.draft && (
        <Card className="mb-3" title={`Draft v${c.draft.version}${c.draft.source === "auto" ? " from your PC" : ""}`} action={<DraftButtons id={String(c.draft._id)} />}>
          <ul className="text-[12.5px] space-y-0.5">
            {changes(c.draft, c.approved).map((x) => <li key={x}>{x}</li>)}
          </ul>
          {c.draft.note && <p className="text-[12px] text-muted mt-2">{c.draft.note}</p>}
          {c.draft.evidence?.filing && <FilingRead f={c.draft.evidence.filing} />}
          {c.draftPreview && <p className="text-[12px] mt-1">If approved: fair {level(c.draftPreview.fairValue)}, accumulate ≤{level(c.draftPreview.zones?.accumulate)}, {SIGNAL[c.draftPreview.signal].label.toLowerCase()}.</p>}
        </Card>
      )}

      {shown && shown.fairValue != null && shown.zones && (
        <Card title="Value today" action={<span className="text-[12px] text-muted">{from}</span>}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="pill" data-tone={sig!.tone}>{sig!.label}</span>
            <span className="text-[13px]">Fair <span className="mono-num font-semibold">{level(shown.fairValue)}</span>{bandText(shown.band) && <span className="text-muted"> ({bandText(shown.band)} at hurdle ±1)</span>}</span>
            {shown.expected && (
              <span className="text-[13px]">
                Return <span className="mono-num font-semibold">{pct(shown.expected.total)}</span>
                <span className="text-muted"> = yield {pct(shown.expected.yield)} + growth {pct(shown.expected.growth)} + re-rating {pct(shown.expected.rerate, 1, true)}</span>
                <span className="text-muted"> against {pct(shown.r)}</span>
              </span>
            )}
          </div>
          {c.price && <ZoneScale price={c.price} zones={shown.zones} fair={shown.fairValue} />}
          <div className="overflow-x-auto -mx-2 mt-3">
            <table className="table-zar">
              <thead><tr><th>Method</th><th className="text-right">Value</th><th className="text-right">Weight</th></tr></thead>
              <tbody>
                {METHODS.filter((m) => shown.values?.[m] != null || (shown.weights?.[m] ?? 0) > 0).map((m) => (
                  <tr key={m} style={(shown.weights?.[m] ?? 0) > 0 ? undefined : { opacity: 0.55 }}>
                    <td>{NAMES[m]}</td>
                    <td className="text-right mono-num">{level(shown.values?.[m])}</td>
                    <td className="text-right mono-num">{(shown.weights?.[m] ?? 0) > 0 ? shown.weights[m] : "shown only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.notes?.length > 0 && <ul className="text-[12px] text-muted mt-2 list-disc pl-4">{shown.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>}
        </Card>
      )}

      <Card className="mt-3" title={c.approved ? "Edit the inputs" : c.draft ? "The draft's inputs" : "Inputs, suggested from the record"}>
        <AssumptionEditor symbol={c.symbol} initial={initial} price={c.price} tbill={c.tbill} held={c.held} prices={c.closes} />
      </Card>

      <Card className="mt-3" title="Triggers" action={<span className="text-[12px] text-muted">Written in advance; tested every close</span>}>
        <TriggerEditor symbol={c.symbol} rows={c.triggers} />
      </Card>

      {c.filings.length > 0 && (
        <Card className="mt-3" title="Results filed">
          <ul className="text-[13px] space-y-1">
            {c.filings.map((f) => (
              <li key={f.date + f.title}>
                <span className="mono-num text-muted">{f.date}</span> {f.url ? <a href={f.url} className="link-underline" target="_blank" rel="noreferrer">{f.title}</a> : f.title}
                {f.after && <span className="pill ml-2" data-tone="negative">after your review</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {c.versions.length > 0 && (
        <Card className="mt-3" title="Versions">
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead><tr><th>Version</th><th>Status</th><th>As of</th><th>Changes</th></tr></thead>
              <tbody>
                {c.versions.map((v: any, k: number) => (
                  <tr key={String(v._id)}>
                    <td className="mono-num">v{v.version}<div className="text-[10.5px] text-muted">{v.source === "auto" ? "your PC" : "you"}</div></td>
                    <td><span className="pill" data-tone={v.status === "approved" ? "positive" : v.status === "draft" ? "muted" : undefined}>{v.status}</span></td>
                    <td className="mono-num text-muted">{v.asOf}</td>
                    <td className="text-[12px]">{changes(v, c.versions[k + 1] ?? null).join(" · ")}{v.note ? <div className="text-muted">{v.note}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
