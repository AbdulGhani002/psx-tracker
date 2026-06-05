"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/holdings", label: "Holdings" },
  { href: "/assets", label: "Assets" },
  { href: "/transactions", label: "Transactions" },
  { href: "/dividends", label: "Dividends" },
  { href: "/commodities", label: "Commodities" },
  { href: "/cash", label: "Cash" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/model", label: "Model" },
  { href: "/rebalance", label: "Rebalance" },
  { href: "/tax", label: "Tax" },
  { href: "/wealth", label: "Wealth" },
  { href: "/log", label: "Log" },
  { href: "/settings", label: "Settings" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <header className="border-b border-ink sticky top-0 z-30" style={{ background: "var(--paper)" }}>
      <div className="max-w-[1000px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="font-display text-[19px] tracking-tight shrink-0" onClick={() => setOpen(false)}>
          PSX Portfolio
        </Link>

        {/* Desktop nav: wraps gracefully, compact spacing */}
        <nav className="hidden md:flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="label-cap transition-colors hover:text-ink whitespace-nowrap"
                style={{ color: active ? "var(--ink)" : undefined }}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden
                    className="ml-1 inline-block w-1 h-1 rounded-full align-middle"
                    style={{ background: "var(--accent)" }}
                  />
                )}
              </Link>
            );
          })}
          <ThemeToggle compact />
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden flex flex-col gap-[5px] p-1"
          aria-label="Menu"
          onClick={() => setOpen(!open)}
        >
          <span className="block w-5 h-[1.5px]" style={{ background: "var(--ink)" }} />
          <span className="block w-5 h-[1.5px]" style={{ background: "var(--ink)" }} />
          <span className="block w-5 h-[1.5px]" style={{ background: "var(--ink)" }} />
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <nav className="md:hidden border-t border-rule" style={{ background: "var(--paper-2)" }}>
          <div className="max-w-[1000px] mx-auto px-6 py-2 grid grid-cols-2 gap-x-6">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="label-cap py-2.5 border-b border-rule"
                  style={{ color: active ? "var(--accent-deep)" : undefined }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}
