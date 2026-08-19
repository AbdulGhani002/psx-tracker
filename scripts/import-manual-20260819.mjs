// Two buys of 19 August 2026, entered from the owner's own figures rather than
// from a contract note: ABL 250 @ 178.26 and MUREB 25 @ 900.00, both confirmed
// as MARKET rates (commission not yet inside them).
//
// There is no note to reconcile against, so the fee convention is PROVEN
// instead of assumed. BMA charges 0.15% commission plus 15% SST on that
// commission, and the arithmetic is:
//
//   commission = round(qty * marketRate * 0.0015, 2)
//   SST        = round(commission * 0.15, 2)
//   fees       = commission + SST
//
// Before writing anything, the script re-derives the fees of the six BUY rows
// already on the ledger from 13 Aug and refuses to continue unless it
// reproduces every stored figure to the paisa. If the convention ever changes,
// this stops rather than quietly inventing costs.
//
// ABL opens a new position, so a Holding record is created too — without one
// the position is invisible, because buildPositionRows() iterates holdings, not
// transactions. Name and sector come from PSX, never from memory. No plan is
// set: the owner chose to record the trade only, so the sell engine stays
// silent on ABL until he sets a ceiling and an invalidator.
//
//   MONGODB_URI=... DRY_RUN=1 node scripts/import-manual-20260819.mjs
//   MONGODB_URI=... node scripts/import-manual-20260819.mjs
//
import mongoose from "mongoose";

const USER_ID = "6a368e470160489b1b496fd1";
const TRADE_DATE = new Date("2026-08-19T00:00:00.000Z");
const COMMISSION_RATE = 0.0015; // 0.15%
const SST_RATE = 0.15; // 15% on the commission

// symbol, qty, MARKET rate
const BUYS = [
  ["ABL", 250, 178.26],
  ["MUREB", 25, 900.0],
];

// Rows already on the ledger, used to prove the fee method reproduces reality.
const CONTROL = [
  ["PTL", 14, 54.19, 1.31],
  ["INDU", 3, 1946.97, 10.07],
  ["MUREB", 6, 915.9, 9.48],
  ["MARI", 11, 681.74, 12.94],
  ["HINOON", 10, 1005, 17.34],
  ["LUCK", 26, 448.5, 20.11],
];

const r2 = (v) => Math.round(v * 100) / 100;
const paisa = (v) => Math.round(v * 100);

function fees(qty, rate) {
  const totalAmount = r2(qty * rate);
  const commission = r2(totalAmount * COMMISSION_RATE);
  const sst = r2(commission * SST_RATE);
  return { totalAmount, commission, sst, fees: r2(commission + sst) };
}

const uri = process.env.MONGODB_URI;
const dry = process.env.DRY_RUN === "1";
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const UA = "Mozilla/5.0 (compatible; psx-tracker/0.1)";
const field = (html, k, nested) => {
  const re = nested
    ? new RegExp(`class="${k}"[^>]*>\\s*<span[^>]*>([^<]+)<`, "i")
    : new RegExp(`class="${k}"[^>]*>([^<]+)<`, "i");
  const m = html.match(re);
  return m ? m[1].trim() : null;
};
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

