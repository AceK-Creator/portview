import type { DividendRecord } from './types';

export type DividendEstimateSource = string | 'recent-3m-average' | 'none';

export function calculateNextMonthEstimate({
  code,
  shares,
  dividends,
  externalDps,
  externalSource,
  asOf,
}: {
  code: string;
  shares: number;
  dividends: DividendRecord[];
  externalDps: number | null;
  externalSource: string;
  asOf: Date;
}): { amount: number | null; source: DividendEstimateSource } {
  if (externalDps != null && externalDps > 0 && shares > 0) {
    return { amount: externalDps * shares, source: externalSource };
  }

  const cutoff = new Date(asOf.getFullYear(), asOf.getMonth() - 3, 1);
  const recentByMonth = new Map<string, number>();
  dividends
    .filter((record) => record.stockCode === code && new Date(record.paidAt) >= cutoff && new Date(record.paidAt) < asOf)
    .forEach((record) => {
      const month = record.paidAt.slice(0, 7);
      recentByMonth.set(month, (recentByMonth.get(month) || 0) + record.amount);
    });

  const amounts = [...recentByMonth.values()].slice(-3);
  if (!amounts.length) return { amount: null, source: 'none' };
  return { amount: amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length, source: 'recent-3m-average' };
}
