"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ThemeToggle } from "./ThemeToggle";

// Primary items stay visible; the rest live under "More".
const PRIMARY = [
  { href: "/", label: "Overview" },
  { href: "/holdings", label: "Holdings" },
  { href: "/ratings", label: "AI Ratings" },
  { href: "/screener", label: "Screener" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/news", label: "News" },
  { href: "/chat", label: "Chat" },
  { href: "/transactions", label: "Transactions" },
];

const MORE = [
  { href: "/compare", label: "Compare stocks" },
  { href: "/rotation", label: "Sector rotation" },
  { href: "/flows", label: "Foreign flows (FIPI)" },
  { href: "/patterns", label: "Pattern scanner" },
  { href: "/backtest", label: "Strategy backtest" },
  { href: "/optimize", label: "Portfolio optimiser" },
  { href: "/dividend-calendar", label: "Dividend calendar" },
  { href: "/earnings-calendar", label: "Earnings calendar" },
  { href: "/report", label: "Statement (PDF)" },
  { href: "/cgt-simulator", label: "CGT simulator" },
  { href: "/assets", label: "Assets" },
  { href: "/rebalance", label: "Rebalance" },
  { href: "/tax", label: "Tax" },
  { href: "/dividends", label: "Dividends" },
  { href: "/forecast", label: "Dividend forecast" },
  { href: "/valuation", label: "Valuation" },
  { href: "/intrinsic", label: "Intrinsic & buy zones" },
  { href: "/methodology", label: "How it's valued" },
  { href: "/shariah", label: "Shariah" },
  { href: "/risk", label: "Risk" },
  { href: "/income", label: "Income planner" },
  { href: "/cash", label: "Cash" },
  { href: "/commodities", label: "Commodities" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/model", label: "Model" },
  { href: "/wealth", label: "Wealth" },
  { href: "/log", label: "Decision log" },
  { href: "/glossary", label: "Glossary (Urdu)" },
  { href: "/settings", label: "Settings" },
];

const ALL = [...PRIMARY, ...MORE];

export function SiteNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };
  const moreActive = MORE.some((m) => isActive(m.href));

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }

  // Auth screens are chrome-free — no navbar.
  if (pathname === "/login" || pathname === "/reset-password" || pathname === "/verify") return null;

  return (
    <header className="border-b border-ink sticky top-0 z-30" style={{ background: "var(--paper)" }}>
      <div className="max-w-[1000px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="font-display text-[19px] tracking-tight shrink-0" onClick={() => setMobileOpen(false)}>
          PSX Portfolio
        </Link>

        <nav className="hidden md:flex items-center gap-x-5">
          {PRIMARY.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="label-cap transition-colors hover:text-ink whitespace-nowrap"
                style={{ color: active ? "var(--ink)" : undefined }}
              >
                {item.label}
                {active && <span aria-hidden className="ml-1 inline-block w-1 h-1 rounded-full align-middle" style={{ background: "var(--accent)" }} />}
              </Link>
            );
          })}

          {/* More dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className="label-cap transition-colors hover:text-ink whitespace-nowrap"
              style={{ color: moreActive ? "var(--ink)" : undefined }}
            >
              More <span className="inline-block" style={{ transform: moreOpen ? "rotate(180deg)" : "none" }}>▾</span>
              {moreActive && <span aria-hidden className="ml-1 inline-block w-1 h-1 rounded-full align-middle" style={{ background: "var(--accent)" }} />}
            </button>
            {moreOpen && (
              <div
                className="absolute right-0 top-full mt-3 border border-ink min-w-[180px] py-1 z-40"
                style={{ background: "var(--paper)" }}
              >
                {MORE.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className="block px-4 py-2 label-cap hover:bg-[var(--paper-2)]"
                      style={{ color: active ? "var(--accent-deep)" : undefined }}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                <button
                  onClick={signOut}
                  className="block w-full text-left px-4 py-2 label-cap hover:bg-[var(--paper-2)] border-t border-rule mt-1"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>

          <ThemeToggle compact />
        </nav>

        {/* Mobile hamburger */}
        <button className="md:hidden flex flex-col gap-[5px] p-1" aria-label="Menu" onClick={() => setMobileOpen(!mobileOpen)}>
          <span className="block w-5 h-[1.5px]" style={{ background: "var(--ink)" }} />
          <span className="block w-5 h-[1.5px]" style={{ background: "var(--ink)" }} />
          <span className="block w-5 h-[1.5px]" style={{ background: "var(--ink)" }} />
        </button>
      </div>

      {mobileOpen && (
        <nav className="md:hidden border-t border-rule" style={{ background: "var(--paper-2)" }}>
          <div className="max-w-[1000px] mx-auto px-6 py-2 grid grid-cols-2 gap-x-6">
            {ALL.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className="label-cap py-2.5 border-b border-rule"
                  style={{ color: active ? "var(--accent-deep)" : undefined }}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="py-2.5 col-span-2"><ThemeToggle /></div>
            <button
              onClick={() => {
                setMobileOpen(false);
                signOut();
              }}
              className="label-cap py-2.5 border-b border-rule text-left col-span-2"
            >
              Sign out
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
