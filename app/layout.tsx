import "./globals.css";
import type { Metadata } from "next";
import { SiteNav } from "@/components/layout/SiteNav";

export const metadata: Metadata = {
  title: "PSX Portfolio",
  description: "A long-horizon Pakistani equity portfolio tracker.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          <SiteNav />
          <main className="flex-1 w-full max-w-[1000px] mx-auto px-6 py-10 fade-in">
            {children}
          </main>
          <footer className="border-t border-rule mt-16">
            <div className="max-w-[1000px] mx-auto px-6 py-6 flex justify-between items-center">
              <span className="label-cap">PSX Portfolio</span>
              <span className="label-cap">{new Date().getFullYear()}</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
