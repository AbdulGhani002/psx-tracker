import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Instrument_Serif, Roboto, Roboto_Mono } from "next/font/google";
import { SiteNav } from "@/components/layout/SiteNav";
import { ThemeScript } from "@/components/layout/ThemeToggle";
import { NoNumberScroll } from "@/components/ui/NoNumberScroll";
import { PwaRegister } from "@/components/layout/PwaRegister";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { QuickAdd } from "@/components/layout/QuickAdd";
import { APP_VERSION } from "@/lib/version";

// Self-hosted, preloaded fonts — no external render-blocking round-trips.
//
// Two faces, two jobs. Instrument Serif is a masthead: high-contrast, drawn for
// size, and used only for the logo and headlines — it is never asked to be
// legible at 11px, which is exactly where display serifs fall apart. Roboto
// carries every word actually read, and Roboto Mono every figure, so columns of
// money line up on the decimal.
const display = Instrument_Serif({ subsets: ["latin"], weight: ["400"], style: ["normal", "italic"], display: "swap", variable: "--font-display" });
const sans = Roboto({ subsets: ["latin"], weight: ["300", "400", "500", "700"], display: "swap", variable: "--font-sans" });
const mono = Roboto_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PSX Portfolio",
  description: "A long-horizon Pakistani equity portfolio tracker.",
};

export const viewport = {
  themeColor: "#16150f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        <ThemeScript />
      </head>
      <body>
        <NoNumberScroll />
        <PwaRegister />
        <CommandPalette />
        <QuickAdd />
        <div className="min-h-screen flex flex-col">
          <SiteNav />
          <main className="flex-1 w-full max-w-[1180px] mx-auto px-6 py-10 fade-in">
            {children}
          </main>
          <footer className="border-t border-rule mt-16">
            <div className="max-w-[1180px] mx-auto px-6 py-6 flex justify-between items-center">
              <span className="label-cap">PSX Portfolio</span>
              <Link href="/changelog" className="label-cap hover:text-[var(--accent-deep)] transition-colors">
                v{APP_VERSION}
              </Link>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
