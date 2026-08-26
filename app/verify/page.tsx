"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export const dynamic = "force-dynamic";

function VerifyInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState<"verifying" | "ok" | "fail">("verifying");

  useEffect(() => {
    if (!token) {
      setState("fail");
      return;
    }
    fetch("/api/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then((r) => setState(r.ok ? "ok" : "fail"))
      .catch(() => setState("fail"));
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "var(--paper)" }}>
      <div className="w-full max-w-[380px]">
        <h1 className="font-display text-[30px] mb-4">
          {state === "verifying" ? "Confirming…" : state === "ok" ? "Email confirmed ✓" : "Link expired"}
        </h1>
        <p className="text-[13px] text-muted">
          {state === "verifying" ? "One moment." : state === "ok" ? "Your email is verified. Thank you." : "This verification link is invalid or has expired."}
        </p>
        <a href="/" className="label-cap hover:text-[var(--accent-deep)] inline-block mt-5">Go to your portfolio →</a>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return <Suspense fallback={null}><VerifyInner /></Suspense>;
}
