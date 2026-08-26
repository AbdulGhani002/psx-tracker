"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanyMark } from "@/components/ui/CompanyMark";
import { fmtRs } from "@/lib/format";

// What moved since you last looked.
//
// The comparison is against a snapshot taken in THIS browser at the end of the
// last visit, which is why it needs no schema and no server round-trip: the
// server sends today's zone statuses, and the browser holds yesterday's.
//
// It reports crossings, not prices. A position drifting inside its band is
// noise; a position that has crossed INTO a band is a decision waiting, and
// that is the only thing worth putting at the top of a page.
//
// First visit shows nothing rather than announcing all twenty positions as
// "new" — there is no previous state, so there is nothing that changed, and
// saying otherwise would train you to ignore the panel.

export type ZoneSnapshotRow = {
  symbol: string;
  sector: string;
  status: string;
  price: number | null;
  stale: boolean;
  hasPlan: boolean;
};

const KEY = "psx:zone-snapshot:v1";

type Stored = { at: string; rows: Record<string, { status: string; price: number | null }> };

const WORD: Record<string, string> = {
  buy: "entered its buy band",
  sell: "entered its sell band",
  between: "left its bands",
  no_zone: "has no band set",
  conflict: "has contradictory bands",
  unknown: "lost its price",
};

export function WhatChanged({ rows }: { rows: ZoneSnapshotRow[] }) {
  const [changes, setChanges] = useState<Array<{ row: ZoneSnapshotRow; was: string; note: string }> | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    let prev: Stored | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) prev = JSON.parse(raw) as Stored;
    } catch {
      prev = null; // a private window, or cleared storage: treat as a first visit
    }

    if (prev?.rows) {
      const found: Array<{ row: ZoneSnapshotRow; was: string; note: string }> = [];
      for (const r of rows) {
        const before = prev.rows[r.symbol];
        if (!before) continue; // a position opened since: not a "change", it is new
        if (before.status !== r.status) {
          found.push({ row: r, was: before.status, note: WORD[r.status] ?? `is now ${r.status}` });
        }
      }
      // Decisions first: a sell signal outranks a buy signal, which outranks
      // anything that merely stopped being actionable.
      const rank = (s: string) => (s === "sell" ? 0 : s === "buy" ? 1 : 2);
      found.sort((a, b) => rank(a.row.status) - rank(b.row.status));
      setChanges(found);
      setLastSeen(prev.at ?? null);
    } else {
      setChanges([]);
    }

    // Record today's state for the next visit, whatever we just displayed.
    try {
      const next: Stored = {
        at: new Date().toISOString(),
        rows: Object.fromEntries(rows.map((r) => [r.symbol, { status: r.status, price: r.price }])),
      };
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — the panel simply stays quiet next time */
    }
  }, [rows]);

  if (changes === null || changes.length === 0) return null;

  const seen = lastSeen ? new Date(lastSeen) : null;
  return (
    <section className="mt-10 fade-in-up">
      <div className="border-t-2 border-t-[var(--ink)] pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="section-eyebrow">Since you last looked</div>
          {seen && (
            <div className="label-cap">
              {seen.toISOString().slice(0, 10)} {seen.toTimeString().slice(0, 5)}
            </div>
          )}
        </div>
        <h2 className="font-display mt-2" style={{ fontSize: "clamp(22px, 3vw, 30px)", lineHeight: 1.1 }}>
          {changes.length} {changes.length === 1 ? "position has" : "positions have"} crossed a line you drew.
        </h2>
      </div>

      <ul className="mt-5 stagger">
        {changes.map(({ row, note }) => (
          <li key={row.symbol} className="flex items-center gap-3 py-2.5 border-b border-[var(--rule)] row-hover">
            <CompanyMark symbol={row.symbol} sector={row.sector} size="sm" />
            <Link href={`/holdings/${row.symbol}`} className="font-mono text-[13px] font-medium link-underline">
              {row.symbol}
            </Link>
            <span
              className="text-[13px]"
              style={{
                color:
                  row.status === "buy"
                    ? "var(--positive)"
                    : row.status === "sell"
                      ? "var(--negative)"
                      : "var(--muted)",
              }}
            >
              {note}
            </span>
            <span className="ml-auto mono-num text-[13px]">
              {row.price != null ? fmtRs(row.price, true) : <span className="text-muted">no price</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
