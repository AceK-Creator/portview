import { fetchDividendInfo } from './api';
import type { AccountMode, AppData, DividendRecord, Holding } from './types';

export type DividendEstimateSource = string | 'recent-3m-average' | 'none';

export type DividendEstimateResult = {
  total: number;
  source: DividendEstimateSource;
};

const estimateCache = new Map<string, DividendEstimateResult>();
const estimatePending = new Map<string, Promise<DividendEstimateResult>>();

function buildEstimateKey(holdings: Holding[], dividends: DividendRecord[], market: AccountMode): string {
  return JSON.stringify({
    market,
    holdings: holdings.map((h) => [h.code, h.shares]),
    dividends: dividends.map((d) => [d.stockCode, d.paidAt, d.amount]),
  });
}

export async function calculateDividendEstimate(
  holdings: Holding[],
  dividends: DividendRecord[],
  market: AccountMode,
): Promise<DividendEstimateResult> {
  if (holdings.length === 0) return { total: 0, source: 'none' };

  const key = buildEstimateKey(holdings, dividends, market);
  const cached = estimateCache.get(key);
  if (cached) return cached;

  const pending = estimatePending.get(key);
  if (pending) return pending;

  const request = (async () => {
    const today = new Date();
    const estimates = await Promise.all(
      holdings.map(async (holding) => {
        try {
          const info = await fetchDividendInfo(holding.code, market);
          return calculateNextMonthEstimate({
            code: holding.code,
            shares: holding.shares,
            dividends,
            externalDps: info.dps,
            externalSource: info.source,
            asOf: today,
          });
        } catch {
          return calculateNextMonthEstimate({
            code: holding.code,
            shares: holding.shares,
            dividends,
            externalDps: null,
            externalSource: 'error',
            asOf: today,
          });
        }
      }),
    );

    const total = estimates.reduce((sum, estimate) => sum + (estimate.amount ?? 0), 0);
    const sources = [...new Set(
      estimates
        .filter((estimate) => estimate.amount != null)
        .map((estimate) => estimate.source),
    )];
    const source: DividendEstimateSource =
      sources.length === 0 ? 'none' : sources.length === 1 ? sources[0] : 'mixed';

    const result = { total, source };
    estimateCache.set(key, result);
    return result;
  })();

  estimatePending.set(key, request);
  try {
    return await request;
  } finally {
    estimatePending.delete(key);
  }
}

// PIN 인증/데이터 저장 직후 호출되어 모든 프로필·계좌의 예상 배당금을 미리 계산한다.
// 실제 네트워크 요청은 api.ts의 배당정보 캐시를 통해 세션 동안 재사용된다.
export function preloadDividendEstimates(rootData: { profiles: Array<{ domestic: AppData; overseas: AppData }> }): void {
  for (const profile of rootData.profiles) {
    void calculateDividendEstimate(profile.domestic.holdings, profile.domestic.dividends ?? [], 'domestic');
    void calculateDividendEstimate(profile.overseas.holdings, profile.overseas.dividends ?? [], 'overseas');
  }
}

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
