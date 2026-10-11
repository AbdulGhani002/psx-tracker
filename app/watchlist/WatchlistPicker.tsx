"use client";

import { useMemo, useRef, useState } from "react";

// Every listed share by sector, with a tick for each share and each sector.
// A tick shows at once and is saved in the background, one at a time; if the
// save fails the tick goes back and says so.

export type PickRow = { symbol: string; name: string; price: number | null; pe: number | null; grade: string | null; held: boolean };
export type PickGroup = { key: string; name: string; rows: PickRow[] };

const price = (v: number | null) => (v == null ? "" : v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2));

export function WatchlistPicker({ groups, initial }: { groups: PickGroup[]; initial: { symbols: string[]; sectors: string[] } }) {
  const [symbols, setSymbols] = useState(() => new Set(initial.symbols));
  const [sectors, setSectors] = useState(() => new Set(initial.sectors));
  const [query, setQuery] = useState("");
  const [onlyTicked, setOnlyTicked] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const latest = useRef(0);

  async function toggle(kind: "symbol" | "sector", value: string, on: boolean) {
    const set = kind === "symbol" ? setSymbols : setSectors;
    set((s) => {
      const n = new Set(s);
      if (on) n.add(value);
      else n.delete(value);
      return n;
    });
    const seq = ++latest.current;
    setStatus("saving");
    try {
      const res = await fetch("/api/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, value, on }) });
      if (!res.ok) throw new Error(String(res.status));
      const saved = (await res.json()) as { symbols: string[]; sectors: string[] };
      if (seq === latest.current) {
        setSymbols(new Set(saved.symbols));
        setSectors(new Set(saved.sectors));
        setStatus("saved");
      }
    } catch {
      set((s) => {
        const n = new Set(s);
        if (on) n.delete(value);
        else n.add(value);
        return n;
      });
      setStatus("error");
    }
  }

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      groups
        .map((g) => {
          const sectorOn = sectors.has(g.key);
          const rows = g.rows.filter((r) => (!q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) && (!onlyTicked || symbols.has(r.symbol)));
          return { g, rows, sectorOn, ticked: g.rows.filter((r) => symbols.has(r.symbol)).length };
        })
        .filter((x) => x.rows.length > 0 || (onlyTicked && x.sectorOn && !q)),
    [groups, q, onlyTicked, symbols, sectors]
  );

  const flip = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div className="space-y-3">
      <div className="card card-pad flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a share or sector"
          className="flex-1 min-w-[180px] bg-transparent border-b border-ink py-1.5 text-[14px] focus:outline-none"
        />
        <label className="inline-flex items-center gap-2 text-[13px] cursor-pointer select-none">
          <input type="checkbox" checked={onlyTicked} onChange={(e) => setOnlyTicked(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
          Ticked only
        </label>
        <span className="text-[13px] mono-num">
          {symbols.size} {symbols.size === 1 ? "share" : "shares"} · {sectors.size} {sectors.size === 1 ? "sector" : "sectors"}
        </span>
        <span className="text-[12px]" style={{ color: status === "error" ? "var(--negative)" : "var(--muted)" }} aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Not saved, try again" : ""}
        </span>
      </div>

      {shown.length === 0 && <div className="card card-pad text-[13px] text-muted">{onlyTicked ? "Nothing ticked yet." : "No share matches."}</div>}

      {shown.map(({ g, rows, sectorOn, ticked }) => {
        const expanded = !!q || onlyTicked || open.has(g.key);
        return (
          <div key={g.key} className="card">
            <div className="flex items-center gap-3 px-4 py-3">
              <input
                type="checkbox"
                checked={sectorOn}
                onChange={(e) => toggle("sector", g.key, e.target.checked)}
                aria-label={`Watch the ${g.name} sector`}
                className="w-4 h-4 shrink-0 accent-[var(--accent)]"
              />
              <button type="button" onClick={() => flip(g.key)} className="flex-1 min-w-0 flex items-center justify-between gap-3 text-left" aria-expanded={expanded}>
                <span className="font-semibold text-[14px] truncate">{g.name}</span>
                <span className="text-[12px] text-muted mono-num whitespace-nowrap">
                  {ticked > 0 ? `${ticked} of ${g.rows.length}` : g.rows.length} <span aria-hidden>{expanded ? "▴" : "▾"}</span>
                </span>
              </button>
            </div>
            {expanded && rows.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 border-t border-rule">
                {rows.map((r) => (
                  <label key={r.symbol} className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[var(--surface-2)]">
                    <input type="checkbox" checked={symbols.has(r.symbol)} onChange={(e) => toggle("symbol", r.symbol, e.target.checked)} className="w-4 h-4 shrink-0 accent-[var(--accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="font-semibold text-[13.5px]">{r.symbol}</span>
                        {r.held && <span className="pill" data-tone="positive">held</span>}
                        {r.grade && <span className="text-[11px] text-muted">grade {r.grade}</span>}
                      </span>
                      <span className="block text-[11.5px] text-muted truncate">{r.name}</span>
                    </span>
                    <span className="text-right text-[12px] mono-num whitespace-nowrap">
                      {price(r.price)}
                      {r.pe != null && r.pe > 0 && <span className="block text-[11px] text-muted">P/E {r.pe.toFixed(1)}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
