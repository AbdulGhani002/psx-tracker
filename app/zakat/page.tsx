import { PageHeader } from "@/components/layout/PageHeader";
import { getNetWorth } from "@/lib/data";
import { getCommodityRef } from "@/lib/commodities/refs";
import { pkrPerGram } from "@/lib/calculations/zakat";
import { ZakatClient } from "./ZakatClient";

export const dynamic = "force-dynamic";

export default async function ZakatPage() {
  const [netWorth, gold, silver] = await Promise.all([
    getNetWorth(),
    getCommodityRef("GOLD").catch(() => null),
    getCommodityRef("SILVER").catch(() => null),
  ]);

  const silverPkrPerGram = pkrPerGram(silver?.usd ?? null, silver?.usdpkr ?? null);
  const goldPkrPerGram = pkrPerGram(gold?.usd ?? null, gold?.usdpkr ?? null);

  const categories = [
    {
      key: "cash",
      label: "Brokerage cash",
      amount: netWorth.cash,
      included: true,
      note: "Fully zakatable.",
    },
    {
      key: "savings",
      label: "Bank savings (accrued)",
      amount: netWorth.savings,
      included: true,
      note: "Fully zakatable. Banks auto-deduct on PLS accounts above nisab on 1st Ramadan unless you file a CZ-50 declaration.",
    },
    {
      key: "funds",
      label: "Mutual funds",
      amount: netWorth.funds,
      included: true,
      note: "Zakatable at redemption value. AMCs also deduct at source unless exempted — check your statement so you don't pay twice.",
    },
    {
      key: "equity",
      label: "Listed shares",
      amount: netWorth.equity,
      included: true,
      note: "Held for trading: full market value. Held long-term for dividends: the AAOIFI view allows paying only on the companies' zakatable assets — untick if you follow that view and calculate separately.",
    },
  ];

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Portfolio · Obligations"
        title="Zakat on your financial assets."
        subtitle="2.5% of net zakatable wealth once per lunar year, if it stays above nisab. Asset values are live from your portfolio; nisab uses live silver — the operative threshold for mixed wealth in common Pakistani practice."
      />
      <ZakatClient
        categories={categories}
        silverPkrPerGram={silverPkrPerGram}
        goldPkrPerGram={goldPkrPerGram}
        priceNote={
          silver?.usd != null && silver?.usdpkr != null
            ? `Silver $${silver.usd.toFixed(2)}/oz × Rs ${silver.usdpkr.toFixed(2)}/$ (live)`
            : "Silver price unavailable right now"
        }
      />
    </div>
  );
}
