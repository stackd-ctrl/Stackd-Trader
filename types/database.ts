// STACKD TRADER — Database types
// Mirror of supabase/migrations/001_initial_schema.sql.
// Keep this file in sync any time the schema changes.

export type TradeMode = 'paper' | 'live_crypto' | 'live_futures' | 'topstep';
export type TradeStrategy = 'momentum' | 'mean_reversion' | 'news_sentiment';
export type TradeStatus = 'open' | 'closed' | 'cancelled';
export type TradeDirection = 'long' | 'short';
export type SignalAction = 'enter' | 'skip';
export type MarketRegime =
  | 'trending'
  | 'ranging'
  | 'high_volatility'
  | 'extreme_volatility'
  | 'low_volatility';
export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'regime' | 'stream' | 'signal' | 'order' | 'system';
export type ClaudeCallType =
  | 'sentiment'
  | 'signal_explain'
  | 'morning_brief'
  | 'evening_report'
  | 'anomaly_check'
  | 'regime_classify';
export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical';
export type AnomalyAction =
  | 'continue'
  | 'reduce_exposure'
  | 'pause_bot'
  | 'close_positions';
export type RiskGuardDecision = 'approved' | 'blocked' | 'adjusted';
export type ExitReason =
  | 'stop_loss'
  | 'take_profit'
  | 'manual'
  | 'end_of_day'
  | 'kill_switch'
  | 'risk_concern'
  | 'strategy_change';

export type Trade = {
  id: string;
  mode: TradeMode;
  strategy: TradeStrategy;
  instrument: string;
  direction: TradeDirection | null;
  entry_price: number;
  exit_price: number | null;
  stop_loss: number;
  take_profit: number;
  quantity: number;
  status: TradeStatus;
  pnl: number;
  signal_score: number | null;
  claude_reasoning: string | null;
  entry_time: string;
  exit_time: string | null;
  entry_order_id: string | null;
  stop_order_id: string | null;
  target_order_id: string | null;
  exit_reason: string | null;
  contract_multiplier: number;
  created_at: string;
};

export type Signal = {
  id: string;
  mode: TradeMode;
  instrument: string;
  strategy: TradeStrategy;
  direction: TradeDirection | null;
  rsi: number | null;
  macd: number | null;
  macd_histogram: number | null;
  volume_ratio: number | null;
  key_level_break: boolean;
  atr: number | null;
  regime: MarketRegime | null;
  raw_score: number | null;
  sentiment_score: number | null;
  total_score: number;
  action: SignalAction;
  claude_explanation: string | null;
  created_at: string;
};

export type NewsItem = {
  id: string;
  instrument: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  sentiment_score: number | null;
  published_at: string;
  created_at: string;
};

export type CalendarEvent = {
  id: string;
  event: string;
  country: string | null;
  impact: 'low' | 'medium' | 'high' | null;
  scheduled_at: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  created_at: string;
};

export type BotEvent = {
  id: string;
  mode: TradeMode;
  level: LogLevel;
  category: LogCategory;
  message: string;
  context: Record<string, unknown> | null;
  created_at: string;
};

export type DailySummary = {
  id: string;
  mode: TradeMode;
  date: string;
  total_trades: number;
  winners: number;
  losers: number;
  gross_pnl: number;
  win_rate: number;
  drawdown_pct: number;
  compliance_passed: boolean;
  topstep_notes: string | null;
  morning_brief: Record<string, unknown> | null;
  morning_read_at: string | null;
  evening_report: Record<string, unknown> | null;
  evening_read_at: string | null;
  created_at: string;
};

export type ClaudeCall = {
  id: string;
  call_type: ClaudeCallType;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  duration_ms: number;
  success: boolean;
  error_message: string | null;
  context: Record<string, unknown> | null;
  created_at: string;
};

export type RiskGuardLog = {
  id: string;
  mode: TradeMode;
  instrument: string;
  strategy: TradeStrategy;
  decision: RiskGuardDecision;
  failed_check: string | null;
  reason: string | null;
  proposed_size: number | null;
  adjusted_size: number | null;
  proposed_entry: number | null;
  proposed_stop: number | null;
  context: Record<string, unknown> | null;
  created_at: string;
};

export type AccountSnapshot = {
  id: string;
  mode: TradeMode;
  equity: number;
  cash: number;
  buying_power: number;
  peak_equity: number;
  drawdown_pct: number;
  snapshot_at: string;
};

export type Anomaly = {
  id: string;
  mode: TradeMode;
  severity: AnomalySeverity;
  anomaly_type: string | null;
  description: string | null;
  recommended_action: AnomalyAction;
  affects_instruments: string[];
  context: Record<string, unknown> | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  created_at: string;
};

