"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ThemeToggle } from "./ThemeToggle";

// Primary items stay visible; the rest live under "More".
const PRIMARY = [
  { href: "/", label: "Overview" },
  { href: "/holdings", label: "Holdings" },
  { href: "/assets", label: "Assets" },
  { href: "/transactions", label: "Transactions" },
  { href: "/rebalance", label: "Rebalance" },
  { href: "/tax", label: "Tax" },
];

const MORE = [
  { href: "/dividends", label: "Dividends" },
  { href: "/cash", label: "Cash" },
  { href: "/commodities", label: "Commodities" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/model", label: "Model" },
  { href: "/wealth", label: "Wealth" },
  { href: "/log", label: "Decision log" },
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
          </div>
        </nav>
      )}
    </header>
  );
}
