'use client';

// STACKD TRADER — Mobile section nav.
// Horizontal scrollable pill bar shown only below the md breakpoint, replacing
// the desktop sidebar. Sticks under the TopBar so section switching is always
// one tap away on a phone.

import { NAV_ITEMS } from './Sidebar';
import type { SectionKey, SidebarBadges } from './Sidebar';

export function MobileNav({
  active,
  onSelect,
  badges,
}: {
  active: SectionKey;
  onSelect: (key: SectionKey) => void;
  badges?: SidebarBadges;
}) {
  return (
    <nav className="md:hidden sticky top-0 z-20 border-b border-line bg-panel/90 backdrop-blur overflow-x-auto">
      <div className="flex w-max gap-1.5 px-3 py-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              className={[
                'flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium border transition',
                isActive
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'border-line text-ink/75 bg-bg/40',
              ].join(' ')}
            >
              {item.label}
              <Badge item={item.key} badges={badges} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Badge({ item, badges }: { item: SectionKey; badges?: SidebarBadges }) {
  if (!badges) return null;

  if (item === 'positions' && badges.positions && badges.positions.count > 0) {
    const tone = badges.positions.tone === 'red' ? 'bg-danger/20 text-danger' : 'bg-accent/20 text-accent';
    return <span className={['text-[10px] font-semibold px-1.5 rounded num', tone].join(' ')}>{badges.positions.count}</span>;
  }
  if (item === 'signals' && badges.signals && badges.signals.count > 0) {
    const tone = badges.signals.tone === 'red' ? 'bg-danger/20 text-danger' : 'bg-accent/20 text-accent';
    return <span className={['text-[10px] font-semibold px-1.5 rounded num', tone].join(' ')}>{badges.signals.count}</span>;
  }
  if (item === 'risk' && badges.risk === 'alert') {
    return <span className="h-1.5 w-1.5 rounded-full bg-danger animate-pulse" />;
  }
  if (item === 'compliance' && badges.compliance === 'warning') {
    return <span className="h-1.5 w-1.5 rounded-full bg-warn" />;
  }
  return null;
}
