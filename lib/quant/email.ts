// The model's section of an email: the list as a table, the long-form text,
// then every chart inline with its caption. Captions carry Telegram's <b>/<i>
// tags, which are also HTML, so they pass through as they are. Shared by the
// Sunday weekly email and the on-demand plan email.

import type { QuantReport } from "./report";

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// `light` keeps only the KSE-100 chart: an email with thirteen inline images
// tends to land in spam, and the list is the point of it.
export function quantEmailHtml(q: QuantReport, opts: { heading?: string; light?: boolean } = {}): string {
  const items = opts.light ? q.indices.filter((i) => i.symbol === "KSE100") : [...q.indices, ...q.holdings];
  const charts = items
    .map(
      (it) =>
        `<div style="margin:18px 0"><img src="cid:${it.symbol}.png" alt="${esc(it.title)}" style="max-width:100%;border:1px solid #d5d8dd"><div style="font-size:13px;margin-top:6px;white-space:pre-line">${it.caption}</div></div>`
    )
    .join("");
  return `<h2 style="margin:28px 0 4px;font-size:20px">${esc(opts.heading ?? "Market and model")}</h2>
<div style="color:#6b7280;font-size:13px;margin-bottom:14px">${esc(q.date)}${q.model ? ` · model trained ${esc(q.model.trainedOn.slice(0, 10))}, ${q.model.names} names, ${q.model.horizon} sessions ahead` : ""}</div>
${q.market ? `<div style="font-size:15px;margin-bottom:10px">${esc(q.market.line)}</div>` : ""}
${q.market?.outlookLine ? `<div style="font-size:14px;margin-bottom:14px">${esc(q.market.outlookLine)}</div>` : ""}
${q.planHtml ? `<h3 style="margin:18px 0 6px;font-size:16px">The list: what to do, how much, where</h3>${q.planHtml}` : ""}
<div style="border:1px solid #d5d8dd;padding:14px 16px;font-size:14px;white-space:pre-line;margin-top:18px">${esc(q.detail)}</div>
${charts}`;
}

// The attachments the HTML refers to by content id.
export function quantEmailAttachments(q: QuantReport, light = false): Array<{ filename: string; content: Buffer; contentId: string }> {
  const items = light ? q.indices.filter((i) => i.symbol === "KSE100") : [...q.indices, ...q.holdings];
  return items.map((it) => ({ filename: `${it.symbol}.png`, content: it.png, contentId: `${it.symbol}.png` }));
}
