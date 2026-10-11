// What to do with a share: for any researched share, buy (now or at what
// price), wait, or avoid; for a held one, hold, take profit, or sell. Selling
// is only ever about what is held. Pure, so scripts/test-strategy-picks.ts
// runs it.
//
// The call comes from one number, the return the share can be expected to
// make against the market over the next three months (lib/macro/learn.ts):
// its model rank's, from the network's tested record moved toward what the
// stored calls actually did, plus its P/E against its usual where the data
// says that counts. A call is worth a trade only when that edge clears the
// cost of one, there and back (ROUND_TRIP); the 20-day zones say where to put
// the order.
//   Buy: an edge over the costs. Now when the price is at or under the top of
//   the 20-day buy zone, otherwise at that level.
//   Avoid: an edge under minus the costs. Wait: in between.
//   Thin: outside the 150 most traded, which the model never learned on and
//   which are hard to leave: no call either way.
//   Sell (held): an edge under minus the costs.
//   Take profit (held): an edge under nothing, into the 20-day sell zone.

import { ROUND_TRIP } from "@/lib/macro/learn";

export type PickInput = {
  symbol: string;
  price: number | null;
  edge: number | null; // expected return against the market over 3 months
  thin: boolean;
  zone: { buyLow: number; buyHigh: number; sellLow: number; sellHigh: number } | null;
};

export type BuyVerdict = "buy" | "buy-at" | "wait" | "avoid" | "thin" | "unknown";
export type SellVerdict = "hold" | "take-profit" | "sell" | "thin" | "unknown";

export type BuyPick = { verdict: BuyVerdict; buyAt: number | null };
export type SellPick = { verdict: SellVerdict; sellAt: number | null };

const round = (v: number | null) => (v == null ? null : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

export function buyPick(i: PickInput): BuyPick {
  const out = (verdict: BuyVerdict, at: number | null): BuyPick => ({ verdict, buyAt: round(at) });
  if (i.price == null) return out("unknown", null);
  if (i.thin) return out("thin", null);
  if (i.edge == null) return out("unknown", null);
  if (i.edge <= -ROUND_TRIP) return out("avoid", null);
  if (i.edge < ROUND_TRIP) return out("wait", i.zone?.buyHigh ?? null);
  const at = i.zone?.buyHigh ?? null;
  return at == null || i.price <= at ? out("buy", i.price) : out("buy-at", at);
}

export function sellPick(i: PickInput): SellPick {
  const out = (verdict: SellVerdict, at: number | null): SellPick => ({ verdict, sellAt: round(at) });
  if (i.price == null) return out("unknown", null);
  if (i.thin) return out("thin", null);
  if (i.edge == null) return out("unknown", null);
  if (i.edge <= -ROUND_TRIP) return out("sell", i.price);
  if (i.edge < 0) return out("take-profit", Math.max(i.price, i.zone?.sellLow ?? i.price));
  return out("hold", i.zone?.sellHigh ?? null);
}
