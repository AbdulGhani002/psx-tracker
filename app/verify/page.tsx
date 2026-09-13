"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LogoMark } from "@/components/layout/Logo";

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
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center login-bg">
      <div className="w-full max-w-[400px] flex flex-col items-center">
        <LogoMark size={52} />
        <h1 className="text-[28px] font-bold tracking-[-0.03em] leading-none mt-6 mb-3">
          {state === "verifying" ? "Confirming" : state === "ok" ? "Email confirmed" : "Link expired"}
        </h1>
        <p className="text-[13.5px] text-muted">
          {state === "verifying" ? "One moment." : state === "ok" ? "Your email is verified. Thank you." : "This verification link is invalid or has expired."}
        </p>
        <a href="/" className="btn-ghost inline-block mt-6">Go to your portfolio</a>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return <Suspense fallback={null}><VerifyInner /></Suspense>;
}
