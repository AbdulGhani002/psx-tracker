import "server-only";
import { headers } from "next/headers";

// Cron endpoints are MACHINE-only.
//
// The middleware lets any valid session through, which is right for pages but
// wrong here: these routes return cross-user data (the alerts job reports every
// user's id and alert status) and run multi-minute jobs. A logged-in human must
// not be able to call them — otherwise one user can enumerate the whole roster,
// force-send other people's Telegram alerts, burn their once-a-day dedupe slots
// (silently suppressing their real alerts), or DoS the box by re-triggering the
// 300s snapshot job.
//
// Accepted callers:
//   1. x-cron-secret matching CRON_SECRET (preferred), or
//   2. the HTTP Basic credentials the systemd timers already send.
// (2) keeps the existing /root/psx-*.sh timers working unchanged.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function cronAuthorised(): Promise<boolean> {
  const h = await headers();

  const secret = process.env.CRON_SECRET ?? "";
  if (secret) {
    const got = h.get("x-cron-secret") ?? "";
    if (got.length > 0 && timingSafeEqual(got, secret)) return true;
  }

  const expectedUser = process.env.AUTH_USERNAME ?? "";
  const expectedPass = process.env.AUTH_PASSWORD ?? "";
  const auth = h.get("authorization") ?? "";
  if (expectedPass.length > 0 && auth.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (
        i >= 0 &&
        timingSafeEqual(decoded.slice(0, i), expectedUser) &&
        timingSafeEqual(decoded.slice(i + 1), expectedPass)
      ) {
        return true;
      }
    } catch {
      /* malformed header → not authorised */
    }
  }

  return false;
}
