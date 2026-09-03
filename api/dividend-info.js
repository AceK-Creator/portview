import { fetchDomesticDividend } from './dividend-sources.js';

// 12개월 이내 여부 판단
function isWithin12Months(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  return d >= cutoff;
}

// Reuters/Naver 코드 → Yahoo Finance 티커 변환
// 예: AAPL.O → AAPL, AAPL.OQ → AAPL, BRK/B → BRK-B
function toYahooTicker(code) {
  return code
    .replace(/\.(O|OQ|N|A|P|PK)$/i, '')
    .replace(/\//g, '-')
    .toUpperCase();
}

// Yahoo Finance (해외)
async function fetchYahooDividend(ticker) {
  const yahooTicker = toYahooTicker(ticker);
  const YAHOO_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // query1 → query2 순서로 시도
  let data = null;
  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?events=dividends&range=2y&interval=1d`;
      const res = await globalThis.fetch(url, { headers: YAHOO_HEADERS, signal: globalThis.AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      data = await res.json();
      if (data?.chart?.result?.[0]) break;
    } catch { continue; }
  }

  if (!data) throw new Error('yahoo: 응답 없음');
  const dividends = data?.chart?.result?.[0]?.events?.dividends;
  if (!dividends) throw new Error('yahoo: 배당 데이터 없음');

  // dividends는 { timestamp: { amount, date } } 형태
  const entries = Object.values(dividends)
    .map(d => ({ amount: d.amount, date: new Date(d.date * 1000) }))
    .filter(d => isWithin12Months(d.date.toISOString().slice(0, 10)))
    .sort((a, b) => b.date - a.date);

  if (entries.length === 0) throw new Error('yahoo: 최근 12개월 배당 없음');

  const paymentMonths = [...new Set(entries.map(d => d.date.getMonth() + 1))].sort((a,b) => a-b);
  const dps = entries[0].amount;

  return { dps, paymentMonths, source: 'yahoo' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const code = String(req.query?.code || '').trim();
  const market = String(req.query?.market || 'domestic').trim();

  if (!code) {
    return res.json({ dps: null, paymentMonths: [], source: 'error' });
  }

  try {
    if (market === 'overseas') {
      const result = await fetchYahooDividend(code);
      return res.json(result);
    } else {
      return res.json(await fetchDomesticDividend(code));
    }
  } catch {
    return res.json({ dps: null, paymentMonths: [], source: 'error' });
  }
}
