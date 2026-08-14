"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Financial-year selector. Pushes ?fy=<endYear> so the year is shareable and
// survives a refresh; the server reads it and re-summarises.
export function FyPicker({
  years,
  active,
}: {
  years: Array<{ endYear: number; label: string }>;
  active: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function pick(endYear: number) {
    const next = new URLSearchParams(params.toString());
    next.set("fy", String(endYear));
    router.push(`/commodities?${next.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="label-cap mr-1">Financial year</span>
      {years.map((y) => {
        const on = y.endYear === active;
        return (
          <button
            key={y.endYear}
            type="button"
            onClick={() => pick(y.endYear)}
            aria-pressed={on}
            className="font-mono text-[12px] px-2.5 py-1 border transition-colors"
            style={{
              borderColor: on ? "var(--ink)" : "var(--rule)",
              background: on ? "var(--ink)" : "transparent",
              color: on ? "var(--paper)" : "var(--muted)",
            }}
          >
            {y.label}
          </button>
        );
      })}
    </div>
  );
}
