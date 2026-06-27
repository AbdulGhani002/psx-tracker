// Shimmer placeholders shown instantly by Next route-level loading.tsx files
// while the server renders the real (cached, sub-second) page underneath. The
// page never looks frozen — content fades in over a moving skeleton.

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

// A generic page scaffold: eyebrow + title + a block of rows/cards. Good enough
// for any of the analysis pages while their data warms.
export function PageSkeleton({ rows = 6, cards = 0 }: { rows?: number; cards?: number }) {
  return (
    <div aria-busy className="fade-in">
      {/* header */}
      <Skeleton className="h-3 w-24 mb-4" />
      <Skeleton className="h-9 w-2/3 max-w-[520px] mb-3" />
      <Skeleton className="h-4 w-full max-w-[640px] mb-1.5" />
      <Skeleton className="h-4 w-5/6 max-w-[560px] mb-10" />

      {/* a table-ish block */}
      <Skeleton className="h-px w-full mb-3" style={{ background: "var(--ink)" }} />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4" style={{ opacity: 1 - i * 0.08 }}>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      {/* optional big cards */}
      {cards > 0 && (
        <div className="mt-10 space-y-6">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="border border-rule p-6" style={{ background: "var(--paper-2)", opacity: 1 - i * 0.18 }}>
              <Skeleton className="h-5 w-40 mb-5" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j}>
                    <Skeleton className="h-2.5 w-16 mb-2" />
                    <Skeleton className="h-6 w-20" />
                  </div>
                ))}
              </div>
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
