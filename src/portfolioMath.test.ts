import { describe, expect, it } from 'vitest';
import { calculateAccountSummary, calculateHoldingRows } from './portfolioMath';
import type { Holding } from './types';

const holdings: Holding[] = [
  {
    id: 'samsung',
    code: '005930',
    name: '삼성전자',
    shares: 10,
    averagePrice: 60000,
    currentPrice: 72000,
    change: null,
    changeRate: null,
    lastPriceAt: '2026-05-31T09:00:00+09:00',
    priceSource: 'test',
  },
  {
    id: 'kodex',
    code: '069500',
    name: 'KODEX 200',
    shares: 5,
    averagePrice: 100000,
    currentPrice: 95000,
    change: null,
    changeRate: null,
    lastPriceAt: '2026-05-31T09:00:00+09:00',
    priceSource: 'test',
  },
];

describe('portfolio calculations', () => {
  it('calculates row values and weights from current market value', () => {
    const rows = calculateHoldingRows(holdings);

    expect(rows[0]).toMatchObject({
      investedAmount: 600000,
      marketValue: 720000,
      profitLoss: 120000,
      returnRate: 20,
    });
    expect(rows[1]).toMatchObject({
      investedAmount: 500000,
      marketValue: 475000,
      profitLoss: -25000,
      returnRate: -5,
    });

    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    expect(totalWeight).toBeCloseTo(100, 5);
  });

  it('calculates account summary from user inputs and total market value', () => {
    const rows = calculateHoldingRows(holdings);
    const summary = calculateAccountSummary(rows, {
      totalContribution: 1500000,
      cashBalance: 200000,
    });

    expect(summary.totalMarketValue).toBe(1195000);
    expect(summary.currentTotalAssets).toBe(1395000);
    expect(summary.cashRatio).toBeCloseTo((200000 / 1395000) * 100, 5);
    expect(summary.totalProfitLoss).toBe(-105000);
    expect(summary.totalReturnRate).toBeCloseTo(-7, 5);
  });
});
