"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icons";
import { Wordmark, LogoMark } from "./Logo";
import type { IndexTicker } from "@/lib/timeseries/eod-cache";

// The shell, drawn the way Zar draws it: a white sidebar with the menu and
// the list of portfolios, a white top bar with the page title, the KSE-100,
// the portfolio chip and the one dark button, and the page on a grey ground.
// Phones get a bottom tab bar and a menu sheet. The auth screens render bare.

export type ShellPortfolio = { _id: string; name: string; color: string; isDefault: boolean };

type NavItem = { href: string; label: string; icon: IconName; title: string; subtitle: string };

const MENU: NavItem[] = [
  { href: "/", label: "Overview", icon: "grid", title: "Overview", subtitle: "Consolidated view across all portfolios" },
  { href: "/portfolio", label: "Portfolios", icon: "briefcase", title: "Portfolio", subtitle: "Holdings, trades, payouts, cash and tax" },
  { href: "/watchlist", label: "Watchlists", icon: "eye", title: "Watchlists", subtitle: "Names you follow and the levels you set" },
  { href: "/rebalance", label: "Rebalance", icon: "target", title: "Rebalance", subtitle: "Target allocation and the trades that reach it" },
  { href: "/analysis", label: "Model", icon: "brain", title: "Model", subtitle: "Buy and sell zones from the learned model" },
];
const SETTINGS: NavItem = { href: "/settings", label: "Settings", icon: "gear", title: "Settings", subtitle: "Portfolios, tax status, alerts and backup" };
const ALL_ITEMS = [...MENU, SETTINGS];

const fmtLevel = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "P";
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar") === "rail");
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem("sidebar", next ? "rail" : "full");
    } catch {
      /* ignore */
    }
  };
  return { collapsed, toggle };
}

