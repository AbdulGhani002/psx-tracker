// Telegram text handling (lib/notify/telegram): long texts split into
// messages Telegram accepts, and the plain-text fallback.
//
//   npx tsx scripts/test-telegram.ts

import { splitTelegram, plainText, TELEGRAM_MAX_TEXT } from "../lib/notify/telegram";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name, got ?? ""); }
  else { fail++; console.log("FAIL ", name, got ?? ""); }
}

check("a short text is one message", splitTelegram("hello\nworld").join("|") === "hello\nworld");
const lines = Array.from({ length: 200 }, (_, i) => `🟢 <b>SYM${i}</b> is in your BUY zone — Rs ${(100 + i).toFixed(2)} (between 90 and 110)`);
const text = lines.join("\n");
const parts = splitTelegram(text);
check("a long text: several messages, each within the limit", text.length > TELEGRAM_MAX_TEXT && parts.length > 1 && parts.every((p) => p.length <= TELEGRAM_MAX_TEXT), parts.map((p) => p.length).join(","));
check("split on whole lines, nothing lost", parts.join("\n") === text);
const long = "x".repeat(TELEGRAM_MAX_TEXT * 2 + 10);
const cut = splitTelegram(`head\n${long}\ntail`);
check("a line longer than a message is cut", cut.every((p) => p.length <= TELEGRAM_MAX_TEXT) && cut.join("").replace(/\n/g, "") === `head${long}tail`, cut.map((p) => p.length).join(","));
check("a small limit works the same way", splitTelegram("aa\nbb\ncc", 5).join("|") === "aa\nbb|cc");
check("plain text: tags dropped, entities read", plainText("<b>MARI</b> &lt;buy&gt; Q&amp;A") === "MARI <buy> Q&A");

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
