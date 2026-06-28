// Server-side Cloudflare Turnstile verification for the login/signup endpoints.
//
// Gated on TURNSTILE_SECRET_KEY: if it isn't set, verification is a no-op so the
// app works exactly as before (the widget also won't render). Once both keys are
// configured the token is checked against Cloudflare's siteverify.
//
// Fail policy: an explicit rejection from Cloudflare blocks the request, but a
// network/timeout error to Cloudflare is allowed through — a Cloudflare outage
// should never lock the real owner out of their own portfolio.
const SECRET = process.env.TURNSTILE_SECRET_KEY;
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(): boolean {
  return !!SECRET;
}

export async function verifyTurnstile(token: string | undefined | null, ip?: string): Promise<boolean> {
  if (!SECRET) return true; // disabled until configured
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", SECRET);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);
    const r = await fetch(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(8000) });
    const d = (await r.json().catch(() => ({}))) as { success?: boolean };
    return d.success === true;
  } catch {
    return true; // network/timeout to Cloudflare — don't lock the owner out
  }
}
