"use client";

import { useState } from "react";
import { glossaryEntry } from "@/lib/glossary";

// Inline financial term with a tap/hover explanation in English + Roman Urdu.
// Usage: <Term k="pe">P/E</Term>
export function Term({ k, children }: { k: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const entry = glossaryEntry(k);
  if (!entry) return <>{children}</>;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="border-b border-dotted border-current cursor-help"
        style={{ background: "none", padding: 0, font: "inherit", color: "inherit" }}
        aria-label={`What is ${entry.term}?`}
      >
        {children}
      </button>
      {open && (
        <span
          className="absolute z-50 left-0 top-full mt-1 w-64 p-3 border text-left shadow-lg"
          style={{ background: "var(--paper)", borderColor: "var(--ink)", fontSize: 12, lineHeight: 1.45 }}
        >
          <span className="block font-mono font-medium mb-1" style={{ color: "var(--accent-deep)" }}>{entry.term}</span>
          <span className="block text-muted mb-1.5">{entry.en}</span>
          <span className="block" style={{ color: "var(--ink)", fontStyle: "italic" }}>{entry.urdu}</span>
        </span>
      )}
    </span>
  );
}
