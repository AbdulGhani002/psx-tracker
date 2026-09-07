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


// ---------------------------------------- the quantity after the company name
// BMA has printed the quantity in more than one place. This layout, from the
// 7 September 2026 note, puts it between the company name and the market rate.
// The old regex only looked for it leading or trailing, so it matched the four
// money columns, found no quantity, and refused the whole note.
{
  const page = [
    "PURCHASE CONFIRMATION 54223886",
    "Client Name: MUHAMMAD ABDUL GHANI QURESHI - 56088",
    "Trade Date: 07/09/2026",
    "Security Name Quantity Market (+) Net Rate Amount",
    "MEBL - PK0077401013 - MEEZAN BANK LTD 10 564.9800 0.8480 565.8280 5,658.28",
    "MEBL - PK0077401013 - MEEZAN BANK LTD 60 564.9800 0.8475 565.8275 33,949.65",
    "PPL - PK0081801018 - PAKISTAN PETROLEUM LIMITED 40 227.7600 0.3415 228.1015 9,124.06",
    "PTL - PK0125201019 - PANTHER TYRES LIMITED 89 53.6900 0.0804 53.7704 4,785.57",
    "PTL - PK0125201019 - PANTHER TYRES LIMITED 1 53.6500 0.0800 53.7300 53.73",
    "TOTAL 200 53,571.29",
    "S.S.T 12.03",
    "G R A N D T O T A L 53,583.32",
  ];
  const [c] = parseBmaNote([page]);

  ok("mid-line quantity: the note reconciles", c.problems.length === 0, c.problems.join(" | "));
  ok("mid-line quantity: five rows read", c.rows.length === 5, String(c.rows.length));
  ok("mid-line quantity: quantities are right", c.rows.map((r) => r.qty).join(",") === "10,60,40,89,1", c.rows.map((r) => r.qty).join(","));
  ok("mid-line quantity: the name excludes the digits", c.rows[0].name === "MEEZAN BANK LTD", c.rows[0].name);
  ok("mid-line quantity: market rate is the market rate", c.rows[0].marketRate === 564.98, String(c.rows[0].marketRate));
  ok("mid-line quantity: net rate is market plus commission", c.rows[0].netRate === 565.828, String(c.rows[0].netRate));
  ok("mid-line quantity: total quantity", c.totalQty === 200, String(c.totalQty));
  ok("mid-line quantity: grand total", c.grandTotal === 53583.32, String(c.grandTotal));

  const rows = toImportRows(c);
  // The two MEBL fills share a market rate, so they merge into one position.
  ok("mid-line quantity: same price merges", rows.filter((r) => r.symbol === "MEBL").length === 1, String(rows.length));
  ok("mid-line quantity: merged MEBL is 70 shares", rows.find((r) => r.symbol === "MEBL")?.shares === 70, String(rows.find((r) => r.symbol === "MEBL")?.shares));
  // The two PTL fills do NOT share a rate, so they stay apart.
  ok("mid-line quantity: different prices stay apart", rows.filter((r) => r.symbol === "PTL").length === 2, String(rows.filter((r) => r.symbol === "PTL").length));

  // Every rupee on the note has to land somewhere.
  const net = rows.reduce((s, r) => s + r.shares * r.price + r.fees, 0);
  ok("mid-line quantity: import rows add to the grand total", Math.abs(net - 53583.32) < 0.02, net.toFixed(2));
}

{
  // A sale in the same layout: commission comes OFF the market rate.
  const page = [
    "SALE CONFIRMATION 54229507",
    "Trade Date: 07/09/2026",
    "ABL - PK0083501012 - ALLIED BANK LIMITED 250 170.7500 0.2561 170.4939 42,623.47",
    "TOTAL 250 42,623.47",
    "S.S.T 9.61",
    "G R A N D T O T A L 42,613.86",
  ];
  const [c] = parseBmaNote([page]);
  ok("sale in the same layout reconciles", c.problems.length === 0, c.problems.join(" | "));
  ok("sale side is read", c.side === "SELL", c.side);
  ok("sale quantity", c.rows[0]?.qty === 250, String(c.rows[0]?.qty));
  const rows = toImportRows(c);
  const proceeds = rows[0].shares * rows[0].price - rows[0].fees;
  ok("sale proceeds equal the grand total", Math.abs(proceeds - 42613.86) < 0.02, proceeds.toFixed(2));
}

{
  // The old leading-quantity layout must still work.
  const page = [
    "PURCHASE CONFIRMATION 1",
    "Trade Date: 01/08/2026",
    "500 ENGRO - PK0068901014 - ENGRO CORPORATION 285.5000 0.1500 285.6500 142,825.00",
    "TOTAL 500 142,825.00",
    "S.S.T 12.00",
    "G R A N D T O T A L 142,837.00",
  ];
  const [c] = parseBmaNote([page]);
  ok("leading-quantity layout still reads", c.problems.length === 0, c.problems.join(" | "));
  ok("leading quantity is picked up", c.rows[0]?.qty === 500, String(c.rows[0]?.qty));
  ok("leading layout: name is clean", c.rows[0]?.name === "ENGRO CORPORATION", c.rows[0]?.name);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
