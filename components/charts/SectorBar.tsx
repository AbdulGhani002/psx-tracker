"use client";

import { fmtPct, fmtRs } from "@/lib/format";

type Entry = { sector: string; value: number; percent: number };

const PALETTE = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

export function SectorBar({ entries }: { entries: Entry[] }) {
  return (
    <div>
      <div className="flex w-full h-7 mb-4 border border-ink">
        {entries.map((e, i) => (
          <div
            key={e.sector}
            title={`${e.sector}: ${fmtPct(e.percent / 100, 1)} (${fmtRs(e.value)})`}
            style={{
              width: `${e.percent}%`,
              background: PALETTE[i % PALETTE.length],
              borderRight: i === entries.length - 1 ? "0" : "1px solid var(--ink)",
            }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-[12px]">
        {entries.map((e, i) => (
          <li key={e.sector} className="flex items-baseline justify-between border-b border-rule py-1.5">
            <span className="flex items-baseline gap-2">
              <span
                className="inline-block w-2.5 h-2.5 mt-0.5"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span>{e.sector}</span>
            </span>
            <span className="font-mono mono-num">
              {fmtPct(e.percent / 100, 1)} <span className="text-muted ml-2">{fmtRs(e.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
