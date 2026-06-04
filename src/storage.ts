import type { AppData } from './types';

const STORAGE_KEY = 'dad-portfolio-pwa:v1';

export const defaultData: AppData = {
  version: 1,
  password: '1235',
  account: {
    totalContribution: 0,
    cashBalance: 0,
  },
  holdings: [],
  dividends: [],
  realizedGains: [],
};

export function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultData;

  try {
    const parsed = JSON.parse(raw) as Partial<AppData>;
    return {
      ...defaultData,
      ...parsed,
      account: {
        ...defaultData.account,
        ...parsed.account,
      },
      holdings: Array.isArray(parsed.holdings)
      ? parsed.holdings.map((h) => ({ ...h, quoteError: undefined }))
      : [],
      dividends: Array.isArray(parsed.dividends) ? parsed.dividends : [],
      realizedGains: Array.isArray(parsed.realizedGains) ? parsed.realizedGains : [],
    };
  } catch {
    return defaultData;
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function createBackupBlob(data: AppData): Blob {
  return new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
}

export function validateBackup(value: unknown): AppData {
  if (!value || typeof value !== 'object') {
    throw new Error('백업 파일 형식이 올바르지 않습니다.');
  }

  const data = value as Partial<AppData>;
  if (!Array.isArray(data.holdings) || !data.account || typeof data.password !== 'string') {
    throw new Error('이 앱의 백업 파일이 아닙니다.');
  }

  return {
    version: 1,
    password: data.password,
    account: {
      totalContribution: Number(data.account.totalContribution) || 0,
      cashBalance: Number(data.account.cashBalance) || 0,
    },
    holdings: data.holdings.map((holding) => ({
      id: String(holding.id),
      code: String(holding.code),
      name: String(holding.name),
      shares: Number(holding.shares) || 0,
      averagePrice: Number(holding.averagePrice) || 0,
      currentPrice: holding.currentPrice == null ? null : Number(holding.currentPrice),
      change: holding.change == null ? null : Number(holding.change),
      changeRate: holding.changeRate == null ? null : Number(holding.changeRate),
      lastPriceAt: holding.lastPriceAt ? String(holding.lastPriceAt) : null,
      priceSource: holding.priceSource ?? null,
      quoteError: holding.quoteError ? String(holding.quoteError) : undefined,
    })),
    dividends: Array.isArray(data.dividends)
      ? data.dividends.map((d) => ({
          id: String(d.id),
          stockCode: String(d.stockCode),
          stockName: String(d.stockName),
          paidAt: String(d.paidAt),
          amount: Number(d.amount) || 0,
        }))
      : [],
    realizedGains: Array.isArray(data.realizedGains)
      ? data.realizedGains.map((r) => ({
          id: String(r.id),
          stockCode: String(r.stockCode),
          stockName: String(r.stockName),
          date: String(r.date),
          amount: Number(r.amount) || 0,
        }))
      : [],
  };
}
