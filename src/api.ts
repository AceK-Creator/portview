import type { AccountMode, QuoteResult } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export async function fetchQuote(query: string, market: AccountMode = 'domestic'): Promise<QuoteResult> {
  const params = new URLSearchParams({ query });
  if (market === 'overseas') params.set('market', 'overseas');
  const response = await fetch(`${API_BASE}/api/quote?${params}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.message || '시세를 불러오지 못했습니다.');
  }

  return payload as QuoteResult;
}

export type MarketIndexItem = QuoteResult;

export interface MarketIndexResult {
  kospi: MarketIndexItem;
  kosdaq: MarketIndexItem;
}

export interface OverseasIndexResult {
  nasdaq: MarketIndexItem;
  sp500: MarketIndexItem;
  usdKrw: MarketIndexItem;
}

export async function fetchMarketIndex(): Promise<MarketIndexResult> {
  const [kospi, kosdaq] = await Promise.all([
    fetchQuote('KOSPI'),
    fetchQuote('KOSDAQ'),
  ]);
  return { kospi, kosdaq };
}

export async function fetchOverseasIndex(): Promise<OverseasIndexResult> {
  const [nasdaq, sp500, usdKrw] = await Promise.all([
    fetchQuote('NASDAQ', 'overseas'),
    fetchQuote('SP500', 'overseas'),
    fetchQuote('USDKRW', 'overseas'),
  ]);
  return { nasdaq, sp500, usdKrw };
}

export interface DividendInfoResult {
  dps: number | null;
  paymentMonths: number[];
  source: string;
  recordDate?: string | null;
  payDate?: string | null;
}

// 배당정보는 로그인 직후 백그라운드에서 미리 조회하고, 배당 탭에서는 같은 세션 캐시를 사용한다.
const dividendInfoCache = new Map<string, DividendInfoResult>();
const dividendInfoPending = new Map<string, Promise<DividendInfoResult>>();

export function clearDividendInfoCache(): void {
  dividendInfoCache.clear();
  dividendInfoPending.clear();
}

export async function fetchDividendInfo(
  code: string,
  market: AccountMode
): Promise<DividendInfoResult> {
  const key = `${market}:${code}`;
  const cached = dividendInfoCache.get(key);
  if (cached) return cached;

  const pending = dividendInfoPending.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const params = new URLSearchParams({ code, market });
      const res = await fetch(`${API_BASE}/api/dividend-info?${params}`);
      if (!res.ok) return { dps: null, paymentMonths: [], source: 'error' };
      return res.json() as Promise<DividendInfoResult>;
    } catch {
      return { dps: null, paymentMonths: [], source: 'error' };
    }
  })();

  dividendInfoPending.set(key, request);
  try {
    const result = await request;
    dividendInfoCache.set(key, result);
    return result;
  } finally {
    dividendInfoPending.delete(key);
  }
}

export async function logClientError(payload: unknown): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Logging must never block the app.
  }
}