export type BotStatus = {
  id: string;
  mode: TradeMode;
  is_active: boolean;
  regime: MarketRegime;
  daily_pnl: number;
  daily_trades: number;
  daily_loss_limit_hit: boolean;
  paused_until: string | null;
  consecutive_losses: number;
  paper_started_at: string | null;
  paper_starting_balance: number | null;
  last_updated: string;
};

export type ComplianceApproval = {
  id: string;
  mode: TradeMode;
  date: string;
  morning_approved: boolean;
  morning_at: string | null;
  approved_by: string | null;
  morning_failed: string[];
  evening_audit: Record<string, unknown> | null;
  rule_violations: string[];
  created_at: string;
};

export type StrategyFlag = {
  id: string;
  mode: TradeMode;
  strategy: TradeStrategy;
  is_enabled: boolean;
  updated_at: string;
};

export type RiskSettings = {
  id: string;
  mode: TradeMode;
  max_risk_per_trade_pct: number;
  daily_loss_limit_pct: number;
  profit_target_pct: number;
  max_contracts: number;
  is_topstep_mode: boolean;
  topstep_daily_loss_limit: number;
  topstep_max_drawdown: number;
  topstep_profit_target: number;
  updated_at: string;
};

// Supabase typed-client schema map.
//
// IMPORTANT: Insert/Update types must be explicit object-literal types, not
// computed intersections like `Omit<Row, K> & Partial<Pick<Row, K>>`. The
// supabase-js v2 client uses chained conditional inference that fails to
// unify computed types — every chained call (.update/.insert/.select) collapses
// to `never`. Explicit object literals match what `supabase gen types` emits
// and unify cleanly.
export type Database = {
  public: {
    Tables: {
      trades: {
        Row: Trade;
        Insert: {
          id?: string;
          mode: TradeMode;
          strategy: TradeStrategy;
          instrument: string;
          direction?: TradeDirection | null;
          entry_price: number;
          exit_price?: number | null;
          stop_loss: number;
          take_profit: number;
          quantity: number;
          status?: TradeStatus;
          pnl?: number;
          signal_score?: number | null;
          claude_reasoning?: string | null;
          entry_time?: string;
          exit_time?: string | null;
          entry_order_id?: string | null;
          stop_order_id?: string | null;
          target_order_id?: string | null;
          exit_reason?: string | null;
          contract_multiplier?: number;
          created_at?: string;
        };
        Update: Partial<Trade>;
        Relationships: [];
      };
      signals: {
        Row: Signal;
        Insert: {
          id?: string;
          mode: TradeMode;
          instrument: string;
          strategy: TradeStrategy;
          direction?: TradeDirection | null;
          rsi?: number | null;
          macd?: number | null;
          macd_histogram?: number | null;
          volume_ratio?: number | null;
          key_level_break?: boolean;
          atr?: number | null;
          regime?: MarketRegime | null;
          raw_score?: number | null;
          sentiment_score?: number | null;
          total_score: number;
          action: SignalAction;
          claude_explanation?: string | null;
          created_at?: string;
        };
        Update: Partial<Signal>;
        Relationships: [];
      };
      daily_summaries: {
        Row: DailySummary;
        Insert: {
          id?: string;
          mode: TradeMode;
          date: string;
          total_trades?: number;
          winners?: number;
          losers?: number;
          gross_pnl?: number;
          win_rate?: number;
          drawdown_pct?: number;
          compliance_passed?: boolean;
          topstep_notes?: string | null;
          morning_brief?: Record<string, unknown> | null;
          morning_read_at?: string | null;
          evening_report?: Record<string, unknown> | null;
          evening_read_at?: string | null;
          created_at?: string;
        };
        Update: Partial<DailySummary>;
        Relationships: [];
      };
      bot_status: {
        Row: BotStatus;
        Insert: {
          id?: string;
          mode: TradeMode;
          is_active?: boolean;
          regime?: MarketRegime;
          daily_pnl?: number;
          daily_trades?: number;
          daily_loss_limit_hit?: boolean;
          paused_until?: string | null;
          consecutive_losses?: number;
          paper_started_at?: string | null;
          paper_starting_balance?: number | null;
          last_updated?: string;
        };
        Update: Partial<BotStatus>;
        Relationships: [];
      };
      risk_settings: {
        Row: RiskSettings;
        Insert: {
          id?: string;
          mode: TradeMode;
          max_risk_per_trade_pct?: number;
          daily_loss_limit_pct?: number;
          profit_target_pct?: number;
          max_contracts?: number;
          is_topstep_mode?: boolean;
          topstep_daily_loss_limit?: number;
          topstep_max_drawdown?: number;
          topstep_profit_target?: number;
          updated_at?: string;
        };
        Update: Partial<RiskSettings>;
        Relationships: [];
      };
      news: {
        Row: NewsItem;
        Insert: {
          id?: string;
          instrument?: string | null;
          title: string;
          summary?: string | null;
          url?: string | null;
          source?: string | null;
          sentiment_score?: number | null;
          published_at: string;
          created_at?: string;
        };
        Update: Partial<NewsItem>;
        Relationships: [];
      };
      calendar_events: {
        Row: CalendarEvent;
        Insert: {
          id?: string;
          event: string;
          country?: string | null;
          impact?: 'low' | 'medium' | 'high' | null;
          scheduled_at: string;
          actual?: string | null;
          forecast?: string | null;
          previous?: string | null;
          created_at?: string;
        };
        Update: Partial<CalendarEvent>;
        Relationships: [];
      };
      bot_event_log: {
        Row: BotEvent;
        Insert: {
          id?: string;
          mode: TradeMode;
          level?: LogLevel;
          category: LogCategory;
          message: string;
          context?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: Partial<BotEvent>;
        Relationships: [];
      };
      claude_calls: {
        Row: ClaudeCall;
        Insert: {
          id?: string;
          call_type: ClaudeCallType;
          model: string;
          input_tokens?: number;
          output_tokens?: number;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          cost_usd?: number;
          duration_ms?: number;
          success?: boolean;
          error_message?: string | null;
          context?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: Partial<ClaudeCall>;
        Relationships: [];
      };
      anomalies: {
        Row: Anomaly;
        Insert: {
          id?: string;
          mode: TradeMode;
          severity: AnomalySeverity;
          anomaly_type?: string | null;
          description?: string | null;
          recommended_action?: AnomalyAction;
          affects_instruments?: string[];
          context?: Record<string, unknown> | null;
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          created_at?: string;
        };
        Update: Partial<Anomaly>;
        Relationships: [];
      };
      risk_guard_log: {
        Row: RiskGuardLog;
        Insert: {
          id?: string;
          mode: TradeMode;
          instrument: string;
          strategy: TradeStrategy;
          decision: RiskGuardDecision;
          failed_check?: string | null;
          reason?: string | null;
          proposed_size?: number | null;
          adjusted_size?: number | null;
          proposed_entry?: number | null;
          proposed_stop?: number | null;
          context?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: Partial<RiskGuardLog>;
        Relationships: [];
      };
      account_snapshots: {
        Row: AccountSnapshot;
        Insert: {
          id?: string;
          mode: TradeMode;
          equity: number;
          cash: number;
          buying_power: number;
          peak_equity: number;
          drawdown_pct?: number;
          snapshot_at?: string;
        };
        Update: Partial<AccountSnapshot>;
        Relationships: [];
      };
      compliance_approvals: {
        Row: ComplianceApproval;
        Insert: {
          id?: string;
          mode: TradeMode;
          date: string;
          morning_approved?: boolean;
          morning_at?: string | null;
          approved_by?: string | null;
          morning_failed?: string[];
          evening_audit?: Record<string, unknown> | null;
          rule_violations?: string[];
          created_at?: string;
        };
        Update: Partial<ComplianceApproval>;
        Relationships: [];
      };
      strategy_flags: {
        Row: StrategyFlag;
        Insert: {
          id?: string;
          mode: TradeMode;
          strategy: TradeStrategy;
          is_enabled?: boolean;
          updated_at?: string;
        };
        Update: Partial<StrategyFlag>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      trade_mode: TradeMode;
      trade_strategy: TradeStrategy;
      trade_status: TradeStatus;
      trade_direction: TradeDirection;
      signal_action: SignalAction;
      market_regime: MarketRegime;
      claude_call_type: ClaudeCallType;
      anomaly_severity: AnomalySeverity;
      anomaly_action: AnomalyAction;
      risk_guard_decision: RiskGuardDecision;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

// UI helper — pretty labels for every mode.
export const MODE_LABELS: Record<TradeMode, string> = {
  paper: 'Paper',
  live_crypto: 'Live Crypto',
  live_futures: 'Live Futures',
  topstep: 'Topstep',
};

export const MODE_IS_LIVE: Record<TradeMode, boolean> = {
  paper: false,
  live_crypto: true,
  live_futures: true,
  topstep: true,
};

export const REGIME_LABELS: Record<MarketRegime, string> = {
  trending: 'Trending',
  ranging: 'Ranging',
  high_volatility: 'High Volatility',
  extreme_volatility: 'Extreme Volatility',
  low_volatility: 'Low Volatility',
};
