import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/layout/SiteNav";
import { ThemeScript } from "@/components/layout/ThemeToggle";
import { NoNumberScroll } from "@/components/ui/NoNumberScroll";
import { APP_VERSION } from "@/lib/version";

export const metadata: Metadata = {
  title: "PSX Portfolio",
  description: "A long-horizon Pakistani equity portfolio tracker.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
