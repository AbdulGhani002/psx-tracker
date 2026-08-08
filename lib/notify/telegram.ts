// Minimal Telegram Bot API sender. The user creates a bot via @BotFather,
// pastes the token + their chat id in Settings.

export async function sendTelegram(
  token: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; detail?: string }> {
  if (!token || !chatId) return { ok: false, detail: "no_credentials" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body?.ok === true, detail: body?.description };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

// Send a file (the monthly PDF statement). Multipart per the Bot API.
export async function sendTelegramDocument(
  token: string,
  chatId: string,
  filename: string,
  bytes: Buffer,
  caption = ""
): Promise<{ ok: boolean; detail?: string }> {
  if (!token || !chatId) return { ok: false, detail: "no_credentials" };
  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (caption) form.append("caption", caption);
    form.append("document", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), filename);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body?.ok === true, detail: body?.description };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}
