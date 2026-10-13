import { notFound } from "next/navigation";
import { getValuationCompany } from "@/lib/valuation/board";
import { CompanyView } from "./CompanyView";

export const dynamic = "force-dynamic";

// One share's valuation (lib/valuation/board.ts, CompanyView.tsx).
export default async function ValuationCompanyPage(props: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await props.params;
  if (!/^[A-Za-z0-9.&-]{1,12}$/.test(symbol)) notFound();
  return <CompanyView c={await getValuationCompany(symbol)} />;
}
