// BMA contract-note parser tests — reconciliation gates, fill merging, SST allocation.
// Run: npx tsx scripts/test-bma-note.ts
//
// Fixtures reconstruct the two real 30-Jul-2026 notes (already imported by hand
// and verified to the paisa) as positional-extraction lines. The corrupt fixtures
// prove the parser refuses to import when arithmetic doesn't reconcile.

import { parseBmaNote, toImportRows } from "../lib/brokers/bma-note";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, extra = "") {
  cond ? (pass++, console.log(`  ok   ${label}`)) : (fail++, console.log(`  FAIL ${label}  ${extra}`));
}
function near(a: number | undefined | null, b: number, tol = 0.02) { return a != null && Math.abs(a - b) <= tol; }

// ---- BUY note: INDU 20 @ 1935 + MARI 7 @ 652.98 (qty column on the left) ----
const BUY_PAGE = [
  "BMA Capital Management Limited",
  "PURCHASE CONFIRMATION",
  "Trade Date: 30/07/2026 Settlement Date: 01/08/2026",
  "Quantity Symbol Market Rate Comm. Net Rate Amount Payable",
  "20 INDU - PK0008101014 - INDUS MOTOR COMPANY LIMITED 1,935.0000 2.9025 1,937.9025 38,758.05",
  "7 MARI - PK0074801013 - MARI ENERGIES LIMITED 652.9800 0.9795 653.9595 4,577.72",
  "T O T A L 27 43,335.77",
  "S.S.T. 9.74",
  "G R A N D  T O T A L 43,345.51",
];

// ---- SELL note: PAKT 12 + four HUBC fills @ 217.76 (qty column on the right) ----
const SELL_PAGE = [
  "BMA Capital Management Limited",
  "SALE CONFIRMATION",
  "Trade Date: 30/07/2026 Settlement Date: 01/08/2026",
  "Symbol Market Rate Comm. Net Rate Amount Receivable Quantity",
  "PAKT - PK0270201095 - PAKISTAN TOBACCO COMPANY LIMITED 1,445.1000 2.1677 1,442.9323 17,315.19 12",
  "HUBC - PK0075501015 - THE HUB POWER COMPANY LIMITED 217.7600 0.3266 217.4334 24,135.11 111",
  "HUBC - PK0075501015 - THE HUB POWER COMPANY LIMITED 217.7600 0.3266 217.4334 652.30 3",
  "HUBC - PK0075501015 - THE HUB POWER COMPANY LIMITED 217.7600 0.3266 217.4334 217.43 1",
  "HUBC - PK0075501015 - THE HUB POWER COMPANY LIMITED 217.7600 0.3266 217.4334 1,087.17 5",
  "T O T A L 132 43,407.20",
  "S.S.T. 9.78",
  "G R A N D  T O T A L 43,397.42",
];

console.log("BUY note reconciles and parses");
const [buy] = parseBmaNote([BUY_PAGE]);
ok("recognised as BUY", buy?.side === "BUY");
ok("trade date ISO", buy?.tradeDate === "2026-07-30");
ok("no problems", buy?.problems.length === 0, JSON.stringify(buy?.problems));
ok("two rows", buy?.rows.length === 2);
ok("INDU qty 20 @ market 1935", buy?.rows[0].qty === 20 && buy?.rows[0].marketRate === 1935);
ok("row sum matches note total", near(buy?.totalAmount, 43_335.77));
ok("SST + grand captured", buy?.sst === 9.74 && buy?.grandTotal === 43_345.51);

console.log("\nBUY import rows carry market price + comm+SST as fees");
const buyRows = toImportRows(buy);
ok("two import rows", buyRows.length === 2);
const indu = buyRows.find((r) => r.symbol === "INDU")!;
const mari = buyRows.find((r) => r.symbol === "MARI")!;
ok("INDU price is MARKET rate", indu.price === 1935);
ok("INDU fees = comm 58.05 + SST share ≈ 66.76", near(indu.fees, 66.76));
ok("MARI fees = comm 6.86 + SST share ≈ 7.89", near(mari.fees, 7.89));
ok("fees sum to comm+SST", near(indu.fees + mari.fees, 64.91 + 9.74));
ok("type/date threaded", indu.type === "BUY" && indu.date === "2026-07-30");

console.log("\nSELL note: fills at one price merge into one row");
const [sell] = parseBmaNote([SELL_PAGE]);
ok("recognised as SELL", sell?.side === "SELL");
ok("no problems", sell?.problems.length === 0, JSON.stringify(sell?.problems));
ok("five raw rows (4 HUBC fills)", sell?.rows.length === 5);
const sellRows = toImportRows(sell);
ok("merged to two import rows", sellRows.length === 2);
const hubc = sellRows.find((r) => r.symbol === "HUBC")!;
ok("HUBC fills 111+3+1+5 → 120 shares", hubc.shares === 120);
ok("HUBC price 217.76", hubc.price === 217.76);
ok("SELL fees split by commission share", near(sellRows.reduce((s, r) => s + r.fees, 0), 65.20 + 9.78, 0.03));

console.log("\ncorrupt notes are refused — never imported");
const tampered = BUY_PAGE.map((l) => l.replace("38,758.05", "38,958.05"));
const [bad] = parseBmaNote([tampered]);
ok("tampered amount → problems reported", bad.problems.length > 0, JSON.stringify(bad.problems));
ok("tampered amount → zero import rows", toImportRows(bad).length === 0);

const noSst = BUY_PAGE.filter((l) => !l.startsWith("S.S.T"));
const [miss] = parseBmaNote([noSst]);
ok("missing SST → problem named", miss.problems.some((p) => p.includes("S.S.T")));

const alien = [["Some other broker", "TRADE ADVICE", "totally different layout 123.45"]];
ok("unknown layout → no confirmations at all", parseBmaNote(alien).length === 0);

const emptyBuy = [["PURCHASE CONFIRMATION", "Trade Date: 30/07/2026", "nothing tabular here"]];
const [none] = parseBmaNote(emptyBuy);
ok("confirmation with no rows → loud problem", none.problems.some((p) => p.includes("no trade rows")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
