// A mark for each company.
//
// The PSX data portal does not publish company logos — there is no per-company
// image anywhere on the site, only PSX's own branding — so there is nothing to
// fetch. Rather than pull trademarked artwork off some third party, this sets
// the ticker as a monogram, which is what a paper does for a company whose mark
// it does not hold.
//
// The tint is derived from the SECTOR, so the pharmaceutical names share a
// colour and the banks share another, and a page of positions groups visually
// without a legend. It falls back to the symbol when a sector is not recorded,
// so the mark is always drawn and never blank.

const PALETTE = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)",
  "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)",
];

function hueOf(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const SIZES = { sm: 24, md: 34, lg: 46 } as const;

export function CompanyMark({
  symbol,
  sector,
  size = "md",
  className = "",
}: {
  symbol: string;
  sector?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const px = SIZES[size];
  const sym = (symbol || "?").toUpperCase();
  // Two letters at small sizes, three where there is room — more than that and
  // the monogram stops reading as a mark and starts reading as cramped text.
  const letters = sym.slice(0, px >= 46 ? 3 : 2);
  const tint = hueOf((sector && sector.trim()) || sym);
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center shrink-0 select-none ${className}`}
      style={{
        width: px,
        height: px,
        // A printed tint block: the sector colour laid down light, with the
        // monogram in ink over it so it stays legible in both themes.
        background: `color-mix(in srgb, ${tint} 16%, var(--paper))`,
        border: `1px solid color-mix(in srgb, ${tint} 42%, var(--paper))`,
        color: "var(--ink)",
      }}
      title={sym}
    >
      <span
        className="font-display leading-none"
        style={{ fontSize: Math.round(px * 0.42), letterSpacing: "0.01em" }}
      >
        {letters}
      </span>
    </span>
  );
}
