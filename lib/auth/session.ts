// Stateless signed session token for cookie auth.
//
// HMAC-SHA256 over a JSON payload using the Web Crypto API, so the exact same
// code verifies tokens in BOTH the Edge middleware and Node route handlers.
// Token format: base64url(payload) "." base64url(signature).
//
// The cookie is httpOnly + signed, so it can't be read by JS or forged without
// the server secret. There's no server-side session store — the token carries
// its own expiry and is self-verifying.

const enc = new TextEncoder();

export const SESSION_COOKIE = "psx_session";
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days ("remember me")

function secret(): string {
  // Prefer a dedicated secret; fall back to the password. Changing either
  // invalidates live sessions.
  const configured = process.env.SESSION_SECRET || process.env.AUTH_PASSWORD;
  if (configured) return configured;
  // The old code fell back to a constant that is PUBLIC in this repo. If the env
  // ever went missing, sessions would still be signed — with a key anyone can
  // read — letting anyone forge a cookie for any userId. Fail loudly instead;
  // a dev-only fallback keeps local work friction-free.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET (or AUTH_PASSWORD) is not set. Refusing to sign sessions with the public dev constant."
    );
  }
  return "psx-tracker-dev-secret";
}

function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToStr(b64: string): string {
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return atob(b64.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return bytesToB64Url(new Uint8Array(sig));
}

// Constant-time compare to avoid leaking signature bytes via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(userId: string, maxAgeSec: number = SESSION_MAX_AGE_SEC): Promise<string> {
  const payload = { uid: userId, exp: Date.now() + maxAgeSec * 1000 };
  const payloadB64 = bytesToB64Url(enc.encode(JSON.stringify(payload)));
  const sig = await sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifySession(token: string | undefined | null): Promise<{ userId: string } | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await sign(payloadB64);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    // `uid` is the user id; `u` kept for backward-compat with old legacy tokens.
    const payload = JSON.parse(b64UrlToStr(payloadB64)) as { uid?: string; u?: string; exp?: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    const id = payload.uid ?? payload.u ?? "";
    if (!id) return null;
    return { userId: String(id) };
  } catch {
    return null;
  }
}
