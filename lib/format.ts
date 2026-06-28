const PKR = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 0,
});

const PKR_DETAILED = new Intl.NumberFormat("en-PK", {
  style: "currency",
  currency: "PKR",
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 });
const INT = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });

export function fmtRs(v: number | null | undefined, detailed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return (detailed ? PKR_DETAILED : PKR).format(v);
}

export function fmtNum(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return NUM.format(v);
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return INT.format(v);
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtSignedPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const pct = v * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

export function fmtSignedRs(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}${PKR.format(Math.abs(v))}`;
}

export function fmtMultiple(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}×`;
}

const USD_COMPACT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const USD_FULL = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Dollar equivalent of a PKR amount, given a USD/PKR rate. Returns "" when the
// amount or rate is missing so callers can omit the line entirely (never a fake).
export function fmtUsd(rs: number | null | undefined, rate: number | null | undefined, compact = true): string {
  if (rs == null || !Number.isFinite(rs) || rate == null || !Number.isFinite(rate) || rate <= 0) return "";
  return (compact ? USD_COMPACT : USD_FULL).format(rs / rate);
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `Rs ${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `Rs ${(v / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `Rs ${(v / 1e3).toFixed(1)} K`;
  return PKR.format(v);
}

// This is a Pakistan Stock Exchange app, so all timestamps are shown in
// Pakistan Standard Time (Asia/Karachi) regardless of where the server runs.
// The VPS clock is CEST (UTC+2); without pinning the zone, a price fetched at
// 2 PM PKT would display as ~11 AM and look hours stale.
const PK_TZ = "Asia/Karachi";

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: PK_TZ });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PK_TZ,
  });
  return `${s} PKT`;
}
