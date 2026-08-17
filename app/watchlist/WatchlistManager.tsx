"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum } from "@/lib/format";
import { describeZone, type ZoneStatus } from "@/lib/calculations/zones";

export type Row = {
  _id: string;
  symbol: string;
  name: string;
  sector: string;
  notes: string;
  price: number | null;
  priceAgeDays: number | null;
  priceStale: boolean;
  buyZoneLow: number | null;
  buyZoneHigh: number | null;
  sellZoneLow: number | null;
  sellZoneHigh: number | null;
  minSellShares: number;
  alertsOn: boolean;
  status: ZoneStatus;
  sharesHeld: number;
  positionValue: number;
  targetPct: number;
  suggestSell: boolean;
  toBuyPct: number | null;
  toSellPct: number | null;
  warnings: string[];
};

type Draft = {
  buyZoneLow: string;
  buyZoneHigh: string;
  sellZoneLow: string;
  sellZoneHigh: string;
  minSellShares: string;
};

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
};

function draftOf(r: Row): Draft {
  return {
    buyZoneLow: r.buyZoneLow?.toString() ?? "",
    buyZoneHigh: r.buyZoneHigh?.toString() ?? "",
    sellZoneLow: r.sellZoneLow?.toString() ?? "",
    sellZoneHigh: r.sellZoneHigh?.toString() ?? "",
    minSellShares: r.minSellShares ? String(r.minSellShares) : "",
  };
}

function StatusBadge({ r }: { r: Row }) {
  if (r.status === "buy") return <Badge tone="positive">BUY ZONE</Badge>;
  if (r.suggestSell) return <Badge tone="negative">SELL ZONE</Badge>;
  if (r.status === "sell") return <Badge tone="amber">SELL — TOO SMALL</Badge>;
  if (r.status === "conflict") return <Badge tone="amber">CHECK ZONES</Badge>;
  if (r.status === "unknown") return <Badge tone="default">NO PRICE</Badge>;
  if (r.status === "no_zone") return <Badge tone="default">NO ZONES SET</Badge>;
  return <span className="text-muted text-[11px] font-mono">waiting</span>;
}