async function psx(symbol) {
  const res = await fetch(`https://dps.psx.com.pk/company/${symbol}`, {
    headers: { "user-agent": UA, accept: "text/html" },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const closeRaw = field(html, "quote__close");
  const price = closeRaw ? Number(String(closeRaw).replace(/Rs\.?/i, "").replace(/,/g, "")) : null;
  const asOfRaw = field(html, "quote__date");
  return {
    name: field(html, "quote__name"),
    sector: field(html, "quote__sector", true),
    price: Number.isFinite(price) ? price : null,
    asOf: asOfRaw ? asOfRaw.replace(/^\^?\s*As of\s*/i, "").trim() : "",
  };
}

const run = async () => {
  // --- prove the fee convention against rows already on the ledger ----------
  console.log("Proving the fee method against the 13 Aug rows already stored:");
  let broken = 0;
  for (const [sym, qty, rate, storedFees] of CONTROL) {
    const f = fees(qty, rate);
    const ok = paisa(f.fees) === paisa(storedFees);
    if (!ok) broken++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${sym.padEnd(7)} ${String(qty).padStart(3)} @ ${String(rate).padStart(8)}  computed ${f.fees
        .toFixed(2)
        .padStart(6)} vs stored ${storedFees.toFixed(2).padStart(6)}`
    );
  }
  if (broken > 0) {
    console.error(`\nREFUSING TO WRITE — the fee convention does not reproduce ${broken} existing row(s).`);
    process.exit(1);
  }
  console.log("  all six reproduce exactly — the 0.15% + 15% SST method is the one in use.\n");

  // --- the new rows ---------------------------------------------------------
  const rows = BUYS.map(([symbol, qty, rate]) => ({ symbol, qty, rate, ...fees(qty, rate) }));
  console.log("New buys, 19 Aug 2026 (market rates):");
  console.log("symbol   qty   market rate     comm     SST     fees        total          net");
  for (const r of rows) {
    r.netAmount = r2(r.totalAmount + r.fees);
    console.log(
      `${r.symbol.padEnd(7)} ${String(r.qty).padStart(4)}  ${r.rate.toFixed(2).padStart(11)} ${r.commission
        .toFixed(2)
        .padStart(8)} ${r.sst.toFixed(2).padStart(7)} ${r.fees.toFixed(2).padStart(8)} ${r.totalAmount
        .toFixed(2)
        .padStart(12)} ${r.netAmount.toFixed(2).padStart(12)}`
    );
  }
  console.log(`\noutlay ${r2(rows.reduce((s, r) => s + r.netAmount, 0))}\n`);

  await mongoose.connect(uri);
  const txCol = mongoose.connection.collection("transactions");
  const hCol = mongoose.connection.collection("holdings");

  // Duplicate guard.
  for (const r of rows) {
    const dupe = await txCol.findOne({
      userId: USER_ID,
      symbol: r.symbol,
      type: "BUY",
      date: TRADE_DATE,
      shares: r.qty,
      deletedAt: null,
    });
    if (dupe) {
      console.error(`REFUSING TO WRITE — ${r.symbol} ${r.qty} on this date already exists (_id ${dupe._id}).`);
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  // ABL opens a new position: it needs a Holding row or it will not be seen.
  const needHolding = [];
  for (const r of rows) {
    const h = await hCol.findOne({ userId: USER_ID, symbol: r.symbol });
    if (!h) needHolding.push(r.symbol);
  }
  const seeded = {};
  for (const sym of needHolding) {
    const info = await psx(sym);
    if (!info || !info.name || !info.sector) {
      console.error(`REFUSING TO WRITE — could not read ${sym} name/sector from PSX. Not inventing them.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    seeded[sym] = info;
    console.log(`${sym} is a new position — PSX says "${info.name}", ${titleCase(info.sector)}, last ${info.price}`);
  }

  if (dry) {
    console.log(`\n[DRY RUN] would insert ${rows.length} BUY rows and ${needHolding.length} holding record(s).`);
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  for (const sym of needHolding) {
    const info = seeded[sym];
    await hCol.insertOne({
      userId: USER_ID,
      symbol: sym,
      name: info.name,
      sector: titleCase(info.sector),
      // Left false: Shariah status is decided by KMI membership from the feed,
      // not by a guess here. The Shariah page will fill it in.
      shariaCompliant: false,
      currentShares: 0,
      avgCostBasis: 0,
      totalCost: 0,
      realizedPL: 0,
      totalDividendsReceived: 0,
      targetAllocationPercent: 0,
      rebalanceBand: 3,
      targetRationale: "",
      notes: "",
      tier: "",
      convictionScore: 0,
      goalTag: "",
      thesis: "",
      trackedMetrics: [],
      createdAt: now,
      updatedAt: now,
      __v: 0,
    });
    if (info.price != null) {
      await mongoose.connection.collection("pricesnapshots").insertOne({
        symbol: sym,
        price: info.price,
        timestamp: now,
        source: "psx-scraper",
        isMarketHours: true,
        asOf: info.asOf,
      });
    }
    console.log(`created holding ${sym} (${info.name})`);
  }

  const docs = rows.map((r) => ({
    userId: USER_ID,
    symbol: r.symbol,
    type: "BUY",
    date: TRADE_DATE,
    shares: r.qty,
    pricePerShare: r.rate,
    totalAmount: r.totalAmount,
    fees: r.fees,
    netAmount: r.netAmount,
    notes: "Manual entry (market rate, comm 0.15% + SST)",
    ratio: "",
    taxDeducted: 0,
    zakatDeducted: 0,
    financialYear: "",
    dividendType: "",
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    __v: 0,
  }));
  const res = await txCol.insertMany(docs);
  console.log(`\ninserted ${res.insertedCount} BUY rows.`);

  console.log("\nposition after (from all active transactions):");
  for (const sym of [...new Set(rows.map((r) => r.symbol))]) {
    const txs = await txCol.find({ userId: USER_ID, symbol: sym, deletedAt: null }).toArray();
    let shares = 0;
    let cost = 0;
    for (const t of txs) {
      if (t.type === "SELL") {
        // Average-cost convention: a sale removes shares at the running average.
        const avg = shares > 0 ? cost / shares : 0;
        cost += t.shares * avg; // t.shares is negative
        shares += t.shares;
      } else if (t.type !== "DIVIDEND") {
        shares += t.shares;
        cost += t.netAmount;
      }
    }
    console.log(`  ${sym.padEnd(7)} ${String(shares).padStart(6)} shares, avg cost ${(shares > 0 ? cost / shares : 0).toFixed(2)}`);
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("import failed:", err);
  process.exit(1);
});
