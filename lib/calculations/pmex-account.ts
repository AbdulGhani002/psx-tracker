// The PMEX account itself, as opposed to the contracts held inside it.
//
// PMEX's back office reports P/L per SESSION, not per position: a day's
// realised profit, its commission, its fees and its tax, with no entry price,
// exit price or lot count anywhere in the statement. That is enough to know
// exactly what the account is worth and what trading it cost, and not nearly
// enough to describe a contract. So this models the ACCOUNT — and the
// CommodityTrade collection stays empty until a statement arrives that actually
// carries entries and exits. A lot size guessed to fill a required field would
// corrupt every number derived from it.
//
// Sign convention here is the CLIENT's, not the broker's. PMEX's general ledger
// is written from the broker's side, where money owed to you is a credit and the
// balance runs negative; every figure below is flipped so that positive means
// "this increased what the account is worth".

export type PmexMovementKind =
  | "OPENING"
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "REALISED_PL"
  | "UNREALISED_PL"
  | "COMMISSION"
  | "FEES"
  | "CGT"
  | "CGT_FEE"
  | "BANK_CHARGES"
  | "PROFIT_DISTRIBUTION";

export type PmexMovement = {
  date: string; // ISO yyyy-mm-dd
  kind: PmexMovementKind;
  amount: number; // signed, client's perspective
  description?: string;
};

export type PmexSessionPl = {
  date: string;
  contract: string;
  realised: number;
  unrealised: number;
};

export type PmexAccountSummary = {
  openingBalance: number;
  closingBalance: number;
  computedClosing: number;
  reconciles: boolean; // computed closing matches the statement's own closing
  discrepancy: number;
  deposits: number;
  withdrawals: number;
  realisedPl: number;
  unrealisedPl: number;
  tradingPl: number; // realised + the marked-to-market unrealised
  commission: number;
  fees: number;
  cgt: number;
  cgtFee: number;
  bankCharges: number;
  profitDistribution: number;
  totalCosts: number; // everything the account paid to trade
  netOfCosts: number; // trading P/L after those costs
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function sumOf(movements: PmexMovement[], kind: PmexMovementKind): number {
  return movements.filter((m) => m.kind === kind).reduce((s, m) => s + m.amount, 0);
}

// Cross-foots the account: opening plus every movement must land on the closing
// balance the statement prints. If it does not, `reconciles` is false and the
// caller must not present any of it as fact — a ledger that does not add up has
// a row missing, and a missing row is exactly the kind of thing that turns into
// a confident wrong number downstream.
export function summarisePmexAccount(
  openingBalance: number,
  movements: PmexMovement[],
  statedClosing: number
): PmexAccountSummary {
  const moved = movements.filter((m) => m.kind !== "OPENING").reduce((s, m) => s + m.amount, 0);
  const computedClosing = r2(openingBalance + moved);
  const discrepancy = r2(computedClosing - statedClosing);

  const deposits = sumOf(movements, "DEPOSIT");
  const withdrawals = sumOf(movements, "WITHDRAWAL");
  const realisedPl = sumOf(movements, "REALISED_PL");
  const unrealisedPl = sumOf(movements, "UNREALISED_PL");
  const commission = -sumOf(movements, "COMMISSION");
  const fees = -sumOf(movements, "FEES");
  const cgt = -sumOf(movements, "CGT");
  const cgtFee = -sumOf(movements, "CGT_FEE");
  const bankCharges = -sumOf(movements, "BANK_CHARGES");
  const profitDistribution = sumOf(movements, "PROFIT_DISTRIBUTION");
  const totalCosts = r2(commission + fees + cgt + cgtFee + bankCharges);
  const tradingPl = r2(realisedPl + unrealisedPl);

  return {
    openingBalance: r2(openingBalance),
    closingBalance: r2(statedClosing),
    computedClosing,
    reconciles: Math.abs(discrepancy) < 0.005,
    discrepancy,
    deposits: r2(deposits),
    withdrawals: r2(-withdrawals),
    realisedPl: r2(realisedPl),
    unrealisedPl: r2(unrealisedPl),
    tradingPl,
    commission: r2(commission),
    fees: r2(fees),
    cgt: r2(cgt),
    cgtFee: r2(cgtFee),
    bankCharges: r2(bankCharges),
    profitDistribution: r2(profitDistribution),
    totalCosts,
    netOfCosts: r2(tradingPl - totalCosts),
  };
}

// Costs as a share of what the trading actually made. On a small account this
// is the number that matters: it is entirely possible to trade profitably and
// still lose money to commission, and saying so plainly is the point.
// Null when nothing was made — a ratio against zero is not a fact.
export function costDragRatio(s: PmexAccountSummary): number | null {
  if (!(Math.abs(s.tradingPl) > 0)) return null;
  return s.totalCosts / Math.abs(s.tradingPl);
}
