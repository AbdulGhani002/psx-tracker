"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtDate } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export function TrashView({ transactions }: { transactions: Transaction[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/transactions/${id}/restore`, { method: "POST" });
      if (res.ok) router.refresh();
      else {
        const d = await res.json().catch(() => ({}));
        alert(d?.detail ?? "Could not restore.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function purge(id: string) {
    if (!confirm("Delete this transaction forever? This cannot be undone.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/transactions/${id}?hard=1`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<Transaction>[] = [
    { key: "date", header: "Date", render: (t) => <span className="font-mono text-[12px]">{fmtDate(t.date)}</span> },
    {
      key: "deletedAt",
      header: "Deleted",
      render: (t) => <span className="font-mono text-[11px] text-muted">{t.deletedAt ? fmtDate(t.deletedAt) : "—"}</span>,
    },
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
    { key: "net", header: "Net Amount", align: "right", mono: true, render: (t) => fmtRs(t.netAmount) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (t) => (
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => restore(String(t._id))}
            disabled={busy === String(t._id)}
            className="font-mono text-[10px] uppercase tracking-stat hover:text-[var(--accent-deep)]"
            style={{ color: "var(--accent)" }}
          >
            {busy === String(t._id) ? "…" : "Restore"}
          </button>
          <button
            onClick={() => purge(String(t._id))}
            disabled={busy === String(t._id)}
            className="font-mono text-[10px] uppercase tracking-stat text-muted hover:text-[var(--negative)]"
          >
            Delete forever
          </button>
        </div>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={transactions}
      rowKey={(t) => String(t._id)}
      empty="Trash is empty."
    />
  );
}
