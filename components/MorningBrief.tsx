'use client';

// STACKD TRADER — Morning brief card. Shows the most recent morning_brief
// for the active mode. Dismiss writes morning_read_at via /api/morning/read.

import { Card } from './dashboard/Card';
import type { MorningBrief as MorningBriefShape } from '@/lib/claude/morning';

const COND_STYLE: Record<MorningBriefShape['overall_conditions'], string> = {
  favorable: 'text-success border-success/40 bg-success/10',
  caution:   'text-warn    border-warn/40    bg-warn/10',
  avoid:     'text-danger  border-danger/40  bg-danger/10',
};

const REC_STYLE: Record<MorningBriefShape['bot_recommendation'], string> = {
  full_activity:     'text-success border-success/40 bg-success/10',
  reduced_activity:  'text-warn    border-warn/40    bg-warn/10',
  sit_out:           'text-danger  border-danger/40  bg-danger/10',
};

export function MorningBrief({
  brief,
  onDismiss,
}: {
  brief: MorningBriefShape;
  onDismiss: () => void;
}) {
  return (
    <Card
      title={`Morning Brief // ${brief.date}`}
      className="col-span-12"
      right={
        <button
          onClick={onDismiss}
          className="text-[10px] uppercase tracking-[0.18em] text-muted hover:text-ink transition"
        >
          Dismiss
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={['inline-flex items-center px-2.5 py-1 rounded border text-xs uppercase tracking-[0.14em]', COND_STYLE[brief.overall_conditions]].join(' ')}>
          {brief.overall_conditions}
        </span>
        <span className={['inline-flex items-center px-2.5 py-1 rounded border text-xs uppercase tracking-[0.14em]', REC_STYLE[brief.bot_recommendation]].join(' ')}>
          Bot: {brief.bot_recommendation.replace('_', ' ')}
        </span>
      </div>

      <p className="font-syne text-lg text-ink mt-2 leading-snug">
        {brief.one_sentence_summary}
      </p>

      <p className="text-xs text-ink/70 mt-2">{brief.regime_assessment}</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
        <div>
          <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted">Key risks today</h4>
          <ul className="mt-2 space-y-1 text-sm text-ink/85">
            {brief.key_risks_today.length === 0 ? (
              <li className="text-muted">None flagged.</li>
            ) : (
              brief.key_risks_today.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-danger">•</span>
                  <span>{r}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div>
          <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted">Instruments to watch</h4>
          <ul className="mt-2 space-y-1 text-sm text-ink/85">
            {brief.instruments_to_watch.length === 0 ? (
              <li className="text-muted">None flagged.</li>
            ) : (
              brief.instruments_to_watch.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-accent font-medium">{w.instrument}</span>
                  <span className="text-ink/70">{w.reason}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {brief.economic_events_warning && (
        <p className="text-xs text-warn border-l-2 border-warn/50 pl-3 mt-3">
          {brief.economic_events_warning}
        </p>
      )}
      {brief.topstep_guidance && (
        <p className="text-xs text-accent border-l-2 border-accent/50 pl-3 mt-2">
          Topstep: {brief.topstep_guidance}
        </p>
      )}
    </Card>
  );
}
