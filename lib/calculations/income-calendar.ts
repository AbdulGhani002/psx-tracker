// Income month by month over the financial year (July to June), after tax:
// dividends paid, announced and expected; T-bill and sukuk profit on the
// dates it is paid; and for savings and money market funds a month's profit
// at today's balance and rate, from this month on.
//
// A payment dated today or before is received, a later one expected. No
// server imports, so scripts/test-income-calendar.ts can run it.

export type IncomeInput = {
  today: string; // yyyy-mm-dd, Karachi
  dividends: Array<{ date: string; net: number }>; // recorded
  announced: Array<{ date: string; net: number }>; // announced, not yet recorded
  forecast: Array<{ date: string; gross: number }>; // expected, before tax
  dividendTaxPct: number;
  fixed: Array<{ date: string; net: number }>; // coupons and maturities, after tax
  cash: Array<{ value: number; ratePct: number; taxPct: number }>; // savings accounts, money market funds
};

export type IncomeCell = { received: number; expected: number };
export type IncomeMonth = { key: string; label: string; dividends: IncomeCell; fixed: IncomeCell; cash: IncomeCell; received: number; expected: number; past: boolean };
export type IncomeCalendar = { fyLabel: string; months: IncomeMonth[]; received: number; expected: number; hasFixed: boolean; hasCash: boolean };

const LABELS = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];

export function incomeCalendar(i: IncomeInput): IncomeCalendar {
  const y = Number(i.today.slice(0, 4)), m = Number(i.today.slice(5, 7));
  const start = m >= 7 ? y : y - 1;
  const thisMonth = i.today.slice(0, 7);
  const cell = (): IncomeCell => ({ received: 0, expected: 0 });
  const months: IncomeMonth[] = LABELS.map((label, k) => {
    const key = `${k < 6 ? start : start + 1}-${String(((k + 6) % 12) + 1).padStart(2, "0")}`;
    return { key, label, dividends: cell(), fixed: cell(), cash: cell(), received: 0, expected: 0, past: key < thisMonth };
  });
  const at = new Map(months.map((mo) => [mo.key, mo]));
  const put = (row: "dividends" | "fixed" | "cash", date: string, amount: number, received: boolean) => {
    const mo = at.get(date.slice(0, 7));
    if (!mo || !(amount > 0)) return;
    mo[row][received ? "received" : "expected"] += amount;
  };

  for (const d of i.dividends) put("dividends", d.date, d.net, true);
  for (const d of i.announced) put("dividends", d.date, d.net, d.date <= i.today);
  for (const d of i.forecast) put("dividends", d.date, d.gross * (1 - i.dividendTaxPct / 100), false);
  for (const f of i.fixed) put("fixed", f.date, f.net, f.date <= i.today);
  const monthly = i.cash.reduce((s, c) => s + (c.value * (c.ratePct / 100) * (1 - c.taxPct / 100)) / 12, 0);
  if (monthly > 0) for (const mo of months) if (!mo.past) mo.cash.expected += monthly;

  for (const mo of months) {
    mo.received = mo.dividends.received + mo.fixed.received + mo.cash.received;
    mo.expected = mo.dividends.expected + mo.fixed.expected + mo.cash.expected;
  }
  return {
    fyLabel: `FY${String(start).slice(2)}-${String(start + 1).slice(2)}`,
    months,
    received: months.reduce((s, mo) => s + mo.received, 0),
    expected: months.reduce((s, mo) => s + mo.expected, 0),
    hasFixed: months.some((mo) => mo.fixed.received + mo.fixed.expected > 0),
    hasCash: monthly > 0,
  };
}
