'use client';

export function Card({
  title,
  subtitle,
  children,
  right,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        'rounded-xl border border-line bg-panel p-5',
        'flex flex-col gap-3',
        className,
      ].join(' ')}
    >
      {(title || right) && (
        <header className="flex items-start justify-between gap-3">
          <div>
            {title && (
              <h3 className="text-[10px] uppercase tracking-[0.22em] text-muted">
                {title}
              </h3>
            )}
            {subtitle && <p className="text-xs text-ink/70 mt-1">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}
