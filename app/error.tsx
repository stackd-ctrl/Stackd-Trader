'use client';

// Next.js App Router automatically wires this as the global error boundary
// for the entire app segment. One failing component cannot crash the whole
// dashboard — it lands here with a reset button.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[error-boundary] Rendered fallback:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-bg text-ink">
      <div className="max-w-md text-center">
        <div className="font-syne text-xs tracking-[0.22em] text-accent">STACKD TRADER</div>
        <h1 className="font-syne text-3xl mt-2">Something went wrong</h1>
        <p className="text-sm text-ink/70 mt-3">
          One component crashed. The trading engine itself is unaffected — Supabase, Alpaca, and crons keep running.
        </p>
        {error.digest && (
          <p className="text-[10px] text-muted mt-3 font-mono">digest: {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-md text-sm font-semibold bg-accent text-bg hover:bg-accent/90"
          >
            Reload
          </button>
          <a
            href="/api/test"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-md text-sm text-ink/80 border border-line hover:bg-line/40"
          >
            Run health check
          </a>
        </div>
      </div>
    </div>
  );
}
