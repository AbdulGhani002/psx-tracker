// Minimal Telegram Bot API sender. The user creates a bot via @BotFather,
// pastes the token + their chat id in Settings.
//
// Every call is tried again once when Telegram is busy (429, after the wait
// it asks for, up to 5 s), down (5xx) or unreachable. A text over Telegram's
// 4,096 characters goes as several messages, and one whose markup Telegram
// cannot read goes again as plain text, so a stray "<" never costs an alert.

export const TELEGRAM_MAX_TEXT = 4096;

type Sent = { ok: boolean; detail?: string; status?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(token: string, method: string, body: () => RequestInit["body"], json: boolean): Promise<Sent> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: json ? { "content-type": "application/json" } : undefined,
        body: body(),
        cache: "no-store",
      });
      const out: any = await res.json().catch(() => ({}));
      if (res.ok && out?.ok === true) return { ok: true };
      const busy = res.status === 429 || res.status >= 500;
      if (!busy || attempt >= 2) return { ok: false, detail: out?.description ?? `HTTP ${res.status}`, status: res.status };
      await sleep(Math.min(5, Number(out?.parameters?.retry_after) || 2) * 1000);
    } catch (e) {
      if (attempt >= 2) return { ok: false, detail: String(e) };
      await sleep(2000);
    }
  }
}

// Whole lines per message where they fit; a line longer than a message is cut.
export function splitTelegram(text: string, max = TELEGRAM_MAX_TEXT): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  for (let line of text.split("\n")) {
    while (line.length > max) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      out.push(line.slice(0, max));
      line = line.slice(max);
    }
    if (cur && cur.length + 1 + line.length > max) {
      out.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export const plainText = (html: string) =>
  html.replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const unreadable = (r: Sent) => r.status === 400 && /parse entities|unsupported start tag|can't find end/i.test(r.detail ?? "");

export async function sendTelegram(token: string, chatId: string, text: string): Promise<{ ok: boolean; detail?: string }> {
  if (!token || !chatId) return { ok: false, detail: "no_credentials" };
  for (const part of splitTelegram(text)) {
    let r = await call(token, "sendMessage", () => JSON.stringify({ chat_id: chatId, text: part, parse_mode: "HTML", disable_web_page_preview: true }), true);
    if (!r.ok && unreadable(r)) r = await call(token, "sendMessage", () => JSON.stringify({ chat_id: chatId, text: plainText(part), disable_web_page_preview: true }), true);
    if (!r.ok) return { ok: false, detail: r.detail };
  }
  return { ok: true };
}

// Send up to ten photos as one album, each with its own caption. Telegram shows
// the album inline and the caption when a photo is opened, so the summary text
// is sent separately ahead of it rather than relying on album captions.
export async function sendTelegramPhotos(
  token: string,
  chatId: string,
  photos: Array<{ png: Buffer; caption?: string; filename?: string }>
): Promise<{ ok: boolean; detail?: string }> {
  if (!token || !chatId) return { ok: false, detail: "no_credentials" };
  const batch = photos.slice(0, 10);
  if (batch.length === 0) return { ok: true };
  const form = () => {
    const f = new FormData();
    f.append("chat_id", chatId);
    const media = batch.map((p, i) => ({
      type: "photo",
      media: `attach://p${i}`,
      caption: p.caption ? p.caption.slice(0, 1024) : undefined,
      parse_mode: "HTML",
    }));
    f.append("media", JSON.stringify(media));
    batch.forEach((p, i) => {
      f.append(`p${i}`, new Blob([new Uint8Array(p.png)], { type: "image/png" }), p.filename ?? `chart${i}.png`);
    });
    return f;
  };
  const r = await call(token, "sendMediaGroup", form, false);
  return { ok: r.ok, detail: r.detail };
}

// Send a file (the monthly PDF statement, a company's announcement).
// Multipart per the Bot API; the caption may be HTML when parseMode says so.
export async function sendTelegramDocument(
  token: string,
  chatId: string,
  filename: string,
  bytes: Buffer,
  caption = "",
  opts: { contentType?: string; parseMode?: "HTML" } = {}
): Promise<{ ok: boolean; detail?: string }> {
  if (!token || !chatId) return { ok: false, detail: "no_credentials" };
  const form = (text: string, html: boolean) => () => {
    const f = new FormData();
    f.append("chat_id", chatId);
    if (text) f.append("caption", text);
    if (text && html) f.append("parse_mode", "HTML");
    f.append("document", new Blob([new Uint8Array(bytes)], { type: opts.contentType ?? "application/pdf" }), filename);
    return f;
  };
  const html = opts.parseMode === "HTML";
  let r = await call(token, "sendDocument", form(caption, html), false);
  if (!r.ok && html && unreadable(r)) r = await call(token, "sendDocument", form(plainText(caption), false), false);
  return { ok: r.ok, detail: r.detail };
}
