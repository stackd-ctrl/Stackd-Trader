'use client';

export type SectionKey =
  | 'overview'
  | 'positions'
  | 'signals'
  | 'trades'
  | 'performance'
  | 'risk'
  | 'compliance'
  | 'settings';

export interface NavItem {
  key: SectionKey;
  label: string;
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'overview',    label: 'Overview',          description: 'Today at a glance' },
  { key: 'positions',   label: 'Live Positions',    description: 'Open trades' },
  { key: 'signals',     label: 'Signal Feed',       description: 'AI signal analysis' },
  { key: 'trades',      label: 'Trade Log',         description: 'Full history' },
  { key: 'performance', label: 'Performance',       description: 'Strategy analytics' },
  { key: 'risk',        label: 'Risk Monitor',      description: 'Safety gauges' },
  { key: 'compliance',  label: 'Topstep Compliance',description: 'Evaluation tracker' },
  { key: 'settings',    label: 'Settings',          description: 'Configuration' },
];

export interface SidebarBadges {
  positions?: { count: number; tone: 'red' | 'gold' };
  signals?:   { count: number; tone: 'red' | 'gold' };
  risk?:      'alert' | null;
  compliance?: 'warning' | null;
}

export function Sidebar({
  active,
  onSelect,
  badges,
}: {
  active: SectionKey;
  onSelect: (key: SectionKey) => void;
  badges?: SidebarBadges;
}) {
  return (
    <aside className="hidden md:flex w-64 shrink-0 border-r border-line bg-panel/40 min-h-[calc(100vh-64px)] flex-col">
      <nav className="p-3 space-y-1 flex-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={[
                'w-full text-left px-3 py-2 rounded-md transition border',
                isActive
                  ? 'bg-accent/10 text-accent border-accent/30'
                  : 'border-transparent text-ink/80 hover:bg-line/40 hover:text-ink',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{item.label}</span>
                <BadgeFor item={item.key} badges={badges} />
              </div>
              <div className={['text-[10px] uppercase tracking-[0.14em] mt-0.5',
                isActive ? 'text-accent/70' : 'text-muted'].join(' ')}>
                {item.description}
              </div>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-line text-[10px] uppercase tracking-[0.18em] text-muted">
        v1.0 // Day 5
      </div>
    </aside>
  );
}

function BadgeFor({ item, badges }: { item: SectionKey; badges?: SidebarBadges }) {
  if (!badges) return null;

  if (item === 'positions' && badges.positions && badges.positions.count > 0) {
    const tone = badges.positions.tone === 'red' ? 'bg-danger/20 text-danger' : 'bg-accent/20 text-accent';
    return <span className={['text-[10px] font-semibold px-1.5 py-0.5 rounded num', tone].join(' ')}>{badges.positions.count}</span>;
  }
  if (item === 'signals' && badges.signals && badges.signals.count > 0) {
    const tone = badges.signals.tone === 'red' ? 'bg-danger/20 text-danger' : 'bg-accent/20 text-accent';
    return <span className={['text-[10px] font-semibold px-1.5 py-0.5 rounded num', tone].join(' ')}>{badges.signals.count}</span>;
  }
  if (item === 'risk' && badges.risk === 'alert') {
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-danger/20 text-danger uppercase tracking-wider animate-pulse">ALERT</span>;
  }
  if (item === 'compliance' && badges.compliance === 'warning') {
    return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-warn/20 text-warn uppercase tracking-wider">WARN</span>;
  }
  return null;
}
