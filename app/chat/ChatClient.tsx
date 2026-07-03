"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "bot"; text: string; sources?: string[] };

const SUGGESTIONS = [
  "What is the AI rating of MEBL?",
  "Which stocks go ex-dividend soon?",
  "What are foreign investors doing this week?",
  "When is LUCK's next board meeting?",
];

export function ChatClient() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function ask(q?: string) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const d = await r.json();
      if (d.answer) setMsgs((m) => [...m, { role: "bot", text: d.answer, sources: d.sources }]);
      else setMsgs((m) => [...m, { role: "bot", text: "The assistant is starting up (its knowledge index rebuilds hourly) — try again in a minute." }]);
    } catch {
      setMsgs((m) => [...m, { role: "bot", text: "Couldn't reach the assistant. Try again shortly." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-rule" style={{ background: "var(--paper-2)" }}>
      <div className="p-4 space-y-4 min-h-[320px] max-h-[520px] overflow-y-auto">
        {msgs.length === 0 && (
          <div>
            <p className="text-[13px] text-muted mb-3">Ask about any PSX stock's rating, price, dividends, board meetings, or foreign flows. Try:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="label-cap border border-rule px-2.5 py-1.5 hover:border-ink text-left">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className="inline-block max-w-[85%] px-3.5 py-2.5 text-[14px] leading-relaxed text-left"
              style={m.role === "user" ? { background: "var(--ink)", color: "var(--paper)" } : { border: "1px solid var(--rule)", background: "var(--paper)" }}
            >
              {m.text}
              {m.sources && m.sources.length > 0 && (
                <details className="mt-2">
                  <summary className="label-cap cursor-pointer">grounded on {m.sources.length} facts</summary>
                  <ul className="mt-1.5 space-y-1 text-[11px] text-muted">
                    {m.sources.map((s, j) => <li key={j}>· {s}</li>)}
                  </ul>
                </details>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="label-cap">thinking…</div>}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); ask(); }}
        className="flex gap-2 border-t border-rule p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the Pakistani market…"
          className="flex-1 bg-transparent border border-rule px-3 py-2 text-[14px] focus:outline-none focus:border-[var(--accent-deep)]"
        />
        <button type="submit" disabled={busy || !input.trim()} className="border border-ink px-4 py-2 label-cap hover:bg-[var(--ink)] hover:text-[var(--paper)] transition-colors disabled:opacity-50">
          Ask
        </button>
      </form>
    </div>
  );
}
