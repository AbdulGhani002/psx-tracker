export function SetupBanner({ reason }: { reason?: string }) {
  return (
    <div className="mb-8 p-5 border-l-[4px] border-l-[var(--accent-deep)] bg-[var(--paper-2)]">
      <div className="section-eyebrow mb-2" style={{ color: "var(--accent-deep)" }}>
        Setup required
      </div>
      <p className="text-[14px] leading-relaxed">
        MongoDB isn&apos;t reachable. Set <code className="font-mono text-[12px]">MONGODB_URI</code>{" "}
        in <code className="font-mono text-[12px]">.env.local</code> and start your database,
        then run <code className="font-mono text-[12px]">npm run seed</code> to initialise holdings.
      </p>
      {reason && (
        <details className="mt-3 text-[12px] text-muted">
          <summary className="cursor-pointer">Details</summary>
          <pre className="mt-2 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
            {reason}
          </pre>
        </details>
      )}
    </div>
  );
}
