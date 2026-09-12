"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons";
import type { IndexTicker } from "@/lib/timeseries/eod-cache";

// The shell: a sidebar of grouped links on wide screens, a top bar with the
// market, the portfolio switcher, the theme and the account, and a bottom
// tab bar on phones. Every page renders inside it; the auth screens do not.

export type ShellPortfolio = { _id: string; name: string; color: string; isDefault: boolean };

type NavItem = { href: string; label: string; icon: IconName; title: string; subtitle: string };

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Portfolio",
    items: [
      { href: "/", label: "Overview", icon: "home", title: "Overview", subtitle: "Consolidated view across your portfolios" },
      { href: "/analytics", label: "Analytics", icon: "chart", title: "Analytics", subtitle: "Returns against the market, month by month" },
      { href: "/holdings", label: "Holdings", icon: "layers", title: "Holdings", subtitle: "Every position, priced today" },
      { href: "/transactions", label: "Trades", icon: "list", title: "Trades", subtitle: "Everything that moved" },
      { href: "/dividends", label: "Payouts", icon: "coins", title: "Payouts", subtitle: "Dividends, bonuses, tax and zakat" },
      { href: "/funds", label: "Cash & funds", icon: "wallet", title: "Cash & funds", subtitle: "Money-market funds, savings and the brokerage balance" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/analysis", label: "Model", icon: "brain", title: "Model", subtitle: "The list: zones, ranks and the KSE-100 read" },
      { href: "/risk", label: "Risk", icon: "shield", title: "Risk", subtitle: "Volatility, drawdowns, value at risk and stress tests" },
      { href: "/plan", label: "Plan", icon: "compass", title: "Plan", subtitle: "Regime, cash and the ladder" },
      { href: "/rebalance", label: "Rebalance", icon: "target", title: "Rebalance", subtitle: "Targets and what to buy next" },
      { href: "/watchlist", label: "Watchlist", icon: "eye", title: "Watchlist", subtitle: "Your bands and alerts" },
      { href: "/rotation", label: "Sectors", icon: "trend", title: "Sector rotation", subtitle: "Where the money is moving" },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/tax", label: "Tax & Zakat", icon: "receipt", title: "Tax & Zakat", subtitle: "Capital gains, withholding and zakat, by tax year" },
      { href: "/calculators", label: "Calculators", icon: "calculator", title: "Calculators", subtitle: "ROI, CAGR, SIP, deductions and more" },
      { href: "/decisions", label: "Decisions", icon: "book", title: "Decisions", subtitle: "The log of why" },
      { href: "/wealth", label: "Wealth", icon: "gem", title: "Wealth", subtitle: "Net worth and the long view" },
      { href: "/report", label: "Statement", icon: "file", title: "Statement", subtitle: "The weekly and monthly PDFs" },
      { href: "/settings", label: "Settings", icon: "gear", title: "Settings", subtitle: "Accounts, portfolios, alerts and tax status" },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items);
const TABS: NavItem[] = [ALL_ITEMS[0], ALL_ITEMS[1], ALL_ITEMS[2], ALL_ITEMS[6], ALL_ITEMS[4]];

const fmtLevel = (v: number) => Math.round(v).toLocaleString("en-US");

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const cur = document.documentElement.getAttribute("data-theme");
    setTheme(cur === "light" ? "light" : "dark");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* ignore */
    }
  };
  return { theme, toggle };
}