export function WatchlistManager({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newDraft, setNewDraft] = useState<Draft>({ buyZoneLow: "", buyZoneHigh: "", sellZoneLow: "", sellZoneHigh: "", minSellShares: "" });

  function payload(d: Draft) {
    return {
      buyZoneLow: numOrNull(d.buyZoneLow),
      buyZoneHigh: numOrNull(d.buyZoneHigh),
      sellZoneLow: numOrNull(d.sellZoneLow),
      sellZoneHigh: numOrNull(d.sellZoneHigh),
      minSellShares: d.minSellShares.trim() === "" ? 0 : Math.max(0, Number(d.minSellShares)),
    };
  }

  async function handle(res: Response, okText: string) {
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg({ kind: "ok", text: okText });
      router.refresh();
      return true;
    }
    if (body?.error === "zone_conflict") {
      setMsg({ kind: "err", text: body.problems?.join(" ") ?? "Those zones contradict each other." });
    } else if (body?.error === "exists") {
      setMsg({ kind: "err", text: `${body.symbol} is already on the watchlist.` });
    } else {
      setMsg({ kind: "err", text: body?.detail || body?.error || "Failed." });
    }
    return false;
  }

  async function save(symbol: string) {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/watchlist/${symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload(draft)),
      });
      if (await handle(res, `${symbol} zones saved.`)) {
        setEditing(null);
        setDraft(null);
      }
    } catch {
      setMsg({ kind: "err", text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym, ...payload(newDraft) }),
      });
      if (await handle(res, `${sym} added.`)) {
        setNewSymbol("");
        setNewDraft({ buyZoneLow: "", buyZoneHigh: "", sellZoneLow: "", sellZoneHigh: "", minSellShares: "" });
        setAdding(false);
      }
    } catch {
      setMsg({ kind: "err", text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  async function remove(symbol: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/watchlist/${symbol}`, { method: "DELETE" });
      await handle(res, `${symbol} removed.`);
    } catch {
      setMsg({ kind: "err", text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  async function toggleAlerts(r: Row) {
    setBusy(true);
    try {
      const res = await fetch(`/api/watchlist/${r.symbol}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alertsOn: !r.alertsOn }),
      });
      await handle(res, `${r.symbol} alerts ${r.alertsOn ? "muted" : "on"}.`);
    } finally {
      setBusy(false);
    }
  }

  const zoneInputs = (d: Draft, set: (d: Draft) => void) => (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {([
        ["buyZoneLow", "Buy from (optional)"],
        ["buyZoneHigh", "Buy up to"],
        ["sellZoneLow", "Sell from"],
        ["sellZoneHigh", "Sell up to (optional)"],
        ["minSellShares", "Min shares to sell"],
      ] as Array<[keyof Draft, string]>).map(([k, label]) => (
        <div key={k}>
          <label className="label-cap block mb-1">{label}</label>
          <div className="border-b border-ink">
            <input
              type="number"
              step={k === "minSellShares" ? 1 : 0.01}
              min={0}
              value={d[k]}
              onChange={(e) => set({ ...d, [k]: e.target.value })}
              placeholder="—"
              className="w-full bg-transparent font-mono mono-num text-[14px] py-1.5 focus:outline-none"
            />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      {msg && (
        <div
          className="text-[13px] border-l-2 pl-3 py-1"
          style={{ borderColor: msg.kind === "ok" ? "var(--positive)" : "var(--negative)" }}
        >
          {msg.text}
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-1">
          <div className="label-cap">Add a stock to watch</div>
          <Button variant="outline" onClick={() => setAdding(!adding)}>
            {adding ? "Cancel" : "Add stock"}
          </Button>
        </div>
        {adding && (
          <div className="mt-4 space-y-4">
            <div className="max-w-[220px]">
              <label className="label-cap block mb-1">Symbol</label>
              <div className="border-b border-ink">
                <input
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g. LUCK"
                  className="w-full bg-transparent font-mono text-[15px] py-1.5 focus:outline-none uppercase"
                />
              </div>
            </div>
            {zoneInputs(newDraft, setNewDraft)}
            <p className="text-[11px] text-muted max-w-[70ch]">
              Leave a bound blank for an open end: a buy zone with only an upper bound means
              &ldquo;buy at or under this&rdquo;, and a sell zone with only a lower bound means
              &ldquo;sell at or above this&rdquo;. The minimum is a size floor — no sell is ever
              suggested unless you hold MORE than that many shares.
            </p>
            <Button variant="solid" onClick={add} disabled={busy || !newSymbol.trim()}>
              {busy ? "Saving…" : "Add to watchlist"}
            </Button>
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <Card>
          <p className="text-[13px] text-muted">
            Nothing on the watchlist yet. Add a symbol with the price band you would buy in and the band
            you would sell in — the app will watch it and message you on Telegram when it gets there.
          </p>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-t border-b border-ink">
                {["Symbol", "Price", "Buy zone", "Sell zone", "Min sell", "Held", "Status", ""].map((h, i) => (
                  <th
                    key={h || i}
                    className="px-2 py-2 font-mono text-[10px] uppercase tracking-stat text-muted font-medium"
                    style={{ textAlign: i === 0 ? "left" : i >= 6 ? "left" : "right" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isEditing = editing === r.symbol;
                return (
                  <Fragment key={r.symbol}>
                    <tr className="border-b border-rule">
                      <td className="px-2 py-2.5">
                        <Link href={`/stock/${r.symbol}`} className="font-mono font-medium hover:text-[var(--accent-deep)]">
                          {r.symbol}
                        </Link>
                        {!r.alertsOn && <span className="ml-2 text-[10px] font-mono text-muted">muted</span>}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num">
                        {r.price == null ? (
                          <span className="text-muted">unknown</span>
                        ) : (
                          <>
                            {fmtRs(r.price, true)}
                            {r.priceStale && <span className="ml-1 text-[10px]" style={{ color: "var(--accent-deep)" }}>stale</span>}
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num text-muted">
                        {describeZone(r.buyZoneLow, r.buyZoneHigh, "buy")}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num text-muted">
                        {describeZone(r.sellZoneLow, r.sellZoneHigh, "sell")}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num text-muted">
                        {r.minSellShares > 0 ? fmtNum(r.minSellShares) : "—"}
                      </td>
                      <td className="px-2 py-2.5 text-right font-mono mono-num">
                        {r.sharesHeld > 0 ? fmtNum(r.sharesHeld) : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-2 py-2.5"><StatusBadge r={r} /></td>
                      <td className="px-2 py-2.5 text-right whitespace-nowrap">
                        <button
                          className="label-cap hover:text-[var(--accent-deep)]"
                          onClick={() => {
                            setEditing(isEditing ? null : r.symbol);
                            setDraft(isEditing ? null : draftOf(r));
                            setMsg(null);
                          }}
                        >
                          {isEditing ? "Close" : "Edit"}
                        </button>
                        <span className="text-muted mx-1.5">·</span>
                        <button className="label-cap hover:text-[var(--accent-deep)]" onClick={() => toggleAlerts(r)} disabled={busy}>
                          {r.alertsOn ? "Mute" : "Unmute"}
                        </button>
                      </td>
                    </tr>
                    {r.warnings.length > 0 && (
                      <tr key={`${r.symbol}-warn`}>
                        <td colSpan={8} className="px-2 pb-2 text-[12px]" style={{ color: "var(--negative)" }}>
                          {r.warnings.join(" ")}
                        </td>
                      </tr>
                    )}
                    {isEditing && draft && (
                      <tr key={`${r.symbol}-edit`}>
                        <td colSpan={8} className="px-2 py-4" style={{ background: "var(--paper-2)" }}>
                          <div className="space-y-4">
                            {zoneInputs(draft, setDraft)}
                            <div className="flex items-center gap-3">
                              <Button variant="solid" onClick={() => save(r.symbol)} disabled={busy}>
                                {busy ? "Saving…" : "Save zones"}
                              </Button>
                              <button
                                className="label-cap hover:text-[var(--negative)]"
                                onClick={() => remove(r.symbol)}
                                disabled={busy}
                              >
                                Remove from watchlist
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
