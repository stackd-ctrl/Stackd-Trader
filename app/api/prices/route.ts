// GET /api/prices?mode=paper
// Returns the latest snapshot for every instrument the given mode watches.

import { NextResponse } from 'next/server';
import {
  getCryptoSnapshot,
  getStocksSnapshot,
  type AlpacaSnapshot,
} from '@/lib/alpaca/client';
import { getSnapshot as polygonSnapshot } from '@/lib/polygon/client';
import { instrumentsForMode } from '@/lib/instruments';
import type { TradeMode } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PriceRow {
  instrument: string;
  price: number;
  open: number;
  changePct: number;
  timestamp: string;
}

function toRow(internalKey: string, snap: AlpacaSnapshot): PriceRow {
  const changePct = snap.open > 0 ? ((snap.price - snap.open) / snap.open) * 100 : 0;
  return {
    instrument: internalKey,
    price: snap.price,
    open: snap.open,
    changePct,
    timestamp: snap.timestamp,
  };
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const mode = (url.searchParams.get('mode') ?? 'paper') as TradeMode;
  const instruments = instrumentsForMode(mode);

  const crypto = instruments.filter((i) => i.feed === 'alpaca_crypto');
  const stocks = instruments.filter((i) => i.feed === 'alpaca_stocks');
  const futures = instruments.filter((i) => i.feed === 'polygon_futures');

  const out: PriceRow[] = [];
  const errors: string[] = [];

  try {
    if (crypto.length > 0) {
      const snaps = await getCryptoSnapshot(
        crypto.map((i) => i.alpacaSymbol as string),
      );
      for (const s of snaps) {
        const inst = crypto.find((i) => i.alpacaSymbol === s.symbol);
        if (inst) out.push(toRow(inst.key, s));
      }
    }
  } catch (err) {
    errors.push(`crypto: ${(err as Error).message}`);
  }

  try {
    if (stocks.length > 0) {
      const snaps = await getStocksSnapshot(
        stocks.map((i) => i.alpacaSymbol as string),
      );
      for (const s of snaps) {
        const inst = stocks.find((i) => i.alpacaSymbol === s.symbol);
        if (inst) out.push(toRow(inst.key, s));
      }
    }
  } catch (err) {
    errors.push(`stocks: ${(err as Error).message}`);
  }

  // Futures: Polygon snapshot per instrument.
  for (const inst of futures) {
    try {
      const s = await polygonSnapshot(inst.key);
      out.push({
        instrument: inst.key,
        price: s.price,
        open: s.open,
        changePct: s.changePct,
        timestamp: s.timestamp,
      });
    } catch (err) {
      errors.push(`${inst.key}: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({ prices: out, errors });
}
