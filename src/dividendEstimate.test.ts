import { describe, expect, it } from 'vitest';
import { calculateNextMonthEstimate } from './dividendEstimate';

const records = [
  { id: '1', stockCode: '473330', stockName: 'SOL', paidAt: '2026-06-01', amount: 1000 },
  { id: '2', stockCode: '473330', stockName: 'SOL', paidAt: '2026-07-01', amount: 1200 },
  { id: '3', stockCode: '473330', stockName: 'SOL', paidAt: '2026-08-01', amount: 1400 },
];

describe('next month dividend estimate', () => {
  it('uses external per-share distribution first', () => {
    expect(calculateNextMonthEstimate({ code: '473330', shares: 10, dividends: records, externalDps: 60, externalSource: 'sol-official', asOf: new Date('2026-09-03') })).toEqual({ amount: 600, source: 'sol-official' });
  });

  it('falls back to the latest three paid months average', () => {
    expect(calculateNextMonthEstimate({ code: '473330', shares: 10, dividends: records, externalDps: null, externalSource: 'error', asOf: new Date('2026-09-03') })).toEqual({ amount: 1200, source: 'recent-3m-average' });
  });

  it('distinguishes no estimate from a zero amount', () => {
    expect(calculateNextMonthEstimate({ code: 'none', shares: 0, dividends: [], externalDps: null, externalSource: 'error', asOf: new Date('2026-09-03') })).toEqual({ amount: null, source: 'none' });
  });
});
