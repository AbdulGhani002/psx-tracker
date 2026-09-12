import "./globals.css";
import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
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

// One family for words, one for figures. Roboto carries every word read,
// Roboto Mono every number, so columns of money line up on the decimal.
const sans = Roboto({ subsets: ["latin"], weight: ["300", "400", "500", "700"], display: "swap", variable: "--font-sans" });
const mono = Roboto_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PSX Portfolio",
  description: "A wealth dashboard for the Pakistan Stock Exchange: portfolios, payouts, tax, risk and the model.",
};

export const viewport = {
  themeColor: "#0a0f1c",
};

// What the shell needs about the signed-in user: nothing when there is none
// (the auth screens), else the market line, the portfolios and the initial.
async function shellData() {
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
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <head>
        <ThemeScript />
      </head>
      <body>
        <NoNumberScroll />
        <PwaRegister />
        {shell.authed && <CommandPalette />}
        {shell.authed && <QuickAdd />}
        <AppShell authed={shell.authed} tickers={shell.tickers} portfolios={shell.portfolios} selected={shell.selected} initial={shell.initial}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