function PortfolioChip({ portfolios, selected }: { portfolios: ShellPortfolio[]; selected: string }) {
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
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg border border-[var(--rule)] pl-1.5 pr-2.5 py-1 hover:bg-[var(--surface-2)]" disabled={busy} title="Which portfolio the pages show">
        <span className="initials !w-7 !h-7 text-[10px]" style={{ background: current ? `color-mix(in srgb, ${current.color} 18%, white)` : "var(--surface-2)", color: current ? current.color : "var(--ink)" }}>
          {current ? initialsOf(current.name) : "ALL"}
        </span>
        <span className="text-left leading-tight hidden sm:block">
          <span className="block text-[9px] uppercase tracking-[0.06em] text-muted">Portfolio</span>
          <span className="block text-[12.5px] font-semibold max-w-[150px] truncate">{current ? current.name : "All portfolios"}</span>
        </span>
        <Icon.chevron className="w-3.5 h-3.5 text-muted" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 card py-1 min-w-[230px] z-50">
          <button type="button" onClick={() => choose("all")} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--surface-2)] flex items-center gap-2" style={{ fontWeight: !current ? 600 : 400 }}>
            <span className="initials !w-6 !h-6 text-[9px]" style={{ background: "var(--surface-2)" }}>ALL</span> All portfolios
          </button>
          {portfolios.map((p) => (
            <button key={p._id} type="button" onClick={() => choose(p._id)} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--surface-2)] flex items-center gap-2" style={{ fontWeight: current?._id === p._id ? 600 : 400 }}>
              <span className="initials !w-6 !h-6 text-[9px]" style={{ background: `color-mix(in srgb, ${p.color} 18%, white)`, color: p.color }}>{initialsOf(p.name)}</span>
              <span className="truncate">{p.name}</span>
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
  const params = useSearchParams();
  const { collapsed, toggle } = useCollapsed();
  const [menuOpen, setMenuOpen] = useState(false);
  const [portfoliosOpen, setPortfoliosOpen] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const bare = !authed || pathname === "/login" || pathname === "/reset-password" || pathname === "/verify";
  if (bare) return <>{children}</>;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  const onPortfolio = pathname === "/portfolio" || pathname.startsWith("/holdings") || pathname.startsWith("/transactions");
  const current = selected === "all" ? null : portfolios.find((p) => p._id === selected) ?? null;
  const here =
    onPortfolio
      ? { title: current ? current.name : "All portfolios", subtitle: current ? `${current.name} in full: holdings, trades, payouts, cash and tax` : "Every portfolio together" }
      : ALL_ITEMS.find((i) => isActive(i.href)) ?? (pathname.startsWith("/stock") ? { title: "Company", subtitle: "One name, in full" } : pathname.startsWith("/changelog") ? { title: "Changelog", subtitle: "What changed, release by release" } : pathname === "/portfolios" ? { title: "All portfolios", subtitle: "Each book on its own card" } : { title: "PSX Portfolio", subtitle: "" });

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }

  const ticker = tickers[0];
  const tab = params.get("tab");

  const Row = ({ it, onClick }: { it: NavItem; onClick?: () => void }) => {
    const I = Icon[it.icon];
    const active = it.href === "/portfolio" ? onPortfolio : isActive(it.href);
    return (
      <Link href={it.href} className="sidebar-link" data-active={active} onClick={onClick} title={collapsed ? it.label : undefined}>
        <I /> {!collapsed && <span className="flex-1">{it.label}</span>}
        {it.href === "/portfolio" && !collapsed && (
          <button
            type="button"
            aria-label="Toggle portfolios"
            className="p-0.5 rounded hover:bg-[var(--surface-3)]"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPortfoliosOpen((v) => !v);
            }}
          >
            <Icon.chevron className="!w-3.5 !h-3.5 transition-transform" style={{ transform: portfoliosOpen ? "rotate(180deg)" : "none" } as any} />
          </button>
        )}
      </Link>
    );
  };

  const PortfolioList = ({ onClick }: { onClick?: () => void }) => (
    <div className="mt-0.5 space-y-0.5">
      <Link href="/portfolios" className="sidebar-sub" data-active={pathname === "/portfolios"} onClick={onClick}>
        All portfolios
      </Link>
      {portfolios.map((p) => (
        <a key={p._id} href={`/api/portfolios/select?id=${p._id}&next=/portfolio`} className="sidebar-sub" data-active={onPortfolio && selected === p._id} onClick={onClick} title={p.name}>
          {p.name}
        </a>
      ))}
    </div>
  );

  const width = collapsed ? 64 : 232;

  const sidebar = (
    <aside className="sidebar hidden lg:flex flex-col" style={{ width }}>
      <div className={`${collapsed ? "px-3 justify-center" : "px-4"} h-[60px] flex items-center border-b border-[var(--rule)]`}>
        <Link href="/" aria-label="Overview">
          {collapsed ? <LogoMark size={30} /> : <Wordmark />}
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {!collapsed && <div className="sidebar-label">Menu</div>}
        {collapsed && <div className="h-3" />}
        <div className="space-y-0.5">
          {MENU.slice(0, 2).map((it) => (
            <Row key={it.href} it={it} />
          ))}
          {!collapsed && portfoliosOpen && <PortfolioList />}
          {MENU.slice(2).map((it) => (
            <Row key={it.href} it={it} />
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-[var(--rule)]">
          <Row it={SETTINGS} />
        </div>
      </nav>
      <div className={`px-3 py-3 border-t border-[var(--rule)] flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
        <button type="button" onClick={toggle} className="sidebar-link !py-1.5" title={collapsed ? "Expand" : "Collapse"}>
          <Icon.sidebar /> {!collapsed && <span className="text-[12px] text-muted">Collapse</span>}
        </button>
        {!collapsed && (
          <button type="button" onClick={signOut} className="text-[12px] text-muted hover:text-ink flex items-center gap-1.5 px-2" title="Sign out">
            <Icon.logout className="w-4 h-4" /> Sign out
          </button>
        )}
      </div>
    </aside>
  );

  const TABS: Array<{ href: string; label: string; icon: IconName; active: boolean }> = [
    { href: "/", label: "Overview", icon: "grid", active: pathname === "/" },
    { href: "/portfolio", label: "Portfolio", icon: "briefcase", active: pathname === "/portfolio" && (!tab || tab === "holding") },
    { href: "/portfolio?tab=trades", label: "Trades", icon: "list", active: pathname === "/portfolio" && tab === "trades" },
    { href: "/portfolio?tab=payouts", label: "Payouts", icon: "coins", active: pathname === "/portfolio" && tab === "payouts" },
    { href: "/analysis", label: "Model", icon: "brain", active: isActive("/analysis") },
  ];

  return (
    <div className="min-h-screen">
      {sidebar}
      <style>{`@media (min-width:1024px){.shell-offset{padding-left:${width}px}}`}</style>
      <div className="shell-offset min-h-screen flex flex-col">
        <header className="topbar">
          <div className="px-4 md:px-6 h-[60px] flex items-center gap-3">
            <button type="button" className="lg:hidden btn-ghost !px-2" onClick={() => setMenuOpen(true)} aria-label="Menu">
              <Icon.menu className="w-5 h-5" />
            </button>
            <button type="button" className="hidden lg:inline-flex text-muted hover:text-ink p-1 rounded" onClick={toggle} aria-label="Toggle sidebar">
              <Icon.sidebar className="w-[18px] h-[18px]" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold leading-tight truncate">{here.title}</div>
              {here.subtitle && <div className="text-[11px] text-muted truncate hidden sm:block">{here.subtitle}</div>}
            </div>
            {ticker && (
              <div className="hidden md:flex items-center gap-1.5 text-[12.5px] whitespace-nowrap">
                <span className="font-semibold">{ticker.label.replace("-", "")}</span>
                <span className="mono-num font-semibold">{fmtLevel(ticker.level)}</span>
                <span className="mono-num font-medium flex items-center gap-0.5" style={{ color: ticker.change >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {ticker.change >= 0 ? <Icon.arrowUpRight className="w-3.5 h-3.5" /> : <Icon.arrowDownRight className="w-3.5 h-3.5" />}
                  {ticker.change >= 0 ? "+" : "-"}{Math.abs(ticker.change).toFixed(2)} ({ticker.changePct >= 0 ? "+" : ""}{ticker.changePct.toFixed(2)}%)
                </span>
                {tickers[1] && (
                  <span className="text-muted hidden xl:inline">
                    · {tickers[1].label.replace("-", "")} <span className="mono-num text-ink">{fmtLevel(tickers[1].level)}</span>{" "}
                    <span style={{ color: tickers[1].change >= 0 ? "var(--positive)" : "var(--negative)" }}>{tickers[1].changePct >= 0 ? "+" : ""}{tickers[1].changePct.toFixed(2)}%</span>
                  </span>
                )}
              </div>
            )}
            <PortfolioChip portfolios={portfolios} selected={selected} />
            <Link href="/transactions/new" className="btn-primary hidden sm:inline-flex">
              <Icon.plus className="w-4 h-4" /> Add trade
            </Link>
            <div className="relative">
              <button type="button" className="avatar" title="Account" onClick={() => setAccountOpen((v) => !v)}>{initial}</button>
              {accountOpen && (
                <div className="absolute right-0 top-full mt-2 card py-1 min-w-[160px] z-50" onMouseLeave={() => setAccountOpen(false)}>
                  <Link href="/settings" className="block px-3 py-2 text-[13px] hover:bg-[var(--surface-2)]" onClick={() => setAccountOpen(false)}>Settings</Link>
                  <button type="button" onClick={signOut} className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--surface-2)]">Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 md:px-6 py-5 pb-24 lg:pb-8 fade-in">{children}</main>
      </div>

      <nav className="tabbar lg:hidden">
        {TABS.map((t) => {
          const I = Icon[t.icon];
          return (
            <Link key={t.href} href={t.href} data-active={t.active}>
              <I /> {t.label}
            </Link>
          );
        })}
      </nav>
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setMenuOpen(false)} style={{ background: "rgba(15,23,42,.4)" }}>
          <div className="absolute left-0 top-0 bottom-0 w-[280px] overflow-y-auto p-4" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <Wordmark />
              <button type="button" className="text-muted text-[13px]" onClick={() => setMenuOpen(false)}>
                Close
              </button>
            </div>
            <div className="sidebar-label">Menu</div>
            <div className="space-y-0.5">
              {MENU.slice(0, 2).map((it) => (
                <Row key={it.href} it={it} onClick={() => setMenuOpen(false)} />
              ))}
              <PortfolioList onClick={() => setMenuOpen(false)} />
              {MENU.slice(2).map((it) => (
                <Row key={it.href} it={it} onClick={() => setMenuOpen(false)} />
              ))}
              <Row it={SETTINGS} onClick={() => setMenuOpen(false)} />
            </div>
            <div className="mt-4 px-3">
              <button type="button" onClick={signOut} className="text-[12px] text-muted">Sign out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
