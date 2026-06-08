"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Table, type Column } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { fmtRs, fmtNum, fmtDate } from "@/lib/format";
import type { Transaction } from "@/lib/types";

// Transaction history for a single holding, with Edit + Delete (soft-delete to
// Trash, with an inline Undo). Mirrors the table on the /transactions page so a
// mistaken entry can be removed right from the stock's page.
export function HoldingTransactions({ transactions }: { transactions: Transaction[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const [restoring, setRestoring] = useState(false);

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

  const columns: Column<Transaction>[] = [
    { key: "date", header: "Date", render: (t) => <span className="font-mono text-[12px]">{fmtDate(t.date)}</span> },
    {
      key: "type",
      header: "Type",
      render: (t) => (
        <Badge tone={t.type === "BUY" || t.type === "RIGHT" ? "accent" : t.type === "SELL" ? "negative" : "positive"}>
          {t.type}
        </Badge>
      ),
    },
    { key: "shares", header: "Shares", align: "right", mono: true, render: (t) => fmtNum(Math.abs(t.shares)) },
    { key: "price", header: "Price", align: "right", mono: true, render: (t) => fmtRs(t.pricePerShare, true) },
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
    <div className="space-y-4">
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

      <Table columns={columns} rows={transactions} rowKey={(t) => String(t._id)} empty="No transactions yet." />
    </div>
  );
}
