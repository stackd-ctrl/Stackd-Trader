// STACKD TRADER — instrument config.
//
// `key` is the internal symbol used everywhere (DB rows, UI labels, signal
// generator).  `alpacaSymbol` and `polygonTicker` translate to the upstream
// formats. Crypto is delivered by Alpaca's crypto WebSocket; futures must use
// Polygon's futures feed (Alpaca does not stream CME futures).

import type { TradeMode } from '@/types/database';

export type InstrumentClass = 'crypto' | 'futures' | 'equity';
export type PriceFeed = 'alpaca_crypto' | 'alpaca_stocks' | 'polygon_futures';

export interface InstrumentConfig {
  key: string;            // e.g. 'BTC/USD', 'MES'
  display: string;        // pretty label
  class: InstrumentClass;
  feed: PriceFeed;
  alpacaSymbol: string | null;   // e.g. 'BTC/USD' for Alpaca crypto, null for futures
  polygonTicker: string;          // e.g. 'X:BTCUSD', 'I:MES1!' (front-month)
  defaultModes: TradeMode[];      // modes this instrument is allowed in
  /** Dollars per point of price movement per contract. Crypto is 1 (dollar-quoted). */
  contractMultiplier: number;
  /** Minimum price increment for this instrument. */
  tickSize: number;
  /** Minimum stop distance in *points* per spec. */
  minStopPoints: number;
}

export const INSTRUMENTS: InstrumentConfig[] = [
  {
    key: 'BTC/USD',
    display: 'BTC',
    class: 'crypto',
    feed: 'alpaca_crypto',
    alpacaSymbol: 'BTC/USD',
    polygonTicker: 'X:BTCUSD',
    defaultModes: ['paper', 'live_crypto'],
    contractMultiplier: 1,
    tickSize: 0.01,
    minStopPoints: 50,        // ~$50 minimum stop on BTC
  },
  {
    key: 'ETH/USD',
    display: 'ETH',
    class: 'crypto',
    feed: 'alpaca_crypto',
    alpacaSymbol: 'ETH/USD',
    polygonTicker: 'X:ETHUSD',
    defaultModes: ['paper', 'live_crypto'],
    contractMultiplier: 1,
    tickSize: 0.01,
    minStopPoints: 5,         // ~$5 minimum stop on ETH
  },
  {
    key: 'MES',
    display: 'MES',
    class: 'futures',
    feed: 'polygon_futures',
    alpacaSymbol: null,
    polygonTicker: 'I:MES',
    defaultModes: ['paper', 'live_futures', 'topstep'],
    contractMultiplier: 5,    // $5 per point
    tickSize: 0.25,
    minStopPoints: 5,
  },
  {
    key: 'MNQ',
    display: 'MNQ',
    class: 'futures',
    feed: 'polygon_futures',
    alpacaSymbol: null,
    polygonTicker: 'I:MNQ',
    defaultModes: ['paper', 'live_futures', 'topstep'],
    contractMultiplier: 2,    // $2 per point
    tickSize: 0.25,
    minStopPoints: 10,
  },
];

/** Approved-instruments allowlist for Topstep mode. */
export const TOPSTEP_APPROVED_INSTRUMENTS = new Set(['MES', 'MNQ']);

export function instrumentsForMode(mode: TradeMode): InstrumentConfig[] {
  return INSTRUMENTS.filter((i) => i.defaultModes.includes(mode));
}

export function instrumentByKey(key: string): InstrumentConfig | undefined {
  return INSTRUMENTS.find((i) => i.key === key);
}
