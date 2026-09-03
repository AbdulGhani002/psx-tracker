"use client";

import { useState } from "react";
import { Section } from "@/components/layout/Section";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { fmtRs } from "@/lib/format";
import { MANUAL_SIGNALS } from "@/lib/calculations/regime";

type Rung = { level: number; pct: number; label: string; firedAt: string; firedAmount: number };
type CashSource = {
  id?: string;
  label: string;
  kind: string;
  amount: number;
  currency: string;
  pkr?: number;
  expectedDate: string;
  note: string;
};

// The board is the only place the plan is edited. Every save round-trips
// through /api/plan and replaces the whole view, so what you see after a save is
// what the weekly PDF will say — never a local guess at it.
export function PlanBoard({ initial }: { initial: any }) {
  const [plan, setPlan] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pb = plan.playbook;
  const [rungs, setRungs] = useState<Rung[]>(pb.rungs ?? []);
  const [sources, setSources] = useState<CashSource[]>(
    (pb.cashSources ?? []).map((c: any) => ({
      label: c.label,
      kind: c.kind,
      amount: c.amount,
      currency: c.currency,
      expectedDate: c.expectedDate ?? "",
      note: c.note ?? "",
    }))
  );
  const [reservePct, setReservePct] = useState(String(pb.ladderReservePct ?? 10));
  const [corePct, setCorePct] = useState(String(pb.ladderCorePct ?? 0));
  // Offered by the server only when the written ladder has money parked where
  // the market rarely goes. Empty the rest of the time, and the block below is
  // hidden with it.
  const suggestion: Array<{ level: number; pct: number; label: string; fallPct: number; reachedSharePct: number }> =
    plan.ladderSuggestion ?? [];
  const [weeklyOn, setWeeklyOn] = useState(!!pb.weeklyReportEnabled);
  const [email, setEmail] = useState(pb.weeklyReportEmail ?? "");

  const manualByKey = new Map<string, any>((pb.regimeManual ?? []).map((m: any) => [m.key, m]));

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "save failed");
      setPlan(j.plan);
      return j.plan;
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const num = (s: string) => {
    const v = Number(String(s).replace(/,/g, ""));
    return Number.isFinite(v) ? v : 0;
  };

  const totalPct = rungs.reduce((s, r) => s + (r.pct || 0), 0);

  return (
    <>
      {err && (
        <div className="mt-6 p-3 text-[13px]" style={{ border: "1px solid var(--negative)", color: "var(--negative)" }}>
          {err}
        </div>
      )}

      {/* ---------------------------------------------------------- ladder */}
      <Section
        number="04"
        title="Set your rungs"
        description="Write the levels down before the market gets there. A level you decide in advance is a rule; the same level decided on the day is a reaction."
        action={
          <Button
            onClick={async () => {
              const clean = rungs.filter((r) => r.level > 0);
              await save({ rungs: clean, ladderReservePct: num(reservePct), ladderCorePct: num(corePct) });
            }}
            disabled={busy}
          >
            {busy ? "Saving" : "Save ladder"}
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-rule text-muted label-cap">
                <th className="text-left py-2">Index level</th>
                <th className="text-left py-2">Share of pool</th>
                <th className="text-left py-2">Note</th>
                <th className="text-right py-2">Amount</th>
                <th className="text-right py-2">Turns up</th>
                <th className="text-right py-2">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rungs.map((r, i) => {
                const row = plan.ladder.rows.find((x: any) => x.level === r.level);
                return (
                  <tr key={i} className="border-b border-rule/60">
                    <td className="py-2 pr-3">
                      <input
                        className="bg-transparent border-b border-ink text-[13px] py-1 focus:outline-none  w-28"
                        inputMode="numeric"
                        value={r.level || ""}
                        onChange={(e) => {
                          const next = [...rungs];
                          next[i] = { ...r, level: num(e.target.value) };
                          setRungs(next);
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="bg-transparent border-b border-ink text-[13px] py-1 focus:outline-none  w-16"
                        inputMode="decimal"
                        value={r.pct || ""}
                        onChange={(e) => {
                          const next = [...rungs];
                          next[i] = { ...r, pct: num(e.target.value) };
                          setRungs(next);
                        }}
                      />
                      <span className="text-muted"> %</span>
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        className="bg-transparent border-b border-ink text-[13px] py-1 focus:outline-none  w-44"
                        value={r.label}
                        placeholder="why this level"
                        onChange={(e) => {
                          const next = [...rungs];
                          next[i] = { ...r, label: e.target.value };
                          setRungs(next);
                        }}
                      />
                    </td>
                    <td className="py-2 text-right">{row ? fmtRs(row.amount) : "—"}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {row?.reachedSharePct == null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <span
                          title={
                            row.fallFromHighPct.toFixed(1) +
                            "% below the index high; reached in " +
                            row.reachedSharePct.toFixed(1) +
                            "% of sessions on record"
                          }
                          style={{
                            color:
                              row.reach === "dead"
                                ? "var(--negative)"
                                : row.reach === "thin"
                                ? "var(--amber, var(--ink))"
                                : "var(--muted)",
                          }}
                        >
                          {row.reachedSharePct < 0.5
                            ? row.reachedSharePct.toFixed(1)
                            : row.reachedSharePct.toFixed(0)}
                          % of days
                          {row.reach === "dead" ? " · dead" : row.reach === "thin" ? " · thin" : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {r.firedAt ? (
                        <span className="text-muted">fired {r.firedAt}</span>
                      ) : row?.status === "READY" ? (
                        <span style={{ color: "var(--positive)" }}>READY</span>
                      ) : (
                        <span className="text-muted">
                          {row ? `${row.moveRequiredPct.toFixed(1)}%` : "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {!r.firedAt && row?.status === "READY" && (
                        <Button
                          variant="ghost"
                          onClick={async () => {
                            const next = [...rungs];
                            next[i] = {
                              ...r,
                              firedAt: new Date().toISOString().slice(0, 10),
                              firedAmount: row?.amount ?? 0,
                            };
                            setRungs(next);
                            await save({ rungs: next.filter((x) => x.level > 0) });
                          }}
                        >
                          mark fired
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => setRungs(rungs.filter((_, k) => k !== i))}
                        aria-label="remove rung"
                      >
                        ×
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <Button
            variant="ghost"
            onClick={() => setRungs([...rungs, { level: 0, pct: 0, label: "", firedAt: "", firedAmount: 0 }])}
          >
            + add rung
          </Button>
          <div className="w-32">
            <TextInput
              label="Reserve %"
              value={reservePct}
              onChange={(e) => setReservePct(e.target.value)}
              hint="never spent"
            />
          </div>
          <div className="w-32">
            <TextInput
              label="Core %"
              value={corePct}
              onChange={(e) => setCorePct(e.target.value)}
              hint="invested regardless"
            />
          </div>
          <div className="text-[12px] text-muted">
            Allocated {totalPct.toFixed(0)}% of the ladder pool
            {totalPct > 100 && <span style={{ color: "var(--negative)" }}> — over 100%, trim a rung</span>}
          </div>
        </div>

        {plan.ladder.diagnostics?.length > 0 && (
          <div className="mt-5">
            <Card>
              <div className="label-cap mb-2" style={{ color: "var(--negative)" }}>
                What the record says about these levels
              </div>
              <ul className="text-[13px] space-y-2">
                {plan.ladder.diagnostics.map((d: string, i: number) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
              {suggestion.length > 0 && (
                <div className="mt-4 pt-4 border-t border-rule">
                  <div className="label-cap mb-2">A shape drawn from the record instead</div>
                  <table className="w-full text-[13px] tabular-nums max-w-lg">
                    <tbody>
                      {suggestion.map((r) => (
                        <tr key={r.level} className="border-b border-rule/60">
                          <td className="py-1.5 font-mono">{r.level.toLocaleString("en-PK")}</td>
                          <td className="py-1.5 text-right">{r.pct}%</td>
                          <td className="py-1.5 text-right text-muted">{r.fallPct.toFixed(1)}% down</td>
                          <td className="py-1.5 text-right text-muted">
                            {r.reachedSharePct.toFixed(0)}% of days
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[12px] text-muted mt-2 max-w-[70ch]">
                    Each level carries money in proportion to how often the index has actually been there. It is a
                    starting point drawn from {plan.ladder.referenceHigh > 0 ? "the index high of " + Math.round(plan.ladder.referenceHigh).toLocaleString("en-PK") : "the record"},
                    not a recommendation — your levels should still be yours. Loading it replaces the rows above; nothing
                    saves until you press Save ladder.
                  </p>
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      onClick={() =>
                        setRungs(
                          suggestion.map((r) => ({
                            level: r.level,
                            pct: r.pct,
                            label: r.label,
                            firedAt: "",
                            firedAmount: 0,
                          }))
                        )
                      }
                    >
                      Load this shape into the rows above
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="mt-5">
          <Card>
            <div className="label-cap mb-2">Arm the ladder</div>
            <p className="text-[13px] text-muted mb-3">
              Arming freezes the pool the rungs are slices of, at {fmtRs(plan.cash.available + plan.cash.receivable + plan.cash.expected)} today.
              Slices are cut from that figure and stay that size as you spend, which is what keeps the lowest rungs
              buyable. Re-arm only when new money genuinely changes the plan.
            </p>
            <Button
              onClick={() =>
                save({
                  poolAtArming: plan.cash.available + plan.cash.receivable + plan.cash.expected,
                  armedAt: new Date().toISOString().slice(0, 10),
                })
              }
              disabled={busy}
            >
              Arm at {fmtRs(plan.cash.available + plan.cash.receivable + plan.cash.expected)}
            </Button>
            {pb.armedAt && (
              <div className="mt-2 text-[12px] text-muted">
                Currently armed at {fmtRs(pb.poolAtArming)} on {pb.armedAt}.
              </div>
            )}
          </Card>
        </div>
      </Section>

      {/* ------------------------------------------------------ cash sources */}
      <Section
        number="05"
        title="Cash you have not put in yet"
        description="Three kinds, because they are not interchangeable: money you could spend this morning, money owed to you, and money you merely expect. Only the first funds a rung."
        action={
          <Button onClick={() => save({ cashSources: sources.filter((s) => s.label.trim()) })} disabled={busy}>
            {busy ? "Saving" : "Save cash"}
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-rule text-muted label-cap">
                <th className="text-left py-2">Label</th>
                <th className="text-left py-2">Kind</th>
                <th className="text-left py-2">Amount</th>
                <th className="text-left py-2">Currency</th>
                <th className="text-left py-2">Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sources.map((c, i) => (
                <tr key={i} className="border-b border-rule/60">
                  <td className="py-2 pr-3">
                    <input
                      className="bg-transparent border-b border-ink text-[13px] py-1 focus:outline-none  w-40"
                      value={c.label}
                      placeholder="e.g. client invoice"
                      onChange={(e) => {
                        const n = [...sources];
                        n[i] = { ...c, label: e.target.value };
                        setSources(n);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      className="bg-transparent border-b border-ink text-[13px] py-1 focus:outline-none "
                      value={c.kind}
                      onChange={(e) => {
                        const n = [...sources];
                        n[i] = { ...c, kind: e.target.value };
                        setSources(n);
                      }}
                    >
                      <option value="available">available</option>
                      <option value="receivable">receivable</option>
                      <option value="expected">expected</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className="bg-transparent border-b border-ink text-[13px] py-1 focus:outline-none  w-28"
                      inputMode="decimal"
                      value={c.amount || ""}
                      onChange={(e) => {
                        const n = [...sources];
                        n[i] = { ...c, amount: num(e.target.value) };
                        setSources(n);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <select
                      className="bg-transparent border-b border-ink text-[13px] py-1 focus:outline-none "
                      value={c.currency}
                      onChange={(e) => {
                        const n = [...sources];
                        n[i] = { ...c, currency: e.target.value };
                        setSources(n);
                      }}
                    >
                      <option value="PKR">PKR</option>
                      <option value="USD">USD</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      className="bg-transparent border-b border-ink text-[13px] py-1 focus:outline-none  w-32"
                      type="date"
                      value={c.expectedDate}
                      onChange={(e) => {
                        const n = [...sources];
                        n[i] = { ...c, expectedDate: e.target.value };
                        setSources(n);
                      }}
                    />
                  </td>
                  <td className="py-2 text-right">
                    <Button variant="ghost" onClick={() => setSources(sources.filter((_, k) => k !== i))}>
                      ×
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() =>
              setSources([
                ...sources,
                { label: "", kind: "receivable", amount: 0, currency: "PKR", expectedDate: "", note: "" },
              ])
            }
          >
            + add
          </Button>
          {plan.cash.usdRate > 0 && (
            <span className="text-[12px] text-muted">USD converted at {plan.cash.usdRate.toFixed(2)}</span>
          )}
        </div>
        <p className="mt-4 text-[12px] text-muted">
          The money-market fund ({fmtRs(plan.cash.fundValue)}) and broker cash ({fmtRs(plan.cash.brokerCash)}) are counted
          automatically — do not enter them here or they will be double counted.
        </p>
      </Section>

      {/* ---------------------------------------------------- manual signals */}
      <Section
        number="06"
        title="Your three judgements"
        description="Foreign flows, politics and breadth have no free feed worth trusting, so they stay yours. Score each from -2 to +2. Leaving one unset is honest; guessing it is not."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {MANUAL_SIGNALS.map((m) => {
            const set = manualByKey.get(m.key);
            return (
              <Card key={m.key}>
                <div className="label-cap mb-2">{m.label}</div>
                <Select
                  label=""
                  value={set ? String(set.score) : ""}
                  options={[
                    { value: "", label: "not set" },
                    ...m.options.map((o) => ({ value: String(o.score), label: `${o.score >= 0 ? "+" : ""}${o.score}  ${o.text}` })),
                  ]}
                  onChange={async (val) => {
                    const others = (pb.regimeManual ?? []).filter((x: any) => x.key !== m.key);
                    const next =
                      val === ""
                        ? others
                        : [
                            ...others,
                            { key: m.key, score: Number(val), note: "", setAt: new Date().toISOString().slice(0, 10) },
                          ];
                    await save({ regimeManual: next });
                  }}
                />
                {set?.setAt && <div className="mt-2 text-[11px] text-muted">set {set.setAt}</div>}
              </Card>
            );
          })}
        </div>
      </Section>

      {/* ------------------------------------------------------ weekly report */}
      <Section
        number="07"
        title="Weekly report"
        description="One page every Sunday: the regime, the money, the ladder, and the single instruction for the week. Sent to Telegram and email so it arrives whether or not you open the app."
      >
        <Card>
          <div className="space-y-4 max-w-lg">
            <Toggle
              label="Send the weekly plan"
              value={weeklyOn}
              onChange={async (v) => {
                setWeeklyOn(v);
                await save({ weeklyReportEnabled: v });
              }}
              hint="Sunday morning, deduped so a retry cannot send twice"
            />
            <TextInput
              label="Email it to"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
              hint="Leave blank to send to Telegram only"
            />
            <Button onClick={() => save({ weeklyReportEmail: email.trim() })} disabled={busy}>
              {busy ? "Saving" : "Save email"}
            </Button>
            <p className="text-[12px] text-muted">
              Telegram uses the bot token and chat id from Settings. If neither Telegram nor an email address is set, the
              report is skipped rather than queued.
            </p>
          </div>
        </Card>
      </Section>
    </>
  );
}
