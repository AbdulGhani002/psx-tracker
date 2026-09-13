import { LOGOS } from "@/lib/logo-list";

// A mark for each company: its logo where scripts/fetch-logos.py found one
// (the company's own site icon, saved under public/logos), else a two-letter
// monogram tinted by sector so a page of positions groups visually.

const PALETTE = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];

function hueOf(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const SIZES = { sm: 28, md: 36, lg: 48 } as const;

export function CompanyMark({ symbol, sector, size = "md", className = "" }: { symbol: string; sector?: string | null; size?: keyof typeof SIZES; className?: string }) {
  const px = SIZES[size];
  const sym = (symbol || "?").toUpperCase();
  const ext = LOGOS[sym];
  if (ext) {
    return (
      <span aria-hidden className={`inline-flex items-center justify-center shrink-0 select-none overflow-hidden rounded-full bg-white ${className}`} style={{ width: px, height: px, border: "1px solid var(--rule)" }} title={sym}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/logos/${sym}.${ext}`} alt="" width={px - 6} height={px - 6} style={{ objectFit: "contain" }} loading="lazy" />
      </span>
    );
  }
  const letters = sym.slice(0, px >= 48 ? 3 : 2);
  const tint = hueOf((sector && sector.trim()) || sym);
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center shrink-0 select-none rounded-full ${className}`}
      style={{ width: px, height: px, background: `color-mix(in srgb, ${tint} 14%, white)`, border: `1px solid color-mix(in srgb, ${tint} 35%, white)`, color: tint }}
      title={sym}
    >
      <span className="font-semibold leading-none" style={{ fontSize: Math.round(px * 0.36), letterSpacing: "0.01em" }}>{letters}</span>
    </span>
  );
}
