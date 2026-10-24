"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";

// The questions, an answer box for each, and Save.

type Q = { key: string; title: string; ask: string };
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function PrinciplesForm({ questions, saved }: { questions: Q[]; saved: { answers: Record<string, string>; savedAt: string | null } }) {
  const [answers, setAnswers] = useState<Record<string, string>>(saved.answers);
  const [savedAt, setSavedAt] = useState(saved.savedAt);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const done = questions.filter((q) => (answers[q.key] ?? "").trim().length > 0).length;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/principles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) setSavedAt(new Date().toISOString());
    setMsg(res?.ok ? "Saved." : "Could not save them.");
  }

  return (
    <div className="fade-in">
      <PageHeader title="Principles" subtitle="How and why you invest, a sentence or two each, with numbers where you can. Telegram reminds you each July to read them again." />
      <Card title={`${done} of ${questions.length} answered`} action={<span className="text-[12px] text-muted">{savedAt ? `Last saved ${when(savedAt)}` : "Not saved yet"}</span>}>
        <div className="space-y-4">
          {questions.map((q, i) => (
            <label key={q.key} className="block">
              <div className="text-[13px] font-semibold">{i + 1}. {q.title}</div>
              <div className="text-[12.5px] text-muted mb-1.5">{q.ask}</div>
              <textarea value={answers[q.key] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} rows={2} className="field w-full text-[13px]" aria-label={q.title} />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button type="button" className="btn-primary !py-1.5 text-[13px]" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          {msg && <span className="text-[12.5px] text-muted">{msg}</span>}
        </div>
      </Card>
    </div>
  );
}
