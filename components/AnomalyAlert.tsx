'use client';

// STACKD TRADER — Anomaly overlay alert.
//
// Renders for any unacknowledged anomaly with severity >= medium. Critical is
// modal (cannot dismiss without acknowledging). Lower severities are corner toast.

import type { Anomaly } from '@/types/database';

const SEV_TONE = {
  low:      'border-muted/40   bg-bg/95',
  medium:   'border-warn/50    bg-warn/15',
  high:     'border-danger/60  bg-danger/15',
  critical: 'border-danger     bg-danger/25',
} as const;

const SEV_BADGE = {
  low:      'bg-muted/20  text-muted',
  medium:   'bg-warn/30   text-warn',
  high:     'bg-danger/30 text-danger',
  critical: 'bg-danger    text-bg animate-pulse',
} as const;

export function AnomalyAlert({
  anomaly,
  onAcknowledge,
}: {
  anomaly: Anomaly;
  onAcknowledge: () => void;
}) {
  const isCritical = anomaly.severity === 'critical';

  const container = isCritical
    ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'
    : 'fixed bottom-4 right-4 z-40 max-w-sm';

  return (
    <div role="dialog" aria-modal={isCritical} className={container}>
      <div className={[
        'w-full max-w-md rounded-xl border p-4 shadow-glow',
        SEV_TONE[anomaly.severity],
      ].join(' ')}>
        <div className="flex items-center justify-between">
          <span className={['inline-flex items-center px-2 py-1 rounded text-[10px] uppercase tracking-[0.18em] font-semibold', SEV_BADGE[anomaly.severity]].join(' ')}>
            {anomaly.severity}
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted">
            {new Date(anomaly.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <h3 className="font-syne text-base text-ink mt-2">
          {anomaly.anomaly_type ?? 'Unspecified anomaly'}
        </h3>
        {anomaly.description && (
          <p className="text-sm text-ink/85 mt-1 leading-snug">{anomaly.description}</p>
        )}

        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-ink/70">
            Action: <span className="text-ink font-medium">{anomaly.recommended_action.replace('_', ' ')}</span>
          </span>
          {anomaly.affects_instruments.length > 0 && (
            <span className="text-muted">{anomaly.affects_instruments.join(', ')}</span>
          )}
        </div>

        <button
          onClick={onAcknowledge}
          className={[
            'mt-3 w-full px-3 py-2 rounded-md text-sm font-semibold transition border',
            isCritical
              ? 'bg-danger text-bg border-danger hover:bg-danger/90'
              : 'bg-bg/40 text-ink border-line hover:bg-line/40',
          ].join(' ')}
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
}
