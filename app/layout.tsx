import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { SiteNav } from "@/components/layout/SiteNav";
import { ThemeScript } from "@/components/layout/ThemeToggle";
import { NoNumberScroll } from "@/components/ui/NoNumberScroll";
import { APP_VERSION } from "@/lib/version";

// Self-hosted, preloaded fonts — no external render-blocking round-trips.
// Fraunces stays a variable font with the optical-size axis so the editorial
// `font-variation-settings: 'opsz' 144` keeps working.
const display = Fraunces({ subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"], display: "swap", variable: "--font-display" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600"], display: "swap", variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "PSX Portfolio",
  description: "A long-horizon Pakistani equity portfolio tracker.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        <ThemeScript />
      </head>
      <body>
        <NoNumberScroll />
        <div className="min-h-screen flex flex-col">
          <SiteNav />
          <main className="flex-1 w-full max-w-[1000px] mx-auto px-6 py-10 fade-in">
            {children}
          </main>
          <footer className="border-t border-rule mt-16">
            <div className="max-w-[1000px] mx-auto px-6 py-6 flex justify-between items-center">
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
