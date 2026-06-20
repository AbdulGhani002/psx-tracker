import { NextRequest, NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { connectDb } from "@/lib/db";
import { HoldingModel, TransactionModel, TRANSACTION_TYPES } from "@/lib/models";
import { getCompanyInfo } from "@/lib/prices";
import { deriveFromTransactions } from "@/lib/calculations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Row = {
  symbol: string;
  type: string;
  date: string;
  shares: number;
  pricePerShare: number;
  fees: number;
  notes: string;
};

// Tolerant CSV parser (handles quoted fields with commas).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some((x) => x.trim() !== "")) rows.push(row); }
  return rows;
}

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, "");
}

// Map a header name to a known field.
const FIELD_ALIASES: Record<string, string> = {
  symbol: "symbol", ticker: "symbol", scrip: "symbol",
  type: "type", action: "type", side: "type", transactiontype: "type",
  date: "date", tradedate: "date", txndate: "date",
  shares: "shares", quantity: "shares", qty: "shares", volume: "shares",
  price: "pricePerShare", pricepershare: "pricePerShare", rate: "pricePerShare", avgprice: "pricePerShare",
  fees: "fees", fee: "fees", commission: "fees", charges: "fees", brokerage: "fees",
  notes: "notes", note: "notes", remarks: "notes", description: "notes",
};

function toIsoDate(s: string): string | null {
  s = s.trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); // yyyy-mm-dd
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); // dd-mm-yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function num(s: string): number {
  const n = Number((s ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function recompute(symbol: string) {
  const txs = await TransactionModel.find({ userId: await uid(), symbol, deletedAt: null }).sort({ date: 1, createdAt: 1 }).lean();
  const d = deriveFromTransactions(txs as any);
  await HoldingModel.findOneAndUpdate({ userId: await uid(), symbol }, {
    currentShares: d.shares, avgCostBasis: d.avgCost, totalCost: d.totalCost,
    realizedPL: d.realizedPL, totalDividendsReceived: d.dividendsReceived,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const csv: string = body?.csv ?? "";
    const dryRun: boolean = body?.dryRun ?? false;
    if (!csv.trim()) return NextResponse.json({ error: "empty_csv" }, { status: 400 });
    if (csv.length > 5_000_000) {
      return NextResponse.json({ error: "csv_too_large", detail: "CSV exceeds 5 MB." }, { status: 400 });
    }

    const grid = parseCsv(csv);
    if (grid.length < 2) return NextResponse.json({ error: "no_rows" }, { status: 400 });
    if (grid.length > 10_001) {
      return NextResponse.json({ error: "too_many_rows", detail: "Max 10,000 rows per import." }, { status: 400 });
    }

    const header = grid[0].map(normHeader);
    const colMap: Record<string, number> = {};
    header.forEach((h, i) => {
      const field = FIELD_ALIASES[h];
      if (field && colMap[field] === undefined) colMap[field] = i;
    });
    if (colMap.symbol === undefined || colMap.type === undefined || colMap.date === undefined) {
      return NextResponse.json({ error: "missing_columns", detail: "Need at least symbol, type, date columns.", header }, { status: 400 });
    }

    const parsed: Row[] = [];
    const errors: Array<{ line: number; reason: string }> = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const symbol = (r[colMap.symbol] ?? "").trim().toUpperCase();
      let type = (r[colMap.type] ?? "").trim().toUpperCase();
      if (type === "BUY"[0] || type === "B") type = "BUY";
      if (type === "S") type = "SELL";
      if (type === "DIV" || type === "DIVIDEND") type = "DIVIDEND";
      const date = toIsoDate(r[colMap.date] ?? "");
      if (!symbol || !TRANSACTION_TYPES.includes(type as any) || !date) {
        errors.push({ line: i + 1, reason: `symbol/type/date invalid (${symbol}/${type}/${r[colMap.date]})` });
        continue;
      }
      parsed.push({
        symbol, type, date,
        shares: colMap.shares !== undefined ? num(r[colMap.shares]) : 0,
        pricePerShare: colMap.pricePerShare !== undefined ? num(r[colMap.pricePerShare]) : 0,
        fees: colMap.fees !== undefined ? num(r[colMap.fees]) : 0,
        notes: colMap.notes !== undefined ? (r[colMap.notes] ?? "").trim() : "Imported",
      });
    }

    if (dryRun) {
      return NextResponse.json({ preview: parsed.slice(0, 50), total: parsed.length, errors, mapped: colMap });
    }

    await connectDb();
    let imported = 0;
    const touchedSymbols = new Set<string>();
    for (const row of parsed) {
      let holding = await HoldingModel.findOne({ userId: await uid(), symbol: row.symbol });
      if (!holding) {
        const info = await getCompanyInfo(row.symbol);
        holding = await HoldingModel.create({
      userId: await uid(),
          symbol: row.symbol, name: info?.name ?? row.symbol, sector: info?.sector ?? "Unknown", shariaCompliant: false,
        });
      }
      let signedShares = row.shares;
      if (row.type === "SELL" && signedShares > 0) signedShares = -Math.abs(signedShares);
      else if (row.type !== "SELL") signedShares = Math.abs(signedShares);
      const totalAmount = Math.abs(signedShares) * row.pricePerShare;
      let netAmount = totalAmount;
      if (row.type === "BUY" || row.type === "RIGHT") netAmount = totalAmount + row.fees;
      else if (row.type === "SELL") netAmount = totalAmount - row.fees;
      else if (row.type === "DIVIDEND") netAmount = totalAmount - row.fees;
      else netAmount = 0;

      await TransactionModel.create({
      userId: await uid(),
        symbol: row.symbol, type: row.type, date: new Date(row.date),
        shares: signedShares, pricePerShare: row.pricePerShare, totalAmount,
        fees: row.fees, netAmount, notes: row.notes, ratio: "",
      });
      imported++;
      touchedSymbols.add(row.symbol);
    }
    for (const s of touchedSymbols) await recompute(s);

    return NextResponse.json({ imported, errors, symbols: [...touchedSymbols] });
  } catch (err) {
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
