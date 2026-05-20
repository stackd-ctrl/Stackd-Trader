// STACKD TRADER — Market data router.
//
// Routes candle + snapshot reads to the right upstream by instrument feed:
//   crypto  (feed 'alpaca_crypto')  -> Alpaca data API (free, ~200/min)
//   futures (feed 'polygon_futures') -> Polygon REST
//
// This exists because Polygon's free tier caps at 5 calls/min; a 5-7 instrument
// scan (2 candle calls each + regime recompute) blows past that and every
// instrument 429s -> "no_data" -> the bot never trades. Crypto bars from Alpaca
// have a ~200/min ceiling, so the scan runs cleanly.

import 'server-only';
import { instrumentByKey } from '@/lib/instruments';
import {
  getCandles as polygonCandles,
  getSnapshot as polygonSnapshot,
  type Candle,
  type Timeframe,
} from '@/lib/polygon/client';
import { getCryptoBars, getCryptoSnapshot } from '@/lib/alpaca/client';

export type { Candle, Timeframe };

export interface MarketSnapshot {
  ticker: string;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changePct: number;
  timestamp: string;
}

export async function getCandles(
  instrument: string,
  timeframe: Timeframe = '5m',
  limit = 100,
): Promise<Candle[]> {
  const inst = instrumentByKey(instrument);
  if (inst?.feed === 'alpaca_crypto') {
    const symbol = inst.alpacaSymbol ?? instrument;
    return getCryptoBars(symbol, timeframe, limit);
  }
  return polygonCandles(instrument, timeframe, limit);
}

export async function getSnapshot(instrument: string): Promise<MarketSnapshot> {
  const inst = instrumentByKey(instrument);
  if (inst?.feed === 'alpaca_crypto') {
    const symbol = inst.alpacaSymbol ?? instrument;
    const [snap] = await getCryptoSnapshot([symbol]);
    if (!snap) throw new Error(`No Alpaca crypto snapshot for ${instrument}`);
    const changePct = snap.open > 0 ? ((snap.price - snap.open) / snap.open) * 100 : 0;
    return {
      ticker: instrument,
      price: snap.price,
      open: snap.open,
      high: snap.high,
      low: snap.low,
      close: snap.price,
      volume: snap.volume,
      changePct,
      timestamp: snap.timestamp,
    };
  }
  const p = await polygonSnapshot(instrument);
  return {
    ticker: p.ticker,
    price: p.price,
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
    volume: p.volume,
    changePct: p.changePct,
    timestamp: p.timestamp,
  };
}
