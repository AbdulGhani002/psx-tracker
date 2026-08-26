"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Turnstile } from "@/components/auth/Turnstile";

export function AuthForm({ siteKey }: { siteKey?: string }) {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const [token, setToken] = useState("");
  const [widgetKey, setWidgetKey] = useState(0); // bump to reset the widget after a failed POST

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (siteKey && !token) {
      setError("Please complete the bot check below.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name, remember, turnstileToken: token }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.error ?? "Something went wrong.");
        setBusy(false);
        setToken("");
        setWidgetKey((k) => k + 1); // Turnstile tokens are single-use — get a fresh one
        return;
      }
      window.location.href = next.startsWith("/") ? next : "/";
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
      setToken("");
      setWidgetKey((k) => k + 1);
    }
  }

  async function forgot() {
    if (!email) return setError("Enter your email first, then tap 'Forgot password'.");
    setBusy(true);
    setError(null);
    await fetch("/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => {});
    setForgotSent(true);
    setBusy(false);
  }

  const inputCls = "w-full bg-transparent border-b border-ink py-2.5 text-[15px] font-mono focus:outline-none focus:border-[var(--accent-deep)] transition-colors";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "var(--paper)" }}>
      <div className="w-full max-w-[380px]">
        <div className="mb-9 text-center">
          <div className="label-cap mb-3" style={{ color: "var(--accent-deep)" }}>PSX Portfolio</div>
          <h1 className="font-display text-[38px] leading-none tracking-tight">
            {mode === "signup" ? "Create your account." : "Welcome back."}
          </h1>
          <p className="text-[13px] text-muted mt-3">{mode === "signup" ? "Start tracking your PSX portfolio — free." : "Sign in to your portfolio."}</p>
        </div>

        {forgotSent ? (
          <div className="text-[13px] text-center p-4 border" style={{ borderColor: "var(--rule)" }}>
            If an account exists for <strong>{email}</strong>, we&apos;ve sent a password-reset link. Check your inbox.
            <div className="mt-3"><button className="label-cap hover:text-[var(--accent-deep)]" onClick={() => setForgotSent(false)}>← Back</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            {mode === "signup" && (
              <div>
                <label className="label-cap block mb-1.5">Name (optional)</label>
                <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
            )}
            <div>
              <label className="label-cap block mb-1.5">Email</label>
              <input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="label-cap block mb-1.5">Password</label>
              <input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
              {mode === "signup" && <p className="text-[11px] text-muted mt-1">At least 8 characters.</p>}
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 accent-[var(--accent-deep)]" />
                <span className="text-[13px] text-muted">Keep me signed in</span>
              </label>
              {mode === "login" && <button type="button" onClick={forgot} className="text-[12px] text-muted hover:text-[var(--accent-deep)]">Forgot password?</button>}
            </div>

            {siteKey && (
              <div key={widgetKey}>
                <Turnstile siteKey={siteKey} onToken={setToken} />
              </div>
            )}

            {error && <div className="text-[13px] py-2 px-3 border" style={{ color: "var(--negative)", borderColor: "var(--negative)" }}>{error}</div>}

            <Button type="submit" variant="solid" disabled={busy} className="w-full py-3">
              {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>

            <p className="text-[13px] text-center text-muted">
              {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
              <button type="button" className="font-medium hover:text-[var(--accent-deep)]" style={{ color: "var(--ink)" }} onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(null); }}>
                {mode === "signup" ? "Sign in" : "Create a free account"}
              </button>
            </p>
          </form>
        )}

        <p className="text-[11px] text-muted text-center mt-8 font-mono">Encrypted session · secured connection</p>
      </div>
    </div>
  );
}
