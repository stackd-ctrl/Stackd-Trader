'use client';

// STACKD TRADER — Evening performance card.

import { Card } from './dashboard/Card';
import type { EveningReport as EveningReportShape } from '@/lib/claude/evening';

const GRADE_TONE: Record<EveningReportShape['performance_grade'], string> = {
  A: 'text-success', B: 'text-success', C: 'text-accent', D: 'text-warn', F: 'text-danger',
};

const STRAT_TONE: Record<'working' | 'struggling' | 'inactive', string> = {
  working:    'text-success border-success/40 bg-success/10',
  struggling: 'text-danger  border-danger/40  bg-danger/10',
  inactive:   'text-muted   border-line       bg-bg/40',
};

const REC_TONE: Record<EveningReportShape['tomorrow_recommendation'], string> = {
  normal:       'text-success border-success/40 bg-success/10',
  conservative: 'text-warn    border-warn/40    bg-warn/10',
  sit_out:      'text-danger  border-danger/40  bg-danger/10',
};

export function EveningReport({ report }: { report: EveningReportShape }) {
  return (
    <Card title="Evening Report" className="col-span-12">
      <div className="flex items-start gap-6">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted">Grade</div>
          <div className={['font-syne text-6xl font-bold mt-1', GRADE_TONE[report.performance_grade]].join(' ')}>
            {report.performance_grade}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-ink/90 leading-snug">{report.pnl_assessment}</p>

          <div className="flex flex-wrap gap-2 mt-3">
            {(['momentum', 'mean_reversion', 'news_sentiment'] as const).map((key) => {
              const status = report.strategy_breakdown[key];
              return (
                <span key={key} className={['px-2 py-1 rounded border text-[10px] uppercase tracking-[0.14em]', STRAT_TONE[status]].join(' ')}>
                  {key.replace('_', ' ')}: {status}
                </span>
              );
            })}
          </div>
        </div>

        <span className={['px-3 py-1.5 rounded-md border text-xs uppercase tracking-[0.14em] self-start', REC_TONE[report.tomorrow_recommendation]].join(' ')}>
          Tomorrow: {report.tomorrow_recommendation.replace('_', ' ')}
        </span>
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <h4 className="text-[10px] uppercase tracking-[0.22em] text-muted">Pattern identified</h4>
        <p className="text-sm text-ink/80 mt-1">{report.pattern_identified}</p>
      </div>

      <div className="mt-3 rounded-md border border-accent/40 bg-accent/10 px-4 py-3">
        <h4 className="text-[10px] uppercase tracking-[0.22em] text-accent">Actionable insight for tomorrow</h4>
        <p className="text-sm text-accent mt-1 leading-snug">{report.one_actionable_insight}</p>
      </div>

      {report.topstep_status && (
        <p className={['text-xs mt-3 border-l-2 pl-3', report.topstep_status.on_track ? 'border-success/50 text-success' : 'border-danger/50 text-danger'].join(' ')}>
          Topstep: {report.topstep_status.notes}
        </p>
      )}
    </Card>
  );
}
