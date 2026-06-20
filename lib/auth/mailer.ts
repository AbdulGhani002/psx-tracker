// Minimal transactional email via the Resend HTTP API (no npm dependency — just
// fetch). Activates when RESEND_API_KEY is set; otherwise it's a no-op that
// returns false, so signup/reset flows still work locally (the link is logged).
const FROM = process.env.MAIL_FROM || "PSX Portfolio <noreply@psx.app>";

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[mailer] (no RESEND_API_KEY) would send to ${to}: ${subject}`);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function appOrigin(): string {
  return process.env.APP_ORIGIN || "https://psx.80.65.211.25.sslip.io";
}

export function verifyEmailHtml(link: string): string {
  return `<div style="font-family:sans-serif;max-width:480px"><h2>Confirm your email</h2><p>Welcome to PSX Portfolio. Confirm your email to secure your account:</p><p><a href="${link}" style="background:#1a1a1a;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">Confirm email</a></p><p style="color:#888;font-size:12px">Or paste this link: ${link}</p></div>`;
}

export function resetEmailHtml(link: string): string {
  return `<div style="font-family:sans-serif;max-width:480px"><h2>Reset your password</h2><p>Click below to set a new password. This link expires in 1 hour.</p><p><a href="${link}" style="background:#1a1a1a;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">Reset password</a></p><p style="color:#888;font-size:12px">If you didn't request this, ignore this email. Link: ${link}</p></div>`;
}
