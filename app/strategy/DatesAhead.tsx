"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";

// The dated events the evening brief names (MPC, CPI, results deadlines,
// futures expiries, holidays, index reviews, the IMF, the FOMC): the next
// 120 days, kept in the database, added to and removed here.

type Row = { id: string; date: string; title: string; kind: string; about: boolean };
const KINDS = ["mpc", "cpi", "results", "expiry", "holiday", "index", "imf", "budget", "world", "other"] as const;
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function DatesAhead() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("other");
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => fetch("/api/market-events").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || title.trim().length < 2) return setMsg("A date and a title.");
    const res = await fetch("/api/market-events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, title: title.trim(), kind }) }).catch(() => null);
    setMsg(res?.ok ? null : "Could not add it.");
    if (res?.ok) {
      setTitle("");
      load();
    }
  }
  async function remove(id: string) {
    await fetch(`/api/market-events?id=${id}`, { method: "DELETE" }).catch(() => null);
    load();
  }

  return (
    <Card className="mt-3" title="Dates ahead" action={<span className="text-[12px] text-muted">The evening brief names the week&apos;s</span>}>
      {rows == null ? (
        <p className="text-[12.5px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">No dates in the next 120 days.</p>
      ) : (
        <ul className="text-[13px] divide-y divide-[var(--rule)]">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-1.5">
              <span className="mono-num text-muted w-32 shrink-0">{r.about ? "≈ " : ""}{day(r.date)}</span>
              <span className="flex-1">{r.title}</span>
              <span className="text-[11px] text-muted">{r.kind}</span>
              <button type="button" className="text-[12px] link-underline" onClick={() => remove(r.id)} aria-label={`Remove ${r.title}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-3 text-[13px]">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field !py-1" aria-label="Date" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="field !py-1 w-64" placeholder="MPC, budget, a holiday…" aria-label="What" />
        <select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} className="field !py-1" aria-label="Kind">
          {KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <button type="button" className="btn-primary !py-1.5 text-[13px]" onClick={add}>Add</button>
        {msg && <span className="text-[12.5px] text-muted">{msg}</span>}
      </div>
    </Card>
  );
}
