"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Create, rename, colour and remove portfolios. Rows recorded before
// portfolios existed sit in the default one; a portfolio with rows in it
// cannot be removed until they are moved.

type P = { _id: string; name: string; broker: string; kind: string; color: string; isDefault: boolean; notes: string };

const COLORS = ["#22c55e", "#3b82f6", "#a78bfa", "#f59e0b", "#22d3ee", "#f472b6", "#a3e635", "#94a3b8"];

export function PortfoliosManager({ initial }: { initial: P[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<P[]>(initial);
  const [name, setName] = useState("");
  const [broker, setBroker] = useState("");
  const [kind, setKind] = useState("mixed");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? data?.reason ?? `HTTP ${res.status}`);
    return data;
  }
  async function refresh() {
    const d = await call("/api/portfolios", "GET");
    setRows(d.portfolios);
    router.refresh();
  }
  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await call("/api/portfolios", "POST", { name: name.trim(), broker, kind });
      setName("");
      setBroker("");
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  async function update(id: string, patch: Partial<P>) {
    setBusy(true);
    setError(null);
    try {
      await call(`/api/portfolios/${id}`, "PATCH", patch);
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Remove this portfolio? It must be empty.")) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/api/portfolios/${id}`, "DELETE");
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const input = "rounded-lg px-3 py-2 text-[13px] w-full";
  const inputStyle = { background: "var(--surface-2)", border: "1px solid var(--rule)", color: "var(--ink)" } as const;

  return (
    <div id="portfolios">
      <div className="space-y-2">
        {rows.map((p) => (
          <div key={p._id} className="card card-pad flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button" title={c} onClick={() => update(p._id, { color: c })} className="w-4 h-4 rounded-full" style={{ background: c, outline: p.color === c ? "2px solid var(--ink)" : "none", outlineOffset: 1 }} />
              ))}
            </div>
            <input defaultValue={p.name} onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && update(p._id, { name: e.target.value.trim() })} className={`${input} max-w-[200px]`} style={inputStyle} />
            <input defaultValue={p.broker} placeholder="Broker or account" onBlur={(e) => e.target.value !== p.broker && update(p._id, { broker: e.target.value })} className={`${input} max-w-[200px]`} style={inputStyle} />
            <select value={p.kind} onChange={(e) => update(p._id, { kind: e.target.value })} className={`${input} max-w-[140px]`} style={inputStyle}>
              <option value="mixed">Mixed</option>
              <option value="equity">Equities</option>
              <option value="funds">Funds</option>
            </select>
            <div className="ml-auto flex items-center gap-3 text-[12px]">
              {p.isDefault ? <span className="pill" data-tone="positive">default</span> : <button type="button" className="link-underline" onClick={() => update(p._id, { isDefault: true })} disabled={busy}>make default</button>}
              {!p.isDefault && <button type="button" className="text-muted hover:text-[var(--negative)]" onClick={() => remove(p._id)} disabled={busy}>remove</button>}
            </div>
          </div>
        ))}
      </div>
      <div className="card card-pad mt-3">
        <div className="text-[13px] font-medium mb-2">New portfolio</div>
        <div className="flex gap-2 flex-wrap">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Trading book" className={`${input} max-w-[220px]`} style={inputStyle} />
          <input value={broker} onChange={(e) => setBroker(e.target.value)} placeholder="Broker (optional)" className={`${input} max-w-[200px]`} style={inputStyle} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${input} max-w-[140px]`} style={inputStyle}>
            <option value="mixed">Mixed</option>
            <option value="equity">Equities</option>
            <option value="funds">Funds</option>
          </select>
          <button type="button" className="btn-primary" onClick={create} disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
        <div className="text-[11.5px] text-muted mt-2">Trades, cash, funds and savings each carry a portfolio. New rows go to the portfolio the pages are showing, or the default. The Rebalance targets describe the whole book.</div>
        {error && <div className="text-[12px] mt-2" style={{ color: "var(--negative)" }}>{error}</div>}
      </div>
    </div>
  );
}
