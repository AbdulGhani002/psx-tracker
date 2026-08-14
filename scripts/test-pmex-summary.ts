// Financial-year roll-up for PMEX contracts.
import { valueTrade } from "../lib/calculations/pmex";
import {
  summarisePmex,
  fyWindow,
  financialYearOf,
  activeFinancialYears,
  type PmexTrade,
} from "../lib/calculations/pmex-summary";

let pass = 0;
const fails: string[] = [];
function eq(label: string, got: unknown, want: unknown) {
  const g = typeof got === "number" ? Math.round(got * 100) / 100 : got;
  const w = typeof want === "number" ? Math.round(want * 100) / 100 : want;
  if (JSON.stringify(g) === JSON.stringify(w)) pass++;
  else fails.push(`${label}: got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`);
}

// --- financial year boundaries ---------------------------------------------
eq("FY of 1 Jul is next FY", financialYearOf("2025-07-01").label, "FY2026");
eq("FY of 30 Jun is this FY", financialYearOf("2026-06-30").label, "FY2026");
eq("FY of 30 Jun start", fyWindow(2026).start, "2025-07-01");
eq("FY of 30 Jun end", fyWindow(2026).end, "2026-06-30");
eq("June belongs to ending FY", financialYearOf("2026-06-01").label, "FY2026");
eq("July flips the year", financialYearOf("2026-07-01").label, "FY2027");

const COMM = 200;
const CGT = 15;

const t = (o: Partial<PmexTrade>): PmexTrade => ({
  symbol: "GOLD",
  side: "LONG",
  lots: 1,
  lotSize: 10,
  entryPrice: 1000,
  exitPrice: null,
  currentPrice: null,
  status: "OPEN",
  entryDate: "2025-08-01",
  exitDate: null,
  ...o,
});

// --- realised belongs to the year of the EXIT -------------------------------
{
  // Opened in FY2025 (May 2025), closed in FY2026 (Aug 2025).
  const straddle = t({ entryDate: "2025-05-01", exitDate: "2025-08-15", exitPrice: 1100, status: "CLOSED" });
  const fy26 = summarisePmex([straddle], COMM, CGT, fyWindow(2026));
  const fy25 = summarisePmex([straddle], COMM, CGT, fyWindow(2025));
  // 10 units x 100 gain = 1000 gross, less 200 commission = 800 net
  eq("straddling trade lands in exit FY", fy26.realised.net, 800);
  eq("straddling trade absent from entry FY", fy25.realised.trades, 0);
  eq("CGT 15% of 800", fy26.realised.cgt, 120);
  eq("net after tax", fy26.realised.netAfterTax, 680);
  eq("hold days counted", fy26.stats.avgHoldDays, 106);
}

// --- SHORT direction --------------------------------------------------------
{
  const short = t({ side: "SHORT", exitPrice: 900, exitDate: "2025-09-01", status: "CLOSED" });
  const s = summarisePmex([short], COMM, CGT, fyWindow(2026));
  // Short from 1000 to 900 on 10 units = +1000 gross, -200 comm
  eq("short profits when price falls", s.realised.net, 800);
}

// --- open contracts: marked vs unmarked -------------------------------------
{
  const marked = t({ symbol: "CRUDE", currentPrice: 1050 });
  const unmarked = t({ symbol: "SILVER" });
  const s = summarisePmex([marked, unmarked], COMM, CGT, fyWindow(2026));
  eq("both counted as open", s.open.trades, 2);
  // 10 units x 50 = 500 gross - 200 comm = 300
  eq("only the marked one contributes P/L", s.open.net, 300);
  eq("unmarked flagged, not valued", s.open.unmarked, 1);
  eq("exposure counts both", s.open.exposure, 20000);
  eq("no CGT on open contracts", s.realised.cgt, 0);
}

// --- a contract opened after the year ends is not that year's ---------------
{
  const future = t({ entryDate: "2026-08-01", currentPrice: 1200 });
  const s = summarisePmex([future], COMM, CGT, fyWindow(2026));
  eq("next-year contract excluded", s.open.trades, 0);
}

// --- per-instrument attribution ---------------------------------------------
{
  const trades: PmexTrade[] = [
    t({ symbol: "GOLD", exitPrice: 1100, exitDate: "2025-08-10", status: "CLOSED" }), // +800
    t({ symbol: "GOLD", exitPrice: 900, exitDate: "2025-09-10", status: "CLOSED" }), // -1200
    t({ symbol: "EURUSD", exitPrice: 1050, exitDate: "2025-10-10", status: "CLOSED" }), // +300
  ];
  const s = summarisePmex(trades, COMM, CGT, fyWindow(2026));
  eq("instruments listed", s.byInstrument.length, 2);
  eq("best instrument first", s.byInstrument[0].symbol, "EURUSD");
  eq("gold nets its two contracts", s.byInstrument.find((r) => r.symbol === "GOLD")!.net, -400);
  eq("total realised", s.realised.net, -100);
  // CGT is charged per winning contract, never on the net loss
  eq("CGT only on winners", s.realised.cgt, (800 + 300) * 0.15);
}

// --- trading statistics ------------------------------------------------------
{
  const trades: PmexTrade[] = [
    t({ exitPrice: 1100, exitDate: "2025-08-10", status: "CLOSED" }), // +800
    t({ exitPrice: 1050, exitDate: "2025-08-20", status: "CLOSED" }), // +300
    t({ exitPrice: 900, exitDate: "2025-09-10", status: "CLOSED" }), // -1200
  ];
  const s = summarisePmex(trades, COMM, CGT, fyWindow(2026));
  eq("wins", s.stats.wins, 2);
  eq("losses", s.stats.losses, 1);
  eq("win rate", s.stats.winRatePct, 66.67);
  eq("avg win", s.stats.avgWin, 550);
  eq("avg loss is negative", s.stats.avgLoss, -1200);
  eq("profit factor", s.stats.profitFactor, 1100 / 1200);
  eq("expectancy", s.stats.expectancy, -33.33);
  eq("best", s.stats.bestNet, 800);
  eq("worst", s.stats.worstNet, -1200);
}

