"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// Jump anywhere by typing. In an app with sixteen pages and two dozen open
// positions, the nav is a compromise — this is the direct route: Ctrl/Cmd-K,
// type three letters, Enter.
//
// The holdings index is fetched ONCE, lazily, the first time the palette is
// opened, so it costs nothing on a page load where it is never used.

type Item = {
  id: string;
  label: string;
  hint: string;
  group: "Positions" | "Pages" | "Actions";
  href: string;
  // Some actions open a sheet in place rather than navigating anywhere.
  event?: string;
};

const PAGES: Item[] = [
  { id: "p-overview", label: "Overview", hint: "net worth, attribution", group: "Pages", href: "/" },
  { id: "p-holdings", label: "Holdings", hint: "every position", group: "Pages", href: "/holdings" },
  { id: "p-decisions", label: "Decisions", hint: "sell discipline, scorecard", group: "Pages", href: "/decisions" },
  { id: "p-wealth", label: "Wealth", hint: "statement of assets", group: "Pages", href: "/wealth" },
  { id: "p-transactions", label: "Transactions", hint: "the ledger", group: "Pages", href: "/transactions" },
  { id: "p-funds", label: "Mutual funds & savings", hint: "iSave, cash discipline", group: "Pages", href: "/funds" },
  { id: "p-dividends", label: "Dividends", hint: "warrants and payouts", group: "Pages", href: "/dividends" },
  { id: "p-rebalance", label: "Rebalance", hint: "targets vs actual, deployment", group: "Pages", href: "/rebalance" },
  { id: "p-rotation", label: "Sector rotation", hint: "where money is moving", group: "Pages", href: "/rotation" },
  { id: "p-report", label: "Statement (PDF)", hint: "printable", group: "Pages", href: "/report" },
  { id: "p-changelog", label: "Changelog", hint: "what changed, and why", group: "Pages", href: "/changelog" },
  { id: "p-settings", label: "Settings", hint: "tax, alerts, backup", group: "Pages", href: "/settings" },
];

const ACTIONS: Item[] = [
  { id: "a-buy", label: "Record a buy", hint: "add to a position, without leaving the page", group: "Actions", href: "/transactions/new", event: "psx:quick-add" },
  { id: "a-full", label: "Record a sell or a new position", hint: "the full form, with its plan and decision gates", group: "Actions", href: "/transactions/new" },
  { id: "a-import", label: "Import trades", hint: "CSV or contract note", group: "Actions", href: "/transactions/import" },
  { id: "a-dividend", label: "Upload a dividend warrant", hint: "parse a CDC PDF", group: "Actions", href: "/dividends" },
];

// Subsequence match: "ahc" finds AHCL, "muref" finds MUREB, "rebal" finds
// Rebalance. Score prefers earlier and tighter matches so the obvious answer
// sorts first rather than merely appearing somewhere in the list.
function score(needle: string, hay: string): number | null {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (h.startsWith(n)) return 1000 - h.length;
  let hi = 0, first = -1, gaps = 0, last = -1;
  for (const ch of n) {
    const idx = h.indexOf(ch, hi);
    if (idx === -1) return null;
    if (first === -1) first = idx;
    if (last !== -1 && idx > last + 1) gaps++;
    last = idx;
    hi = idx + 1;
  }
  return 500 - first * 6 - gaps * 12 - h.length;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [positions, setPositions] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setCursor(0);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") close();
    }
    // The nav button opens it too — a keyboard-only affordance is invisible to
    // anyone who has not been told it exists.
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("psx:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("psx:open-palette", onOpen);
    };
  }, [close]);

  // Lazy: the index is only worth fetching once someone actually opens this.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    fetch("/api/holdings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const rows: Array<{ symbol?: string; name?: string; currentShares?: number }> = d?.holdings ?? [];
        setPositions(
          rows
            .filter((h) => (h.currentShares ?? 0) > 0)
            .map((h) => ({
              id: `h-${h.symbol}`,
              label: String(h.symbol ?? ""),
              hint: h.name ? String(h.name) : "position",
              group: "Positions" as const,
              href: `/holdings/${h.symbol}`,
            }))
        );
      })
      .catch(() => {
        /* the palette still navigates pages without the index */
      });
  }, [open, loaded]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const results = useMemo(() => {
    const all = [...positions, ...PAGES, ...ACTIONS];
    if (!q.trim()) return all.slice(0, 12);
    return all
      .map((it) => {
        const s = Math.max(score(q, it.label) ?? -1e9, (score(q, it.hint) ?? -1e9) - 200);
        return { it, s };
      })
      .filter((r) => r.s > -1e8)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.it);
  }, [q, positions]);

  useEffect(() => {
    setCursor(0);
  }, [q]);

  function go(item: Item | undefined) {
    if (!item) return;
    close();
    if (item.event) {
      // Let the palette finish closing before the sheet claims focus.
      requestAnimationFrame(() => window.dispatchEvent(new Event(item.event!)));
      return;
    }
    router.push(item.href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[cursor]);
    }
  }

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  let lastGroup = "";
  return (
    <div
      className="fixed inset-0 z-50 overlay-in"
      style={{ background: "color-mix(in srgb, var(--ink) 38%, transparent)" }}
      onMouseDown={close}
      role="dialog"
      aria-modal="true"
      aria-label="Jump to"
    >
      <div
        className="max-w-[560px] mx-auto mt-[12vh] panel-in"
        style={{ background: "var(--paper)", border: "1px solid var(--ink)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--rule)]">
          <span className="label-cap shrink-0">Jump to</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="a symbol, a page, an action…"
            className="flex-1 bg-transparent outline-none text-[15px]"
            style={{ color: "var(--ink)" }}
            aria-label="Search"
          />
          <kbd className="label-cap shrink-0" style={{ color: "var(--muted)" }}>Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-[13px] text-muted">Nothing matches “{q}”.</div>
          )}
          {results.map((it, i) => {
            const head = it.group !== lastGroup ? ((lastGroup = it.group), it.group) : null;
            const active = i === cursor;
            return (
              <div key={it.id}>
                {head && <div className="label-cap px-4 pt-3 pb-1">{head}</div>}
                <button
                  data-idx={i}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(it)}
                  className="w-full text-left px-4 py-2 flex items-baseline gap-3"
                  style={{ background: active ? "var(--paper-2)" : "transparent" }}
                >
                  <span
                    className={it.group === "Positions" ? "mono-num text-[14px]" : "text-[14px]"}
                    style={{ color: "var(--ink)", fontWeight: active ? 500 : 400 }}
                  >
                    {it.label}
                  </span>
                  <span className="text-[12px] truncate" style={{ color: "var(--muted)" }}>
                    {it.hint}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-[var(--rule)] flex gap-4">
          <span className="label-cap">↑↓ move</span>
          <span className="label-cap">↵ open</span>
        </div>
      </div>
    </div>
  );
}
