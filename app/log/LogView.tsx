"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { NumberInput } from "@/components/ui/NumberInput";
import { fmtDate, fmtPct } from "@/lib/format";

type Entry = {
  _id: string;
  symbol: string;
  date: string;
  trigger: string;
  interpretation: string;
  action: string;
  positionBefore: number;
  positionAfter: number;
};

type Props = {
  entries: Entry[];
  symbols: string[];
};

export function LogView({ entries, symbols }: Props) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [symbol, setSymbol] = useState<string>(symbols[0] ?? "");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [trigger, setTrigger] = useState("");
  const [interpretation, setInterpretation] = useState("");
  const [action, setAction] = useState("");
  const [before, setBefore] = useState<number>(0);
  const [after, setAfter] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!symbol || !trigger.trim() || !interpretation.trim() || !action.trim()) {
      setError("Symbol, trigger, interpretation, and action are required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          date,
          trigger,
          interpretation,
          action,
          positionBefore: before,
          positionAfter: after,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.detail ?? body?.error ?? "Submission failed.");
        return;
      }
      setTrigger("");
      setInterpretation("");
      setAction("");
      setBefore(0);
      setAfter(0);
      setShowForm(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant={showForm ? "outline" : "solid"} onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "New Entry"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Select
                label="Symbol"
                value={symbol}
                onChange={setSymbol}
                options={symbols.map((s) => ({ value: s, label: s }))}
              />
              <div className="space-y-1.5">
                <label className="label-cap block">Date</label>
                <div className="border-b border-ink">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <NumberInput
                  label="% before"
                  value={before}
                  onChange={setBefore}
                  step={0.1}
                  suffix="%"
                />
                <NumberInput
                  label="% after"
                  value={after}
                  onChange={setAfter}
                  step={0.1}
                  suffix="%"
                />
              </div>
            </div>
            <TextInput
              label="Trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="What changed? e.g. Q3 result beat, regulator move, position drift…"
            />
            <div className="space-y-1.5">
              <label className="label-cap block">Interpretation</label>
              <textarea
                value={interpretation}
                onChange={(e) => setInterpretation(e.target.value)}
                rows={3}
                className="w-full bg-transparent border-b border-ink text-[14px] py-1.5 focus:outline-none resize-none"
                placeholder="How you read the data."
              />
            </div>
            <div className="space-y-1.5">
              <label className="label-cap block">Action</label>
              <textarea
                value={action}
                onChange={(e) => setAction(e.target.value)}
                rows={2}
                className="w-full bg-transparent border-b border-ink text-[14px] py-1.5 focus:outline-none resize-none"
                placeholder="What you did. (Sometimes 'hold' is the action.)"
              />
            </div>
            {error && (
              <div className="text-[13px]" style={{ color: "var(--negative)" }}>
                {error}
              </div>
            )}
            <Button type="submit" variant="solid" disabled={submitting}>
              {submitting ? "Saving…" : "Record Entry"}
            </Button>
          </form>
        </Card>
      )}

      {entries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No entries yet. Start a quarterly habit — log what changed, how you read it, what you did.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((e) => (
            <article key={String(e._id)} className="border-l-[3px] border-l-[var(--accent)] bg-[var(--paper-2)] p-5">
              <header className="flex items-baseline justify-between mb-3">
                <div>
                  <span className="font-mono font-medium text-[14px]">{e.symbol}</span>
                  <span className="ml-3 label-cap">{fmtDate(e.date)}</span>
                </div>
                <span className="font-mono text-[11px] text-muted">
                  {fmtPct(e.positionBefore / 100, 1)} → {fmtPct(e.positionAfter / 100, 1)}
                </span>
              </header>
              <div className="space-y-3 text-[14px] leading-relaxed">
                <div>
                  <span className="label-cap mr-2">Trigger</span>
                  <span>{e.trigger}</span>
                </div>
                <div>
                  <span className="label-cap mr-2">Read</span>
                  <span>{e.interpretation}</span>
                </div>
                <div>
                  <span className="label-cap mr-2">Action</span>
                  <span>{e.action}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
