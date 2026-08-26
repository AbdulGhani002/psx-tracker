"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/reset-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
    if (res.ok) setDone(true);
    else {
      const b = await res.json().catch(() => ({}));
      setError(b?.error ?? "Failed.");
    }
    setBusy(false);
  }

  const inputCls = "w-full bg-transparent border-b border-ink py-2.5 text-[15px] font-mono focus:outline-none focus:border-[var(--accent-deep)]";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "var(--paper)" }}>
      <div className="w-full max-w-[380px]">
        <h1 className="font-display text-[32px] text-center mb-6">Set a new password</h1>
        {!token ? (
          <p className="text-[13px] text-center text-muted">This reset link is missing its token. Request a new one from the login page.</p>
        ) : done ? (
          <div className="text-center">
            <p className="text-[14px]" style={{ color: "var(--positive)" }}>Password updated.</p>
            <a href="/login" className="label-cap hover:text-[var(--accent-deep)] inline-block mt-4">Go to sign in →</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <div>
              <label className="label-cap block mb-1.5">New password</label>
              <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
              <p className="text-[11px] text-muted mt-1">At least 8 characters.</p>
            </div>
            {error && <div className="text-[13px] py-2 px-3 border" style={{ color: "var(--negative)", borderColor: "var(--negative)" }}>{error}</div>}
            <Button type="submit" variant="solid" disabled={busy} className="w-full py-3">{busy ? "Saving…" : "Set new password"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetForm /></Suspense>;
}
