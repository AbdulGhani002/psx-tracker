import { NextRequest, NextResponse } from "next/server";
import symbols from "@/lib/psx-symbols.json";
import { LOGOS } from "@/lib/logo-list";

export const dynamic = "force-dynamic";

type Row = { symbol: string; name: string; sector: string; etf?: boolean };

// Symbol search for the trade form: a prefix match on the symbol first, then
// a word match on the name, from the DPS list scripts/fetch-logos.py saved.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toUpperCase();
  const rows = symbols as Row[];
  if (!q) return NextResponse.json({ results: [] });
  const starts = rows.filter((r) => r.symbol.startsWith(q));
  const names = rows.filter((r) => !r.symbol.startsWith(q) && (r.symbol.includes(q) || r.name.toUpperCase().includes(q)));
  const results = [...starts, ...names].slice(0, 12).map((r) => ({ symbol: r.symbol, name: r.name, sector: r.sector, logo: !!LOGOS[r.symbol] }));
  return NextResponse.json({ results });
}
