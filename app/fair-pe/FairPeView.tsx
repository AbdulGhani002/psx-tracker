"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { fairOf, rateOf, shareFair, yearOf, type FairPeBoard, type Macro } from "@/lib/fair-pe/calc";

// The Fair P/E page: the rates you enter, each sector's P/E and dividend
// yield now and fair at those rates, your shares against their sector, and
// the past years. The figures follow what you type; Save keeps the rates.

type Field = "tbill" | "policy" | "cpi";
type Typed = Partial<Record<Field | "extraRisk", string>>;
const FIELDS: Array<{ k: Field; label: string }> = [
  { k: "tbill", label: "12M T-bill" },
  { k: "policy", label: "Policy rate" },
  { k: "cpi", label: "Inflation" },
];

const text = (v: number | null | undefined) => (v == null ? "" : String(v));
const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === "") return null;
  const v = Number(s.replace(/,/g, "").replace(/−/g, "-"));
  return Number.isFinite(v) ? v : null;
};
const fmtPe = (v: number | null | undefined) => (v == null ? "–" : v >= 100 ? "100+" : v.toFixed(1));
const fmtPct = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(1)}%`);
const fmtPts = (v: number | null | undefined) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`);
const gapPct = (now: number | null, fair: number | null) => (now != null && fair != null && fair > 0 ? (now / fair - 1) * 100 : null);
const fmtGap = (v: number | null) => (v == null ? "–" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`);

export function FairPeView({ board }: { board: FairPeBoard }) {
  const { history, known } = board;
  const [now, setNow] = useState<Typed>({ tbill: text(board.inputs.now.tbill), policy: text(board.inputs.now.policy), cpi: text(board.inputs.now.cpi), extraRisk: text(board.inputs.now.extraRisk) });
  const [years, setYears] = useState<Record<string, Typed>>(() =>
    Object.fromEntries(Object.entries(board.inputs.years).map(([y, m]) => [y, { tbill: text(m.tbill), policy: text(m.policy), cpi: text(m.cpi) }]))
  );
  const [skip, setSkip] = useState<string[]>(board.inputs.skip ?? []);
  const [watch, setWatch] = useState((board.inputs.watch ?? []).join(", "));
  const [metric, setMetric] = useState<"pe" | "dy" | "premium">("pe");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // What is used: what you typed, else the app's own figure.
  const used = useMemo(() => {
    const pick = (typed: Typed | undefined, k: Field, fallback: Macro | undefined) => num(typed?.[k]) ?? fallback?.[k] ?? null;
    const nowMacro: Macro = { tbill: pick(now, "tbill", known.now), policy: pick(now, "policy", known.now), cpi: pick(now, "cpi", known.now) };
    const yearMacro: Record<string, Macro> = {};
    for (const d of history.dates) {
      const y = yearOf(d);
      yearMacro[y] = { tbill: pick(years[y], "tbill", known.years[y]), policy: pick(years[y], "policy", known.years[y]), cpi: pick(years[y], "cpi", known.years[y]) };
    }
    return { nowMacro, yearMacro, rate: rateOf(nowMacro), extra: num(now.extraRisk) ?? 0 };
  }, [now, years, known, history.dates]);

  const shown = useMemo(() => [history.all, ...history.sectors.filter((s) => s.now.pe != null || history.dates.some((d) => s.years[d]?.pe != null))], [history]);
  const fairs = useMemo(() => new Map(shown.map((h) => [h.sector, fairOf(h, history.dates, used.yearMacro, used.rate, used.extra, skip)])), [shown, used, history.dates, skip]);
  const sectorOf = new Map(history.sectors.map((s) => [s.sector, s]));
  const watched = watch.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const mine = [...new Set([...board.held, ...watched])].flatMap((sym) => {
    const c = history.companies.find((x) => x.symbol === sym);
    const h = c ? sectorOf.get(c.sector) : undefined;
    return c && h ? [{ c, f: shareFair(c, h, history.dates, fairs.get(h.sector)?.fairPe ?? null), held: board.held.includes(sym) }] : [];
  });
  const unknown = watched.filter((sym) => !history.companies.some((c) => c.symbol === sym));
  const left = history.sectors.filter((s) => !shown.includes(s));
  const realRate = used.rate != null && used.nowMacro.cpi != null ? used.rate - used.nowMacro.cpi : null;

  // The years a view has figures for.
  const cols = history.dates.filter((d) => (metric === "dy" ? shown.some((h) => h.years[d]?.dy != null) : shown.some((h) => h.years[d]?.pe != null)));
  const cell = (h: (typeof shown)[number], d: string | null) => {
    const p = d ? h.years[d] : h.now;
    if (metric === "pe") return fmtPe(p?.pe);
    if (metric === "dy") return fmtPct(p?.dy);
    const r = d ? rateOf(used.yearMacro[yearOf(d)]) : used.rate;
    return p?.pe != null && r != null ? fmtPts(100 / p.pe - r) : "–";
  };

  const setYear = (y: string, k: Field, v: string) => setYears((ys) => ({ ...ys, [y]: { ...ys[y], [k]: v } }));

  async function save() {
    setBusy(true);
    setMsg(null);
    const nowBody = { tbill: num(now.tbill), policy: num(now.policy), cpi: num(now.cpi), extraRisk: num(now.extraRisk) };
    const yearsBody: Record<string, Macro> = {};
    for (const [y, m] of Object.entries(years)) {
      const v = { tbill: num(m.tbill), policy: num(m.policy), cpi: num(m.cpi) };
      if (v.tbill != null || v.policy != null || v.cpi != null) yearsBody[y] = v;
    }
    const res = await fetch("/api/fair-pe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ now: nowBody, years: yearsBody, skip, watch: [...new Set(watched)].slice(0, 20) }) }).catch(() => null);
    setBusy(false);
    setMsg(res?.ok ? "Saved." : "Could not save them.");
  }

  const input = (value: string | undefined, placeholder: number | null | undefined, onChange: (v: string) => void, label: string, wide = false) => (
    <input
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder == null ? "" : String(Math.round(placeholder * 100) / 100)}
      className={`field mono-num !py-1 ${wide ? "w-20" : "w-[58px] !px-1.5 text-[12px]"}`}
      inputMode="decimal"
      aria-label={label}
    />
  );

  return (
    <div className="fade-in">
      <PageHeader title="Fair P/E" subtitle="Sector P/E and dividend yields now and in past years, and what they would be at the rates you enter." />

      <Card title="Your numbers" action={<span className="text-[12px] text-muted">Left empty: the app's latest figure (grey)</span>}>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 text-[13px]">
          {FIELDS.map((f) => (
            <label key={f.k} className="flex flex-col gap-1">
              <span className="text-[12px] text-muted">{f.label} %</span>
              {input(now[f.k], known.now[f.k], (v) => setNow((n) => ({ ...n, [f.k]: v })), `${f.label} now, %`, true)}
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">Extra risk, pts</span>
            {input(now.extraRisk, 0, (v) => setNow((n) => ({ ...n, extraRisk: v })), "Extra risk, points", true)}
          </label>
          <div className="flex items-center gap-3 pb-1">
            <button type="button" className="btn-primary !py-1.5 text-[13px]" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            {msg && <span className="text-[12.5px] text-muted">{msg}</span>}
          </div>
        </div>
        <p className="text-[12.5px] text-muted mt-3">
          Rate used: <span className="mono-num text-ink">{fmtPct(used.rate)}</span>
          {realRate != null && <> · after inflation <span className="mono-num text-ink">{fmtPts(realRate)}</span></>}
          {used.extra !== 0 && <> · extra risk <span className="mono-num text-ink">{fmtPts(used.extra)}</span></>}
        </p>
      </Card>

      <Card className="mt-3" title="Sectors" action={<span className="text-[12px] text-muted">{history.companies.length} companies · prices of {new Date(board.builtAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" })}</span>}>
        <div className="overflow-x-auto -mx-2">
          <table className="table-zar">
            <thead>
              <tr>
                <th>Sector</th>
                <th className="text-right">P/E now</th>
                <th className="text-right">Fair P/E</th>
                <th className="text-right">Range</th>
                <th className="text-right">Now vs fair</th>
                <th className="text-right">Div yield now</th>
                <th className="text-right">Fair div yield</th>
                <th className="text-right" title="How many points the sector's earnings yield moved per point of rate in the years used">Rate effect</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((h) => {
                const f = fairs.get(h.sector)!;
                const all = h.sector === "All";
                return (
                  <tr key={h.sector} className={all ? "font-semibold" : ""}>
                    <td className="whitespace-nowrap">
                      {all ? "All covered" : h.sector} <span className="text-[11px] text-muted font-normal">{h.now.profitable}/{h.now.companies}</span>
                    </td>
                    <td className="text-right mono-num">{fmtPe(f.peNow)}</td>
                    <td className="text-right mono-num font-semibold">{fmtPe(f.fairPe)}</td>
                    <td className="text-right mono-num text-muted whitespace-nowrap">{f.fairPeLow != null || f.fairPeHigh != null ? `${fmtPe(f.fairPeLow)}–${fmtPe(f.fairPeHigh)}` : "–"}</td>
                    <td className="text-right mono-num">{fmtGap(gapPct(f.peNow, f.fairPe))}</td>
                    <td className="text-right mono-num">{fmtPct(f.dyNow)}</td>
                    <td className="text-right mono-num">{fmtPct(f.fairDy)}</td>
                    <td className="text-right mono-num text-muted">{f.fit ? f.fit.b.toFixed(1) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {(left.length > 0 || history.excluded.length > 0) && (
          <p className="text-[11.5px] text-muted mt-2">
            {left.length > 0 && <span title={left.map((s) => s.sector).join(", ")}>{left.length} smaller sectors have too few companies with profits. </span>}
            {history.excluded.length > 0 && <span title={history.excluded.map((e) => e.symbol + ": " + e.why).join("\n")}>Left out, figures don't match their page: {history.excluded.map((e) => e.symbol).join(", ")}.</span>}
          </p>
        )}
      </Card>

      <Card className="mt-3" title="Your shares" action={<span className="text-[12px] text-muted">Fair P/E = the sector's × the share's usual P/E against it</span>}>
          <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted mb-2">
            Also show
            <input value={watch} onChange={(e) => setWatch(e.target.value)} className="field !py-1 w-56 text-[12.5px]" placeholder="INDU, ATLH" aria-label="Other shares to show, by symbol" />
            {unknown.length > 0 && <span>No figures for {unknown.join(", ")}.</span>}
          </label>
          <div className="overflow-x-auto -mx-2">
            <table className="table-zar">
              <thead>
                <tr>
                  <th>Share</th>
                  <th>Sector</th>
                  <th className="text-right">P/E now</th>
                  <th className="text-right">Usual vs sector</th>
                  <th className="text-right">Fair P/E</th>
                  <th className="text-right">Now vs fair</th>
                  <th className="text-right">Div yield now</th>
                </tr>
              </thead>
              <tbody>
                {mine.map(({ c, f, held }) => (
                  <tr key={c.symbol}>
                    <td className="whitespace-nowrap"><Link href={held ? `/holdings/${c.symbol}` : `/stock/${c.symbol}`} className="font-semibold hover:text-[var(--accent-deep)]">{c.symbol}</Link>{!held && <span className="text-[11px] text-muted"> not held</span>}</td>
                    <td className="text-[12.5px] text-muted whitespace-nowrap">{c.sector}</td>
                    <td className="text-right mono-num">{fmtPe(f.peNow)}</td>
                    <td className="text-right mono-num">{f.ratio == null ? "–" : `${f.ratio.toFixed(2)}×`}</td>
                    <td className="text-right mono-num font-semibold">{fmtPe(f.fairPe)}</td>
                    <td className="text-right mono-num">{fmtGap(gapPct(f.peNow, f.fairPe))}</td>
                    <td className="text-right mono-num">{fmtPct(f.dyNow)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

      <Card
        className="mt-3"
        title="Past years"
        action={
          <div className="seg">
            {(
              [
                ["pe", "P/E"],
                ["dy", "Div yield"],
                ["premium", "Premium"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" data-active={metric === k} onClick={() => setMetric(k)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="overflow-x-auto -mx-2">
          <table className="table-zar">
            <thead>
              <tr>
                <th>30 June</th>
                {cols.map((d) => {
                  const y = yearOf(d);
                  return (
                    <th key={d} className="text-right">
                      <label className="inline-flex items-center gap-1 cursor-pointer" title="Count this year in the fair P/E lines">
                        <input type="checkbox" checked={!skip.includes(y)} onChange={(e) => setSkip((k) => (e.target.checked ? k.filter((x) => x !== y) : [...k, y]))} aria-label={`Count ${y} in the fair P/E`} />
                        {y}
                      </label>
                    </th>
                  );
                })}
                <th className="text-right">Now</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((f) => (
                <tr key={f.k}>
                  <td className="whitespace-nowrap text-[12.5px] text-muted">{f.label} %</td>
                  {cols.map((d) => {
                    const y = yearOf(d);
                    return <td key={d} className="text-right">{input(years[y]?.[f.k], known.years[y]?.[f.k], (v) => setYear(y, f.k, v), `${f.label} on 30 June ${y}, %`)}</td>;
                  })}
                  <td className="text-right mono-num text-[12.5px] text-muted">{fmtPct(used.nowMacro[f.k])}</td>
                </tr>
              ))}
              {shown.map((h) => (
                <tr key={h.sector} className={h.sector === "All" ? "font-semibold" : ""}>
                  <td className="whitespace-nowrap">{h.sector === "All" ? "All covered" : h.sector}</td>
                  {cols.map((d) => (
                    <td key={d} className="text-right mono-num">{cell(h, d)}</td>
                  ))}
                  <td className="text-right mono-num">{cell(h, null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11.5px] text-muted mt-2">Grey: the app's own figure; type over it to use yours. Untick a year to leave it out of the fair P/E. Save keeps all of it. Premium = earnings yield (100 ÷ P/E) minus that year's rate.</p>
      </Card>

      <details className="mt-3 text-[12.5px] text-muted">
        <summary className="cursor-pointer">How it is worked out</summary>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>P/E: a sector's profitable companies' market value over their last full year's profit (at least two companies). Market value uses today's shares and prices adjusted for bonus and split issues.</li>
          <li>Dividend yield: cash dividends gone ex in the 12 months to the date, over the price then, weighted by value.</li>
          <li>Each sector's earnings yield (100 ÷ P/E) at each 30 June is set against that year's 12-month T-bill (the policy rate when no T-bill is given), and a straight line drawn through the ticked years. Rate effect = how many points the yield moved per point of rate.</li>
          <li>Fair P/E = 100 ÷ (the line at your rate + extra risk). Beyond the rates seen, the yield moves at most point for point with the rate. The range comes from the line's largest miss in those years.</li>
          <li>A year whose profit figures cover under 60% of a sector's value shows no P/E.</li>
          <li>Fair dividend yield = fair earnings yield × the sector's usual payout. A share's fair P/E = its sector's × the share's usual P/E against the sector.</li>
        </ul>
      </details>
    </div>
  );
}
