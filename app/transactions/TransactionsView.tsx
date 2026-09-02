"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
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

  const columns: Column<Transaction>[] = [
    { key: "date", header: "Date", render: (t) => <span className="font-mono text-[12px]">{fmtDate(t.date)}</span> },
    { key: "symbol", header: "Symbol", render: (t) => <span className="font-mono font-medium">{t.symbol}</span> },
    {
      key: "type",
      header: "Type",
      render: (t) => (
        <Badge
          tone={
            t.type === "BUY" || t.type === "RIGHT"
              ? "accent"
              : t.type === "SELL"
              ? "negative"
              : t.type === "DIVIDEND"
              ? "positive"
              : "amber"
          }
        >
          {t.type}
        </Badge>
      ),
    },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (t) => fmtNum(Math.abs(t.shares)) },
    { key: "price", header: "Price", align: "right", mono: true, render: (t) => fmtRs(t.pricePerShare, true) },
    { key: "fees", header: "Fees", align: "right", mono: true, render: (t) => fmtRs(t.fees) },
    { key: "net", header: "Net Amount", align: "right", mono: true, render: (t) => fmtRs(t.netAmount) },
    { key: "notes", header: "Notes", render: (t) => <span className="text-[12px] text-muted">{t.notes}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (t) => (
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`/transactions/${String(t._id)}/edit`}
            className="font-mono text-[10px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]"
          >
            Edit
          </Link>
          <button
            onClick={() => onDelete(t)}
            disabled={deleting === String(t._id)}
            className="font-mono text-[10px] uppercase tracking-stat text-muted hover:text-[var(--negative)]"
          >
            {deleting === String(t._id) ? "…" : "Delete"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {undo && (
        <div
          className="flex items-center justify-between px-4 py-3 border"
          style={{ borderColor: "var(--rule)", background: "var(--paper-2)" }}
        >
          <span className="text-[13px]">
            Moved <span className="font-mono">{undo.label}</span> to Trash.
          </span>
          <div className="flex items-center gap-4">
            <button
              onClick={onUndo}
              disabled={restoring}
              className="font-mono text-[11px] uppercase tracking-stat hover:text-[var(--accent-deep)]"
              style={{ color: "var(--accent)" }}
            >
              {restoring ? "Restoring…" : "Undo"}
            </button>
            <button
              onClick={() => setUndo(null)}
              className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--ink)]"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href="/transactions/trash"
          className="font-mono text-[11px] uppercase tracking-stat text-muted hover:text-[var(--accent-deep)]"
        >
          View Trash
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 items-end">
        <Select
          label="Filter by symbol"
          value={symbolFilter}
          onChange={(v) => refilter(() => setSymbolFilter(v))}
          options={[{ value: "", label: "All symbols" }, ...symbols.map((s) => ({ value: s, label: s }))]}
        />
        <Select
          label="Filter by type"
          value={typeFilter}
          onChange={(v) => refilter(() => setTypeFilter(v))}
          options={[{ value: "", label: "All types" }, ...TRANSACTION_TYPES.map((t) => ({ value: t, label: t }))]}
        />
        <TextInput
          label="Search"
          value={query}
          onChange={(e) => refilter(() => setQuery(e.target.value))}
          placeholder="Symbol, note or date"
        />
        <div className="flex justify-end">
          <Button variant="outline" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        rows={visible}
        rowKey={(t) => String(t._id)}
        empty={
          transactions.length === 0 ? "No transactions. Add your first one." : "Nothing matches those filters."
        }
      />

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <span className="text-[12px] text-muted">
            {pageSize === 0 ? (
              <>
                All <span className="font-mono">{filtered.length.toLocaleString()}</span> records
              </>
            ) : (
              <>
                <span className="font-mono">{((current - 1) * pageSize + 1).toLocaleString()}</span>
                {" to "}
                <span className="font-mono">{Math.min(current * pageSize, filtered.length).toLocaleString()}</span>
                {" of "}
                <span className="font-mono">{filtered.length.toLocaleString()}</span>
              </>
            )}
            {filtered.length !== transactions.length && (
              <span> · filtered from {transactions.length.toLocaleString()}</span>
            )}
          </span>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-stat text-muted">Per page</span>
              {PAGE_SIZES.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setPageSize(n);
                    setPage(1);
                  }}
                  className="font-mono text-[11px] hover:text-[var(--accent-deep)]"
                  style={{
                    color: pageSize === n ? "var(--ink)" : "var(--muted)",
                    fontWeight: pageSize === n ? 600 : 400,
                  }}
                >
                  {n === 0 ? "all" : n}
                </button>
              ))}
            </div>

            {pageCount > 1 && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPage(current - 1)}
                  disabled={current <= 1}
                  className="font-mono text-[11px] uppercase tracking-stat disabled:opacity-30 hover:text-[var(--accent-deep)]"
                >
                  Prev
                </button>
                <span className="font-mono text-[11px] text-muted">
                  {current} / {pageCount}
                </span>
                <button
                  onClick={() => setPage(current + 1)}
                  disabled={current >= pageCount}
                  className="font-mono text-[11px] uppercase tracking-stat disabled:opacity-30 hover:text-[var(--accent-deep)]"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
