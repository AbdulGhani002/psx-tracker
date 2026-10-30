import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import { getFeedSnapshot, saveFeedSnapshot } from "@/lib/data";
import { parseAlfaTermRates, sheetDate } from "@/lib/fixed-income/rollover";

// What Bank Alfalah pays on a term deposit booked in its Alfa app, from its
// newest published deposit rate sheet (a PDF linked from its rate-sheet
// page): the rate at maturity by term. Kept a day; the last good copy stands
// while the site cannot be read.

const KEY = "bank:alfalah:term-rates";
const PAGE = "https://www.bankalfalah.com/personal-banking/rate-sheet/";
const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";
const DAY_MS = 86400000;

export type BankRates = { asOf: string; url: string; byMonths: Record<number, number> };

async function get(url: string): Promise<Response | null> {
  return fetch(url, { headers: { "user-agent": UA }, cache: "no-store", signal: AbortSignal.timeout(30000) }).catch(() => null);
}

export async function alfalahTermRates(force = false): Promise<BankRates | null> {
  const kept = await getFeedSnapshot<BankRates>(KEY).catch(() => null);
  if (!force && kept?.data && kept.updatedAt && Date.now() - new Date(kept.updatedAt).getTime() < DAY_MS) return kept.data;
  try {
    const page = await (await get(PAGE))?.text();
    const links = [...String(page ?? "").matchAll(/href="([^"]*Deposit[^"]*Rate[^"]*Sheet[^"]*\.pdf)"/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
    const dated = links.map((u) => ({ u, d: sheetDate(u) })).filter((x): x is { u: string; d: string } => x.d != null).sort((a, b) => b.d.localeCompare(a.d));
    for (const { u, d } of dated.slice(0, 3)) {
      const res = await get(u);
      if (!res?.ok) continue;
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(await res.arrayBuffer())), { mergePages: true });
      const byMonths = parseAlfaTermRates(String(text));
      if (Object.keys(byMonths).length === 0) continue;
      const data: BankRates = { asOf: d, url: u, byMonths };
      await saveFeedSnapshot(KEY, data, "ok", `${d}: ${Object.entries(byMonths).map(([m, r]) => `${m}M ${r}%`).join(", ")}`).catch(() => {});
      return data;
    }
    await saveFeedSnapshot(KEY, null, "stale", "no rate sheet read").catch(() => {});
  } catch {
    /* the last good copy */
  }
  return kept?.data ?? null;
}
