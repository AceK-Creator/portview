import type { QuoteResult } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export async function fetchQuote(query: string): Promise<QuoteResult> {
  const response = await fetch(`${API_BASE}/api/quote?query=${encodeURIComponent(query)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.message || '시세를 불러오지 못했습니다.');
  }

  return payload as QuoteResult;
}

export interface MarketIndexItem {
  code: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
  direction: string;
}

export interface MarketIndexResult {
  kospi: MarketIndexItem;
  kosdaq: MarketIndexItem;
}

export async function fetchMarketIndex(): Promise<MarketIndexResult> {
  const response = await fetch(`${API_BASE}/api/market-index`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || '지수를 불러오지 못했습니다.');
  return payload as MarketIndexResult;
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
