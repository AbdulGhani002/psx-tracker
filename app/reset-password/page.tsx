"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { LogoMark } from "@/components/layout/Logo";

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

  const inputCls = "field text-[15px]";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10 login-bg">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-8">
          <LogoMark size={52} />
          <h1 className="text-[28px] font-bold tracking-[-0.03em] leading-none mt-6">Set a new password</h1>
        </div>
        <div className="card card-pad">
        {!token ? (
          <p className="text-[13px] text-center text-muted">This reset link is missing its token. Request a new one from the login page.</p>
        ) : done ? (
          <div className="text-center">
            <p className="text-[14px]" style={{ color: "var(--positive)" }}>Password updated.</p>
            <a href="/login" className="text-[13px] link-underline inline-block mt-4">Go to sign in</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="label-cap block mb-1.5">New password</label>
              <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
              <p className="text-[11px] text-muted mt-1">At least 8 characters.</p>
            </div>
            {error && <div className="text-[13px] py-2.5 px-3 rounded-lg" style={{ color: "var(--negative)", background: "color-mix(in srgb, var(--negative) 10%, transparent)" }}>{error}</div>}
            <Button type="submit" variant="solid" disabled={busy} className="w-full !py-3 text-[14px]">{busy ? "Saving…" : "Set new password"}</Button>
          </form>
        )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <Suspense fallback={null}><ResetForm /></Suspense>;
}
