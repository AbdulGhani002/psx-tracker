// The June tax check: on 1 June, before the tax year closes on 30 June, the
// year's gains booked and the CGT on them, the dividends and their tax, and
// the shares held under cost, whose loss counts against this year's gains
// if sold before the year ends. Pure, so scripts/test-tax-june.ts runs it.

export type JuneInput = {
  label: string; // the tax year, e.g. "FY25-26"
  netGain: number;
  cgt: number;
  ratePct: number;
  dividendsNet: number;
  dividendTax: number;
  losers: Array<{ symbol: string; open: number; parked: boolean }>;
};

const rs = (v: number) => `${v < 0 ? "−" : ""}Rs ${Math.round(Math.abs(v)).toLocaleString("en-US")}`;

// Due from 1 June to 29 June, Karachi time.
export const juneDue = (today: string) => today.slice(5, 7) === "06" && Number(today.slice(8, 10)) <= 29;

export function juneMessage(i: JuneInput, link: string): string {
  const lines = [`🧾 <b>June tax check, ${i.label}</b>: the tax year ends 30 June.`];
  lines.push(i.netGain > 0 ? `   Gains booked: ${rs(i.netGain)} net, CGT ${rs(i.cgt)} at ${i.ratePct}%.` : `   Gains booked: ${rs(i.netGain)} net, no CGT.`);
  if (i.dividendsNet > 0) lines.push(`   Dividends: ${rs(i.dividendsNet)} after ${rs(i.dividendTax)} tax withheld.`);
  const losers = [...i.losers].filter((l) => l.open <= -1).sort((a, b) => a.open - b.open);
  if (losers.length) {
    const total = losers.reduce((s, l) => s + l.open, 0);
    lines.push(`   Under cost: ${losers.map((l) => `${l.symbol}${l.parked ? " (parked)" : ""} ${rs(l.open)}`).join(", ")}; ${rs(total)} in all.`);
    if (i.netGain > 0) lines.push(`   A loss booked before 30 June is set against this year's gains.`);
  } else lines.push("   No share is under cost.");
  lines.push(`   ${link}`);
  return lines.join("\n");
}
