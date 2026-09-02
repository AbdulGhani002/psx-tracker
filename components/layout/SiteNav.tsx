"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ThemeToggle } from "./ThemeToggle";

// Primary items stay visible; the rest live under "More".
const PRIMARY = [
  { href: "/", label: "Overview" },
  { href: "/plan", label: "Plan" },
  { href: "/holdings", label: "Holdings" },
  { href: "/companies", label: "Companies" },
  { href: "/commodities", label: "PMEX" },
  { href: "/decisions", label: "Decisions" },
  { href: "/wealth", label: "Wealth" },
  { href: "/transactions", label: "Transactions" },
];

const MORE = [
  { href: "/funds", label: "Mutual funds & savings" },
  { href: "/dividends", label: "Dividends" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/rebalance", label: "Rebalance" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/rotation", label: "Sector rotation" },
  { href: "/report", label: "Statement (PDF)" },
  { href: "/changelog", label: "Changelog" },
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
      <div className="max-w-[1180px] mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <Link href="/" className="masthead text-[26px] shrink-0" onClick={() => setMobileOpen(false)}>
          PSX&nbsp;Portfolio
        </Link>

        <nav className="hidden md:flex items-center gap-x-5">
          {PRIMARY.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="label-cap transition-colors hover:text-ink whitespace-nowrap pb-1"
                style={{
                  color: active ? "var(--ink)" : undefined,
                  // An underline, not a dot. The rule is how print marks the
                  // section you are reading.
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                {item.label}
              </Link>
            );
          })}

          {/* More dropdown */}
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              className="label-cap transition-colors hover:text-ink whitespace-nowrap pb-1"
              style={{
                color: moreActive ? "var(--ink)" : undefined,
                borderBottom: moreActive ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              More <span className="inline-block transition-transform" style={{ transform: moreOpen ? "rotate(180deg)" : "none" }}>▾</span>
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

          <button
            onClick={() => window.dispatchEvent(new Event("psx:open-palette"))}
            className="label-cap flex items-center gap-1.5 px-2 py-1 transition-colors hover:text-ink"
            style={{ border: "1px solid var(--rule-strong)" }}
            aria-label="Jump to anything"
            title="Jump to anything (Ctrl/Cmd + K)"
          >
            Jump<span aria-hidden>⌘K</span>
          </button>

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
          <div className="max-w-[1180px] mx-auto px-6 py-2 grid grid-cols-2 gap-x-6">
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
