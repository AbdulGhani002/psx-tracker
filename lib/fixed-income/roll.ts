import "server-only";
import { connectDb } from "@/lib/db";
import { FixedIncomeModel } from "@/lib/models";
import { alfalahTermRates, type BankRates } from "@/lib/feeds/bank-rates";
import { nextTerm, termMonths, type RolloverMode } from "./rollover";
import type { FixedIncomeHolding } from "./value";

// Deposits that roll over, rolled on the day they mature (lib/fixed-income/
// rollover): the next term is a new record and the old one points to it. The
// rate is the bank's published rate for the term (Bank Alfalah's rate
// sheet); else the rate on your newest deposit with the same bank and term;
// else the old term's. Every hour with the snapshots; a term is never rolled
// twice.

const pkToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export type Rolled = { userId: string; id: string; name: string; cost: number; ratePct: number; from: string; to: string; source: string };

async function rateFor(d: any, months: number | null, sheet: BankRates | null): Promise<{ rate: number; source: string }> {
  if (/alfalah/i.test(String(d.name)) && months && sheet?.byMonths[months] != null) return { rate: sheet.byMonths[months], source: `Bank Alfalah's rate sheet of ${sheet.asOf}` };
  const peers = (await FixedIncomeModel.find({ userId: d.userId, kind: "fd", name: d.name, purchaseDate: { $gt: d.purchaseDate } }, { purchaseDate: 1, maturityDate: 1, couponPct: 1 }).sort({ purchaseDate: -1 }).lean()) as any[];
  const same = peers.find((p) => termMonths(p.purchaseDate, p.maturityDate) === months);
  if (same) return { rate: Number(same.couponPct), source: `estimated: the rate on your deposit of ${same.purchaseDate}` };
  return { rate: Number(d.couponPct), source: "estimated: the old term's rate" };
}

export async function rollDeposits(today = pkToday()): Promise<Rolled[]> {
  await connectDb();
  const due = (await FixedIncomeModel.find({ kind: "fd", rollover: { $in: ["principal", "all"] }, rolledTo: { $in: ["", null] }, maturityDate: { $lte: today } }).lean()) as any[];
  if (due.length === 0) return [];
  const sheet = due.some((d) => /alfalah/i.test(String(d.name))) ? await alfalahTermRates().catch(() => null) : null;
  const out: Rolled[] = [];
  for (const first of due) {
    let d: any = first;
    while (d && d.maturityDate <= today) {
      const claimed = await FixedIncomeModel.updateOne({ _id: d._id, rolledTo: { $in: ["", null] } }, { $set: { rolledTo: "rolling" } });
      if (claimed.modifiedCount !== 1) break;
      const h: FixedIncomeHolding = { kind: "fd", name: d.name, face: Number(d.face), cost: Number(d.cost), purchaseDate: d.purchaseDate, maturityDate: d.maturityDate, couponPct: Number(d.couponPct) || 0, couponsPerYear: Number(d.couponsPerYear) || 0, taxPct: d.taxPct ?? 15 };
      const { rate, source } = await rateFor(d, termMonths(d.purchaseDate, d.maturityDate), sheet);
      const n = nextTerm(h, d.rollover as RolloverMode, rate);
      const ref = String(d.notes ?? "").match(/MM\d{6,}/)?.[0];
      try {
        const created = await FixedIncomeModel.create({ userId: d.userId, portfolioId: d.portfolioId ?? "", kind: "fd", name: d.name, ...n, pricePct: null, rollover: d.rollover, rolledFrom: String(d._id), notes: `${ref ? `${ref}: ` : ""}rolled over ${d.maturityDate}, ${d.rollover === "all" ? "principal and profit" : "principal"}, at ${rate}% (${source}).` });
        await FixedIncomeModel.updateOne({ _id: d._id }, { $set: { rolledTo: String(created._id) } });
        out.push({ userId: d.userId, id: String(created._id), name: d.name, cost: n.cost, ratePct: rate, from: n.purchaseDate, to: n.maturityDate, source });
        d = created.toObject();
      } catch (e) {
        await FixedIncomeModel.updateOne({ _id: d._id }, { $set: { rolledTo: "" } });
        throw e;
      }
    }
  }
  return out;
}
