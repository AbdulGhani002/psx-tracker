// The mark: a green P whose bowl opens into a rising line with a point at the
// top of the climb. Drawn once here and used by the sidebar, the auth screens
// and the app icons (which put it on a green tile).

export function LogoMark({ size = 32, tile = false, className = "" }: { size?: number; tile?: boolean; className?: string }) {
  const stroke = tile ? "#ffffff" : "var(--brand)";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      {tile && <rect x="2" y="2" width="60" height="60" rx="14" fill="#2eaa4f" />}
      <path d="M17 50 V14 h14 a10 10 0 0 1 0 20 H17" fill="none" stroke={stroke} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 50 L36 38 L42 43 L54 28" fill="none" stroke={tile ? "#dcfce7" : "var(--navy)"} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="54" cy="28" r="4" fill={tile ? "#dcfce7" : "var(--navy)"} />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={compact ? 28 : 34} />
      {!compact && (
        <span className="leading-none">
          <span className="block text-[17px] font-bold tracking-[-0.02em]" style={{ color: "var(--navy)" }}>
            PSX <span className="font-semibold" style={{ color: "var(--brand)" }}>Portfolio</span>
          </span>
          <span className="block text-[9.5px] font-medium tracking-[0.06em] uppercase mt-[3px]" style={{ color: "var(--faint)" }}>
            Portfolio tracker
          </span>
        </span>
      )}
    </span>
  );
}
