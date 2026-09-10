// Minimal transactional email via the Resend HTTP API (no npm dependency — just
// fetch). Activates when RESEND_API_KEY is set; otherwise it's a no-op that
// returns false, so signup/reset flows still work locally (the link is logged).
const FROM = process.env.MAIL_FROM || "PSX Portfolio <noreply@psx.app>";

// contentId lets the HTML show the file inline (<img src="cid:...">). If the
// API refuses the field the send is retried without it, so the pictures still
// arrive as attachments rather than not at all.
export type MailAttachment = { filename: string; content: Buffer; contentId?: string };

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments: MailAttachment[] = []
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[mailer] (no RESEND_API_KEY) would send to ${to}: ${subject}`);
    return false;
  }
  try {
    const post = async (withIds: boolean) => {
      const body: Record<string, unknown> = { from: FROM, to, subject, html };
      // Resend takes attachments base64-encoded in the JSON body, so a PDF rides
      // along with no multipart handling and no extra dependency.
      if (attachments.length > 0) {
        body.attachments = attachments.map((a) => ({
          filename: a.filename,
          content: a.content.toString("base64"),
          ...(withIds && a.contentId ? { content_id: a.contentId } : {}),
        }));
      }
      return fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    };
    const hasIds = attachments.some((a) => a.contentId);
    let res = await post(hasIds);
    if (!res.ok && hasIds && res.status >= 400 && res.status < 500) {
      console.log(`[mailer] resend refused inline ids (${res.status}); retrying as plain attachments`);
      res = await post(false);
    }
    if (!res.ok) {
      // The reason matters when a weekly report silently stops arriving.
      console.log(`[mailer] resend rejected ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`[mailer] send failed: ${String(e).slice(0, 200)}`);
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