// --- no losers: profit factor must not be Infinity --------------------------
{
  const s = summarisePmex(
    [t({ exitPrice: 1100, exitDate: "2025-08-10", status: "CLOSED" })],
    COMM,
    CGT,
    fyWindow(2026)
  );
  eq("profit factor null when nothing lost", s.stats.profitFactor, null);
  eq("win rate 100", s.stats.winRatePct, 100);
}

// --- empty book --------------------------------------------------------------
{
  const s = summarisePmex([], COMM, CGT, fyWindow(2026));
  eq("empty realised", s.realised.net, 0);
  eq("empty stats stay null", s.stats.winRatePct, null);
  eq("empty expectancy null", s.stats.expectancy, null);
  eq("no instruments", s.byInstrument.length, 0);
}

// --- active years -------------------------------------------------------------
{
  const years = activeFinancialYears([
    t({ entryDate: "2025-05-01", exitDate: "2025-08-15", exitPrice: 1, status: "CLOSED" }),
    t({ entryDate: "2026-07-02" }),
  ]);
  eq("years newest first", years.map((y) => y.label), ["FY2027", "FY2026", "FY2025"]);
}

// --- expiry: the futures-specific risk -------------------------------------
{
  const TODAY = "2026-08-14";
  const far = t({ symbol: "GOLD", expiryDate: "2026-12-16", currentPrice: 1000 });
  const soon = t({ symbol: "CRUDE", expiryDate: "2026-08-19", currentPrice: 1000 });
  const past = t({ symbol: "SILVER", expiryDate: "2026-08-10", currentPrice: 1000 });
  const s = summarisePmex([far, soon, past], COMM, CGT, fyWindow(2027), TODAY);
  eq("only urgent contracts listed", s.attention.length, 2);
  eq("expired sorts first", s.attention[0].symbol, "SILVER");
  eq("expired state", s.attention[0].state, "expired");
  eq("days negative when past", s.attention[0].daysToExpiry, -4);
  eq("near state", s.attention[1].state, "near");
  eq("days to expiry", s.attention[1].daysToExpiry, 5);
  eq("cash settled carries no delivery risk", s.attention[0].deliveryRisk, false);
}

// --- a DELIVERABLE contract past expiry means actual delivery ---------------
{
  const TODAY = "2026-08-14";
  const d = t({ symbol: "GOLD", expiryDate: "2026-08-13", contractType: "DELIVERABLE", currentPrice: 1000 });
  const s = summarisePmex([d], COMM, CGT, fyWindow(2027), TODAY);
  eq("delivery risk flagged", s.attention[0].deliveryRisk, true);
}

// --- a closed contract is never urgent, whatever its expiry -----------------
{
  const TODAY = "2026-08-14";
  const closed = t({
    expiryDate: "2026-08-01",
    contractType: "DELIVERABLE",
    exitPrice: 1100,
    exitDate: "2025-12-01",
    status: "CLOSED",
  });
  const s = summarisePmex([closed], COMM, CGT, fyWindow(2026), TODAY);
  eq("closed contracts raise no alert", s.attention.length, 0);
}

// --- missing expiry is counted, not guessed ---------------------------------
{
  const s = summarisePmex([t({ currentPrice: 1000 })], COMM, CGT, fyWindow(2026), "2026-08-14");
  eq("no expiry recorded is counted", s.open.noExpiryRecorded, 1);
  eq("and raises no false alert", s.attention.length, 0);
}

// --- margin, leverage and return on margin ----------------------------------
{
  const s = summarisePmex(
    [t({ currentPrice: 1000, marginPosted: 2000 }), t({ currentPrice: 1000, marginPosted: 3000 })],
    COMM,
    CGT,
    fyWindow(2026),
    "2026-08-14"
  );
  eq("margin summed", s.open.marginPosted, 5000);
  // two contracts x 10 units x 1000 = 20000 exposure on 5000 margin
  eq("book leverage", s.open.leverage, 4);
}
{
  const s = summarisePmex([t({ currentPrice: 1000 })], COMM, CGT, fyWindow(2026), "2026-08-14");
  eq("leverage null when no margin recorded", s.open.leverage, null);
}
{
  // 10 units x 100 gain = 1000 gross, -200 comm = 800 net on 2000 margin
  const v = valueTrade(
    { side: "LONG", lots: 1, lotSize: 10, entryPrice: 1000, exitPrice: 1100, currentPrice: null, status: "CLOSED", marginPosted: 2000 },
    COMM,
    CGT
  );
  eq("return on margin", v.returnOnMarginPct, 0.4);
  eq("return on notional is far smaller", v.returnPct, 0.08);
  eq("leverage on the contract", v.leverage, 5);
}
{
  const v = valueTrade(
    { side: "LONG", lots: 1, lotSize: 10, entryPrice: 1000, exitPrice: 1100, currentPrice: null, status: "CLOSED" },
    COMM,
    CGT
  );
  eq("no margin means no faked margin return", v.returnOnMarginPct, null);
  eq("no margin means no faked leverage", v.leverage, null);
}

if (fails.length) {
  console.error(`FAILED ${fails.length}:`);
  for (const f of fails) console.error("  " + f);
  process.exit(1);
}
console.log(`test-pmex-summary: ${pass} assertions passed`);
