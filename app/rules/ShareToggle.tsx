"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Leaves one share out of the price rules, or brings it back.
export function ShareToggle({ symbol, off }: { symbol: string; off: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function flip() {
    setBusy(true);
    await fetch("/api/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, off: !off }) });
    setBusy(false);
    router.refresh();
  }
  return (
    <button type="button" className="text-[12px] link-underline" onClick={flip} disabled={busy}>
      {off ? "Turn on" : "Turn off"}
    </button>
  );
}
