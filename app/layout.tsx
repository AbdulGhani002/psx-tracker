import "./globals.css";
import { Suspense } from "react";
import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeScript } from "@/components/layout/ThemeToggle";
import { NoNumberScroll } from "@/components/ui/NoNumberScroll";
import { PwaRegister } from "@/components/layout/PwaRegister";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { QuickAdd } from "@/components/layout/QuickAdd";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { listPortfolios, selectedPortfolio } from "@/lib/portfolios";
import { indexTickers } from "@/lib/timeseries/eod-cache";
import { UserModel } from "@/lib/models/User";
import { connectDb } from "@/lib/db";

// One family for words and figures alike, with tabular numerals.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "PSX Portfolio",
  description: "A wealth dashboard for the Pakistan Stock Exchange: portfolios, payouts, tax, risk and the model.",
};

export const viewport = {
  themeColor: "#ffffff",
};

// What the shell needs about the signed-in user: nothing when there is none
// (the auth screens), else the market line, the portfolios and the initial.
async function shellData() {
  // A design preview on a machine with no database: the shell with sample
  // market lines and portfolios. Never in production.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_PREVIEW === "1" && !process.env.DEV_PREVIEW_USER) {
    return {
      authed: true as const,
      tickers: [
        { symbol: "KSE100", label: "KSE-100", level: 170511.85, change: 1646.81, changePct: 0.975, date: "2026-09-11" },
        { symbol: "KMI30", label: "KMI-30", level: 243201.4, change: 3807.2, changePct: 1.59, date: "2026-09-11" },
      ],
      portfolios: [
        { _id: "p1", name: "Main", color: "#3ddc97", isDefault: true },
        { _id: "p2", name: "Trading book", color: "#7c9cff", isDefault: false },
      ],
      selected: "all",
      initial: "A",
    };
  }
  const uid = await getCurrentUserId();
  if (!uid) return { authed: false as const, tickers: [], portfolios: [], selected: "all", initial: "" };
  const [tickers, portfolios, selected, user] = await Promise.all([
    indexTickers().catch(() => []),
    listPortfolios().catch(() => []),
    selectedPortfolio().catch(() => null),
    connectDb()
      .then(() => UserModel.findById(uid).select("email name").lean())
      .catch(() => null),
  ]);
  const label = String((user as any)?.name || (user as any)?.email || "U");
  return { authed: true as const, tickers, portfolios: portfolios.map((p) => ({ _id: p._id, name: p.name, color: p.color, isDefault: p.isDefault })), selected: selected?._id ?? "all", initial: label.slice(0, 1).toUpperCase() };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const shell = await shellData();
  return (
    <html lang="en" className={sans.variable} data-theme="light">
      <head>
        <ThemeScript />
      </head>
      <body>
        <NoNumberScroll />
        <PwaRegister />
        {shell.authed && <CommandPalette />}
        {shell.authed && <QuickAdd />}
        <Suspense fallback={null}>
          <AppShell authed={shell.authed} tickers={shell.tickers} portfolios={shell.portfolios} selected={shell.selected} initial={shell.initial}>
            {children}
          </AppShell>
        </Suspense>
      </body>
    </html>
  );
}
