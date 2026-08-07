"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type CardData = { type: string; symbol: string; message: string; kind: "trigger" | "cash" | "rebuy" };

// A fired-trigger card. Clearing it means ACTING (trim/sell links) or logging a
// conscious hold — with reasoning and a falsifier. Slightly effortful on purpose.
export function HoldThroughCard({ card }: { card: CardData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [falsifier, setFalsifier] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isTrigger = card.kind === "trigger";

  async function logHold() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: card.symbol,
          action: "hold_through_trigger",
          rationale,
          falsifier,
          reviewDate,
          firedTriggers: [card.type],
          acknowledgeGuards: ack,
        }),
      });
      if (res.status === 409) {
        const b = await res.json();
        setWarnings(b.warnings ?? []);
        return;
      }
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr(b?.issues?.[0]?.message ?? b?.detail ?? b?.error ?? "Failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-[13px] max-w-[75ch]">{card.message}</p>
        <span className="font-mono text-[10px] uppercase tracking-stat text-muted whitespace-nowrap">{card.type.replace(/_/g, " ")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {isTrigger && (
          <>
            <Link href={`/transactions/new?symbol=${card.symbol}&type=SELL`}>
              <Button variant="solid">Trim / sell {card.symbol}</Button>
            </Link>
            <Button variant="outline" onClick={() => setOpen(!open)}>
              {open ? "Cancel" : "Hold anyway (log why)"}
            </Button>
          </>
        )}
        {card.kind === "cash" && (
          <Link href="/assets"><Button variant="outline">Fix the cash plan →</Button></Link>
        )}
        {card.kind === "rebuy" && (
          <Link href={`/holdings/${card.symbol}`}><Button variant="outline">Open the re-buy checklist →</Button></Link>
        )}
      </div>

      {open && isTrigger && (
        <div className="mt-4 pt-4 border-t border-rule space-y-3 max-w-[70ch]">
          <label className="block">
            <span className="label-cap block mb-1">Why hold, in your words (min 20 chars)</span>
            <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3}
              className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]"
              placeholder="Not 'it will recover' — what specifically makes holding right despite your own fired rule?" />
          </label>
          <label className="block">
            <span className="label-cap block mb-1">Falsifier — what would prove this hold wrong?</span>
            <input value={falsifier} onChange={(e) => setFalsifier(e.target.value)}
              className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]"
              placeholder='e.g. "FY26 gross margin below 13%" — a number or event, not a feeling' />
          </label>
          <label className="block max-w-[220px]">
            <span className="label-cap block mb-1">Check me on (optional)</span>
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)}
              className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px] font-mono" />
          </label>
          {warnings.length > 0 && (
            <div className="border-l-[3px] pl-3 py-2 space-y-2" style={{ borderColor: "var(--negative)" }}>
              {warnings.map((w, i) => <p key={i} className="text-[13px]" style={{ color: "var(--negative)" }}>{w}</p>)}
              <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="w-4 h-4 accent-[var(--accent-deep)]" />
                I&apos;ve looked at what I was avoiding — log it anyway.
              </label>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button variant="solid" onClick={logHold} disabled={busy || rationale.length < 20 || falsifier.length < 10 || (warnings.length > 0 && !ack)}>
              {busy ? "Logging…" : "Log the hold"}
            </Button>
            {err && <span className="text-[12px]" style={{ color: "var(--negative)" }}>{err}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}

// Grade a past decision's REASONING, 1–5. Write-once by design.
export function OutcomeReviewForm({ decision }: { decision: any }) {
  const router = useRouter();
  const [what, setWhat] = useState("");
  const [quality, setQuality] = useState(0);
  const [lesson, setLesson] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/decisions/${decision._id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ whatHappened: what, decisionQuality: quality, lesson }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr(b?.issues?.[0]?.message ?? b?.error ?? "Failed.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-baseline gap-3 flex-wrap mb-1">
        <span className="font-mono text-[13px] font-medium">{decision.symbol}</span>
        <span className="label-cap">{String(decision.action).replace(/_/g, " ")}</span>
        <span className="font-mono text-[11px] text-muted">{String(decision.timestamp).slice(0, 10)} · review was due {decision.reviewDate}</span>
      </div>
      <p className="text-[12px] text-muted max-w-[85ch]">You said: “{decision.rationale}”</p>
      <p className="text-[12px] text-muted max-w-[85ch]"><strong>You expected:</strong> {decision.expectedOutcome || "—"} · <strong>falsifier:</strong> {decision.falsifier}</p>
      <div className="mt-3 space-y-3 max-w-[70ch]">
        <textarea value={what} onChange={(e) => setWhat(e.target.value)} rows={2}
          className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]"
          placeholder="What actually happened? Did the thing you said would happen, happen?" />
        <div className="flex items-center gap-2">
          <span className="label-cap mr-1">Reasoning quality</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setQuality(n)}
              className="w-8 h-8 border font-mono text-[13px]"
              style={{ borderColor: quality === n ? "var(--ink)" : "var(--rule)", background: quality === n ? "var(--paper-2)" : "transparent" }}>
              {n}
            </button>
          ))}
          <span className="text-[10px] text-muted ml-1">grade the reasoning at the time — not the luck</span>
        </div>
        <input value={lesson} onChange={(e) => setLesson(e.target.value)}
          className="w-full border border-rule bg-transparent px-2 py-1.5 text-[13px]"
          placeholder="Lesson (optional) — one sentence future-you should remember" />
        <div className="flex items-center gap-3">
          <Button variant="solid" onClick={submit} disabled={busy || what.length < 10 || quality === 0}>
            {busy ? "Saving…" : "Grade it (write-once)"}
          </Button>
          {err && <span className="text-[12px]" style={{ color: "var(--negative)" }}>{err}</span>}
        </div>
      </div>
    </Card>
  );
}
