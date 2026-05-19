// STACKD TRADER — Position sizer (pure math).

import { instrumentByKey } from '@/lib/instruments';

export type SizingRecommendation = 'full' | 'half' | 'skip';

export interface SizeResult {
  contracts: number;
  dollarRisk: number;
  riskPct: number;
}

const BASE_RISK_PCT = 0.015;       // 1.5% of account per trade
const SMALL_ACCOUNT_THRESHOLD = 5000;
const SMALL_ACCOUNT_MAX_CONTRACTS = 2;

export function calculatePositionSize(
  accountBalance: number,
  entryPrice: number,
  stopPrice: number,
  instrument: string,
  signalScore: number,
  sizingRecommendation: SizingRecommendation,
  currentDrawdownPct: number,
): SizeResult {
  if (sizingRecommendation === 'skip') {
    return { contracts: 0, dollarRisk: 0, riskPct: 0 };
  }
  if (accountBalance <= 0) {
    return { contracts: 0, dollarRisk: 0, riskPct: 0 };
  }

  const inst = instrumentByKey(instrument);
  const multiplier = inst?.contractMultiplier ?? 1;

  const pointsAtRisk = Math.abs(entryPrice - stopPrice);
  if (pointsAtRisk <= 0) {
    return { contracts: 0, dollarRisk: 0, riskPct: 0 };
  }

  const dollarRiskPerContract = pointsAtRisk * multiplier;
  if (dollarRiskPerContract <= 0) {
    return { contracts: 0, dollarRisk: 0, riskPct: 0 };
  }

  const maxDollarRisk = accountBalance * BASE_RISK_PCT;
  let contracts = Math.floor(maxDollarRisk / dollarRiskPerContract);

  // Sizing recommendation modifier.
  if (sizingRecommendation === 'half') contracts = Math.floor(contracts * 0.5);

  // High-conviction bump (only when sizing rec is 'full', not 'half').
  if (sizingRecommendation === 'full' && signalScore > 90) {
    contracts = Math.floor(contracts * 1.25);
  }

  // Drawdown scaling (compounds with sizing rec).
  if (currentDrawdownPct > 8) {
    contracts = Math.floor(contracts * 0.5);
  } else if (currentDrawdownPct > 5) {
    contracts = Math.floor(contracts * 0.75);
  }

  // Floor at 1 contract.
  contracts = Math.max(1, contracts);

  // Small-account cap.
  if (accountBalance < SMALL_ACCOUNT_THRESHOLD) {
    contracts = Math.min(contracts, SMALL_ACCOUNT_MAX_CONTRACTS);
  }

  const dollarRisk = Number((contracts * dollarRiskPerContract).toFixed(2));
  const riskPct = Number(((dollarRisk / accountBalance) * 100).toFixed(2));

  return { contracts, dollarRisk, riskPct };
}
