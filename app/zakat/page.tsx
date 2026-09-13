import { ZakatTab } from "@/app/portfolio/tabs/ZakatTab";

export const dynamic = "force-dynamic";

// Zakat for whatever the switcher shows: one portfolio, or all of them.
export default function ZakatPage() {
  return <ZakatTab title="Zakat" />;
}