function PortfolioSwitcher({ portfolios, selected }: { portfolios: ShellPortfolio[]; selected: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  const current = selected === "all" ? null : portfolios.find((p) => p._id === selected) ?? null;
  async function choose(id: string) {
    setBusy(true);
    try {
      await fetch("/api/portfolios/select", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className="btn-ghost flex items-center gap-2" disabled={busy} title="Which portfolio the pages show">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: current ? current.color : "linear-gradient(135deg, var(--accent), var(--blue))" }} />
        <span className="max-w-[140px] truncate">{current ? current.name : "All portfolios"}</span>
        <Icon.chevron className="w-3.5 h-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 card py-1 min-w-[220px] z-50">
          <button type="button" onClick={() => choose("all")} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--surface-2)] flex items-center gap-2" style={{ color: !current ? "var(--accent)" : undefined }}>
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "linear-gradient(135deg, var(--accent), var(--blue))" }} /> All portfolios
          </button>
          {portfolios.map((p) => (
            <button key={p._id} type="button" onClick={() => choose(p._id)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--surface-2)] flex items-center gap-2" style={{ color: current?._id === p._id ? "var(--accent)" : undefined }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} /> {p.name}
              {p.isDefault && <span className="text-[10px] text-muted ml-auto">default</span>}
            </button>
          ))}
          <div className="border-t border-[var(--rule)] mt-1 pt-1">
            <Link href="/settings#portfolios" onClick={() => setOpen(false)} className="block px-3 py-2 text-[12px] text-muted hover:text-ink">
              Manage portfolios
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children, authed, tickers, portfolios, selected, initial }: { children: React.ReactNode; authed: boolean; tickers: IndexTicker[]; portfolios: ShellPortfolio[]; selected: string; initial: string }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const bare = !authed || pathname === "/login" || pathname === "/reset-password" || pathname === "/verify";
  if (bare) return <>{children}</>;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const here = ALL_ITEMS.find((i) => isActive(i.href)) ?? (pathname.startsWith("/stock") ? { title: "Company", subtitle: "One name, in full" } : pathname.startsWith("/changelog") ? { title: "Changelog", subtitle: "What changed, release by release" } : { title: "PSX Portfolio", subtitle: "" });

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }

  const sidebar = (
    <aside className="sidebar hidden lg:flex">
      <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[15px] font-bold" style={{ background: "var(--accent)", color: "#06210f" }}>P</span>
        <div>
          <div className="text-[15px] font-semibold leading-tight">PSX Portfolio</div>
          <div className="text-[10px] text-muted tracking-wide">WEALTH DASHBOARD</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {GROUPS.map((g) => (
          <div key={g.label} className="mt-3">
            <div className="px-3 pb-1.5 text-[10px] tracking-[0.14em] uppercase text-muted">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((it) => {
                const I = Icon[it.icon];
                return (
                  <Link key={it.href} href={it.href} className="sidebar-link" data-active={isActive(it.href)}>
                    <I /> <span>{it.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-[var(--rule)] flex items-center justify-between">
        <button type="button" onClick={toggle} className="flex items-center gap-2 text-[12px] text-muted hover:text-ink" title="Theme">
          {theme === "dark" ? <Icon.sun className="w-4 h-4" /> : <Icon.moon className="w-4 h-4" />} {theme === "dark" ? "Light" : "Dark"}
        </button>
        <button type="button" onClick={signOut} className="flex items-center gap-2 text-[12px] text-muted hover:text-ink" title="Sign out">
          <Icon.logout className="w-4 h-4" /> Sign out
        </button>
      </div>
    </aside>
  );

  const ticker = tickers[0];

  return (
    <div className="min-h-screen">
      {sidebar}
      <div className="lg:pl-[232px] min-h-screen flex flex-col">
        <header className="topbar">
          <div className="px-4 md:px-8 h-[60px] flex items-center gap-3">
            <button type="button" className="lg:hidden btn-ghost !px-2" onClick={() => setMenuOpen(true)} aria-label="Menu">
              <Icon.menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold leading-tight truncate">{here.title}</div>
              {here.subtitle && <div className="text-[11.5px] text-muted truncate hidden sm:block">{here.subtitle}</div>}
            </div>
            {ticker && (
              <div className="hidden md:flex items-center gap-2 text-[12.5px]">
                <span className="text-muted">{ticker.label}</span>
                <span className="font-mono mono-num font-medium">{fmtLevel(ticker.level)}</span>
                <span className="pill" data-tone={ticker.change >= 0 ? "positive" : "negative"}>
                  {ticker.change >= 0 ? "▲" : "▼"} {Math.abs(ticker.change).toFixed(0)} ({ticker.changePct >= 0 ? "+" : ""}{ticker.changePct.toFixed(2)}%)
                </span>
                {tickers[1] && (
                  <span className="text-muted hidden xl:inline">
                    · {tickers[1].label} <span className="font-mono mono-num text-ink">{fmtLevel(tickers[1].level)}</span>{" "}
                    <span style={{ color: tickers[1].change >= 0 ? "var(--positive)" : "var(--negative)" }}>{tickers[1].changePct >= 0 ? "+" : ""}{tickers[1].changePct.toFixed(2)}%</span>
                  </span>
                )}
              </div>
            )}
            <PortfolioSwitcher portfolios={portfolios} selected={selected} />
            <Link href="/transactions/new" className="btn-primary hidden sm:inline-flex items-center gap-1.5">
              <Icon.plus className="w-4 h-4" /> Add trade
            </Link>
            <span className="avatar" title="Account">{initial}</span>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 md:px-8 py-6 pb-24 lg:pb-10 fade-in">{children}</main>
      </div>

      {/* Phones: a bottom tab bar and a full menu sheet. */}
      <nav className="tabbar lg:hidden">
        {TABS.map((it) => {
          const I = Icon[it.icon];
          return (
            <Link key={it.href} href={it.href} data-active={isActive(it.href)}>
              <I /> {it.label}
            </Link>
          );
        })}
      </nav>
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setMenuOpen(false)} style={{ background: "rgba(0,0,0,.5)" }}>
          <div className="absolute left-0 top-0 bottom-0 w-[280px] overflow-y-auto p-4" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[15px] font-semibold">PSX Portfolio</span>
              <button type="button" className="text-muted text-[13px]" onClick={() => setMenuOpen(false)}>
                Close
              </button>
            </div>
            {GROUPS.map((g) => (
              <div key={g.label} className="mt-3">
                <div className="px-3 pb-1.5 text-[10px] tracking-[0.14em] uppercase text-muted">{g.label}</div>
                {g.items.map((it) => {
                  const I = Icon[it.icon];
                  return (
                    <Link key={it.href} href={it.href} className="sidebar-link" data-active={isActive(it.href)} onClick={() => setMenuOpen(false)}>
                      <I /> <span>{it.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
            <div className="mt-4 flex items-center justify-between px-3">
              <button type="button" onClick={toggle} className="text-[12px] text-muted">{theme === "dark" ? "Light theme" : "Dark theme"}</button>
              <button type="button" onClick={signOut} className="text-[12px] text-muted">Sign out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
