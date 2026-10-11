"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SectorGroup } from "@/lib/watchlist";

// The sectors to tick. A tick changes nothing until Save, which writes the
// whole list to the database; a bar at the bottom says how many changes wait.
// The page reads the saved list again when it opens, so a cached page can
// never show an old one, and leaving with changes unsaved asks first.

type Status = "idle" | "saving" | "saved" | "error";

const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export function SectorPicker({ groups, initial }: { groups: SectorGroup[]; initial: string[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => new Set(initial));
  const [draft, setDraft] = useState(() => new Set(initial));
  const [query, setQuery] = useState("");
  const [onlyTicked, setOnlyTicked] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [reading, setReading] = useState(0);
  const dirty = !same(saved, draft);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const changes = [...draft].filter((x) => !saved.has(x)).length + [...saved].filter((x) => !draft.has(x)).length;

  useEffect(() => {
    let live = true;
    fetch("/api/watchlist", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { sectors: string[] } | null) => {
        if (!live || !d || dirtyRef.current) return;
        setSaved(new Set(d.sectors));
        setDraft(new Set(d.sectors));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/watchlist", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sectors: [...draft] }) });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { sectors: string[]; reading?: number };
      setSaved(new Set(d.sectors));
      setDraft(new Set(d.sectors));
      setReading(d.reading ?? 0);
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }, [draft, router]);

  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus("idle"), reading > 0 ? 5000 : 2500);
    return () => clearTimeout(t);
  }, [status, reading]);

  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || to.pathname === location.pathname) return;
      if (!confirm("Leave without saving your sectors?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key);
    };
  }, [dirty, save]);

  const flip = (key: string, on: boolean) => {
    setDraft((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
    if (status !== "saving") setStatus("idle");
  };

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      groups
        .map((g) => {
          const hit = !q || g.name.toLowerCase().includes(q) ? null : g.shares.find(([s, n]) => s.toLowerCase().startsWith(q) || n.toLowerCase().includes(q));
          return { g, hit, match: !q || g.name.toLowerCase().includes(q) || !!hit };
        })
        .filter((x) => x.match && (!onlyTicked || draft.has(x.g.key))),
    [groups, q, onlyTicked, draft]
  );
  const watched = groups.filter((g) => draft.has(g.key)).reduce((n, g) => n + g.shares.length, 0);

  return (
    <div className="space-y-3 pb-24">
      <div className="card card-pad flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a sector or a share"
          className="flex-1 min-w-[180px] bg-transparent border-b border-ink py-1.5 text-[14px] focus:outline-none"
        />
        <label className="inline-flex items-center gap-2 text-[13px] cursor-pointer select-none">
          <input type="checkbox" checked={onlyTicked} onChange={(e) => setOnlyTicked(e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
          Ticked only
        </label>
        <span className="text-[13px] mono-num">
          {draft.size} {draft.size === 1 ? "sector" : "sectors"} · {watched} shares
        </span>
      </div>

      {shown.length === 0 && <div className="card card-pad text-[13px] text-muted">{onlyTicked ? "Nothing ticked yet." : "No sector or share matches."}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {shown.map(({ g, hit }) => {
          const on = draft.has(g.key);
          const changed = on !== saved.has(g.key);
          return (
            <label
              key={g.key}
              className="card flex items-start gap-3 px-4 py-3 cursor-pointer select-none hover:bg-[var(--surface-2)]"
              style={on ? { borderColor: "var(--accent)" } : undefined}
            >
              <input type="checkbox" checked={on} onChange={(e) => flip(g.key, e.target.checked)} className="w-4 h-4 mt-0.5 shrink-0 accent-[var(--accent)]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[14px] truncate">{g.name}</span>
                  <span className="text-[12px] text-muted mono-num whitespace-nowrap">{g.shares.length}</span>
                </span>
                {hit && <span className="block text-[11.5px] text-muted truncate">Has {hit[0]}, {hit[1]}</span>}
                {g.held.length > 0 && <span className="block text-[11.5px] truncate" style={{ color: "var(--positive)" }}>Held: {g.held.join(", ")}</span>}
                {changed && <span className="block text-[11px] text-muted">{on ? "Added, not saved" : "Removed, not saved"}</span>}
              </span>
            </label>
          );
        })}
      </div>

      {(dirty || status !== "idle") && (
        <div className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] lg:bottom-0 z-50 flex justify-center px-4 pb-3 lg:pb-4 pointer-events-none">
          <div className="pointer-events-auto card flex items-center gap-3 pl-4 pr-2 py-2" style={{ boxShadow: "0 8px 28px rgba(15,23,42,.22)" }} role="status" aria-live="polite">
            {status === "saved" && !dirty ? (
              <span className="text-[13.5px] pr-2">
                <span className="font-semibold" style={{ color: "var(--positive)" }}>✓ Saved</span>
                {reading > 0 && <span className="text-muted"> · figures for {reading} new shares in a few minutes</span>}
              </span>
            ) : (
              <>
                <span className="text-[13.5px] whitespace-nowrap" style={status === "error" ? { color: "var(--negative)" } : undefined}>
                  {status === "saving" ? "Saving…" : status === "error" ? "Not saved. Try again." : `${changes} ${changes === 1 ? "change" : "changes"}`}
                </span>
                <button type="button" className="btn-ghost !py-1.5 text-[13px]" disabled={status === "saving"} onClick={() => { setDraft(new Set(saved)); setStatus("idle"); }}>
                  Discard
                </button>
                <button type="button" className="btn-primary !py-1.5 text-[13px]" disabled={status === "saving" || !dirty} onClick={save}>
                  Save
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
