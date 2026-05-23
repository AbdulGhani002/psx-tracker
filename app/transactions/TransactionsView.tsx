"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
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

export function TransactionsView({ transactions, symbols }: Props) {
  const router = useRouter();
  const [symbolFilter, setSymbolFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (symbolFilter && t.symbol !== symbolFilter) return false;
      if (typeFilter && t.type !== typeFilter) return false;
      return true;
    });
  }, [transactions, symbolFilter, typeFilter]);

  async function onDelete(id: string) {
    if (!confirm("Delete this transaction? Derived holding values will be recomputed.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeleting(null);
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
            onClick={() => onDelete(String(t._id))}
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-end">
        <Select
          label="Filter by symbol"
          value={symbolFilter}
          onChange={setSymbolFilter}
          options={[{ value: "", label: "All symbols" }, ...symbols.map((s) => ({ value: s, label: s }))]}
        />
        <Select
          label="Filter by type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[{ value: "", label: "All types" }, ...TRANSACTION_TYPES.map((t) => ({ value: t, label: t }))]}
        />
        <div className="flex justify-end">
          <Button variant="outline" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        rows={filtered}
        rowKey={(t) => String(t._id)}
        empty="No transactions. Add your first one."
      />
    </div>
  );
}
