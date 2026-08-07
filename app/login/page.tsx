import { Suspense } from "react";
import { AuthForm } from "./AuthForm";

export const dynamic = "force-dynamic";

// Note: redirecting already-signed-in users away from /login is handled in
// middleware.ts (a clean 307 before this renders), not here.
export default function LoginPage() {
  // Read at runtime (not NEXT_PUBLIC) so the Turnstile site key can be set in the
  // VPS .env.local and picked up on restart — no rebuild needed.
  const siteKey = process.env.TURNSTILE_SITE_KEY || undefined;
  return (
    <Suspense fallback={null}>
      <AuthForm siteKey={siteKey} />
    </Suspense>
  );
}
