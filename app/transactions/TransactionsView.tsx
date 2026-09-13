"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { fmtRs, fmtNum, fmtDate } from "@/lib/format";
import { TRANSACTION_TYPES, type Transaction } from "@/lib/types";

type Props = {
  transactions: Transaction[];
  symbols: string[];
};

function toCsv(rows: Transaction[]): string {
  const header = [
    "date",
    "symbol",
    "type",
    "shares",
    "pricePerShare",
    "totalAmount",
    "fees",
    "netAmount",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      new Date(r.date).toISOString().slice(0, 10),
      r.symbol,
      r.type,
      String(r.shares),
      String(r.pricePerShare),
      String(r.totalAmount),
      String(r.fees),
      String(r.netAmount),
      `"${(r.notes ?? "").replace(/"/g, '""')}"`,
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

const PAGE_SIZES = [50, 100, 250, 0]; // 0 = everything, for the rare full read

export function TransactionsView({ transactions, symbols }: Props) {
  const router = useRouter();
  const [symbolFilter, setSymbolFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [restoring, setRestoring] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (symbolFilter && t.symbol !== symbolFilter) return false;
      if (typeFilter && t.type !== typeFilter) return false;
      if (q) {
        const hay = `${t.symbol} ${t.type} ${t.notes ?? ""} ${fmtDate(t.date)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, symbolFilter, typeFilter, query]);

  // A full ledger drawn in one go was 19,000 pixels of DOM: slow to paint,
  // impossible to scan, and unusable on a phone. Filtering, counting and the
  // CSV export still run on the WHOLE filtered set. Only the drawing is paged.
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount);
  const visible = useMemo(
    () => (pageSize === 0 ? filtered : filtered.slice((current - 1) * pageSize, current * pageSize)),
    [filtered, current, pageSize]
  );

  // Changing what you are looking at sends you back to page one. Otherwise you
  // land on an empty page 7 of a 2-page result and conclude the filter is broken.
  function refilter(fn: () => void) {
    fn();
    setPage(1);
  }

  async function onDelete(t: Transaction) {
    const id = String(t._id);
    if (!confirm("Move this transaction to Trash? Holding values recompute now; you can restore it later.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setUndo({ id, label: `${t.type} ${t.symbol} (${fmtDate(t.date)})` });
        router.refresh();
      }
    } finally {
      setDeleting(null);
    }
  }

  async function onUndo() {
    if (!undo) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/transactions/${undo.id}/restore`, { method: "POST" });
      if (res.ok) {
        setUndo(null);
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d?.detail ?? "Could not restore.");
      }
    } finally {
      setRestoring(false);
    }
  }

  function exportCsv() {
    const blob = new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const TYPE_LABEL: Record<string, { text: string; tone: "accent" | "negative" | "positive" | "amber" | "default" }> = {
    BUY: { text: "Buy", tone: "accent" },
    SELL: { text: "Sell", tone: "negative" },
    DIVIDEND: { text: "Dividend", tone: "positive" },
    BONUS: { text: "Bonus", tone: "amber" },
    RIGHT: { text: "Right", tone: "amber" },
    SPLIT: { text: "Split", tone: "default" },
  };

  const columns: Column<Transaction>[] = [
    { key: "date", header: "Date", render: (t) => <span className="mono-num text-[12px] text-muted">{fmtDate(t.date)}</span> },
    {
      key: "symbol",
      header: "Symbol",
      render: (t) => (
        <Link href={`/holdings/${t.symbol}`} className="font-semibold hover:text-[var(--accent)]">
          {t.symbol}
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (t) => (
        <span className="inline-flex items-center gap-1.5">
          <Badge tone={TYPE_LABEL[t.type]?.tone ?? "default"}>{TYPE_LABEL[t.type]?.text ?? t.type}</Badge>
          {t.source === "auto" && <span className="pill" data-tone="muted" title="Recorded from the PSX announcement; a warrant replaces it">Auto</span>}
        </span>
      ),
    },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (t) => fmtNum(Math.abs(t.shares)) },
    { key: "price", header: "Price", align: "right", mono: true, render: (t) => fmtRs(t.pricePerShare, true) },
    { key: "fees", header: "Fees", align: "right", mono: true, render: (t) => <span className="text-muted">{fmtRs(t.fees)}</span> },
    {
      key: "net",
      header: "Net",
      align: "right",
      mono: true,
      render: (t) => <span style={{ color: t.type === "DIVIDEND" || t.type === "SELL" ? "var(--positive)" : undefined }}>{fmtRs(t.netAmount)}</span>,
    },
    { key: "notes", header: "Notes", render: (t) => <span className="text-[12px] text-muted line-clamp-1 max-w-[220px]">{t.notes}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (t) => (
        <div className="flex items-center justify-end gap-1">
          <Link href={`/transactions/${String(t._id)}/edit`} className="text-[12px] text-muted hover:text-ink px-2 py-1 rounded-lg hover:bg-[var(--surface-3)]">
            Edit
          </Link>
          <button onClick={() => onDelete(t)} disabled={deleting === String(t._id)} className="text-[12px] text-muted hover:text-[var(--negative)] px-2 py-1 rounded-lg hover:bg-[var(--surface-3)]">
            {deleting === String(t._id) ? "…" : "Delete"}
          </button>
        </div>
      ),
    },
  ];

  const pageBtn = "text-[12px] px-2.5 py-1 rounded-lg disabled:opacity-30 hover:bg-[var(--surface-2)]";

  return (
    <div className="space-y-4">
      {undo && (
        <div className="card card-pad flex items-center justify-between gap-3 !py-3">
          <span className="text-[13px]">
            Moved <span className="font-semibold">{undo.label}</span> to Trash.
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onUndo} disabled={restoring} className="btn-ghost !py-1 text-[12px]" style={{ color: "var(--accent)" }}>
              {restoring ? "Restoring…" : "Undo"}
            </button>
            <button onClick={() => setUndo(null)} className="text-[12px] text-muted hover:text-ink px-2">
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="field !min-h-[36px] w-[150px] relative">
          <select value={symbolFilter} onChange={(e) => refilter(() => setSymbolFilter(e.target.value))} className="!py-1.5 text-[13px]">
            <option value="">All symbols</option>
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <svg className="field-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </div>
        <div className="seg">
          <button type="button" data-active={typeFilter === ""} onClick={() => refilter(() => setTypeFilter(""))}>All</button>
          {TRANSACTION_TYPES.map((t) => (
            <button key={t} type="button" data-active={typeFilter === t} onClick={() => refilter(() => setTypeFilter(t))}>{TYPE_LABEL[t]?.text ?? t}</button>
          ))}
        </div>
        <div className="field !min-h-[36px] w-[220px]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted shrink-0" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={query} onChange={(e) => refilter(() => setQuery(e.target.value))} placeholder="Symbol, note or date" className="!py-1.5 text-[13px]" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/transactions/trash" className="text-[12px] text-muted hover:text-ink px-2">Trash</Link>
          <Button variant="outline" onClick={exportCsv} className="!py-1.5 text-[12px]">Export CSV</Button>
        </div>
      </div>

      <div className="-mx-2">
        <Table columns={columns} rows={visible} rowKey={(t) => String(t._id)} empty={transactions.length === 0 ? "No transactions. Add your first one." : "Nothing matches those filters."} />
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span className="text-[12px] text-muted">
            {pageSize === 0 ? (
              <>All <span className="mono-num">{filtered.length.toLocaleString()}</span> records</>
            ) : (
              <>
                <span className="mono-num">{((current - 1) * pageSize + 1).toLocaleString()}</span> to <span className="mono-num">{Math.min(current * pageSize, filtered.length).toLocaleString()}</span> of <span className="mono-num">{filtered.length.toLocaleString()}</span>
              </>
            )}
            {filtered.length !== transactions.length && <span> · filtered from {transactions.length.toLocaleString()}</span>}
          </span>

          <div className="flex items-center gap-3">
            <div className="seg">
              {PAGE_SIZES.map((n) => (
                <button key={n} type="button" data-active={pageSize === n} onClick={() => { setPageSize(n); setPage(1); }}>
                  {n === 0 ? "All" : n}
                </button>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(current - 1)} disabled={current <= 1} className={pageBtn}>Prev</button>
                <span className="text-[12px] text-muted mono-num px-1">{current} / {pageCount}</span>
                <button onClick={() => setPage(current + 1)} disabled={current >= pageCount} className={pageBtn}>Next</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
