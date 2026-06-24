const NAVER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
  Referer: 'https://finance.naver.com/',
};

// 12개월 이내 여부 판단
function isWithin12Months(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  return d >= cutoff;
}

// etfshopping.com에서 국내 배당 정보 스크래핑
async function fetchEtfShoppingDividend(code) {
  const url = `https://etfshopping.com/etf/${encodeURIComponent(code)}`;
  const res = await fetch(url, { headers: { ...NAVER_HEADERS, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`etfshopping ${res.status}`);
  const html = await res.text();

  // 배당 테이블 파싱: 날짜 두 개, 금액
  // 패턴: 기준일(YYYY-MM-DD) | 지급일(YYYY-MM-DD) | 분배금액(숫자)
  // <td> 태그로 파싱
  const rows = [];
  // 테이블 행들 파싱: tr 단위로 추출
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];
    // td 값들 추출
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      // HTML 태그 제거 후 trim
      const text = tdMatch[1].replace(/<[^>]+>/g, '').trim();
      cells.push(text);
    }
    // 날짜 두 개와 숫자가 포함된 행 필터링
    if (cells.length >= 3) {
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const amountPattern = /^\d+$/;
      // 첫 번째 셀: 기준일, 두 번째 셀: 지급일, 세 번째 셀: 분배금액
      if (datePattern.test(cells[0]) && datePattern.test(cells[1]) && amountPattern.test(cells[2])) {
        rows.push({
          recordDate: cells[0],
          payDate: cells[1],
          amount: Number(cells[2]),
        });
      }
    }
  }

  if (rows.length === 0) throw new Error('etfshopping: 배당 데이터 없음');

  // 지난 12개월 데이터만
  const recent = rows.filter(r => isWithin12Months(r.payDate));
  const paymentMonths = [...new Set(recent.map(r => new Date(r.payDate).getMonth() + 1))].sort((a,b) => a-b);
  const dps = rows[0]?.amount ?? null; // 가장 최근 (첫 번째 행)

  return { dps, paymentMonths, source: 'etfshopping' };
}

// 네이버 금융 fallback (국내)
async function fetchNaverDividend(code) {
  const url = `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`;
  const res = await fetch(url, { headers: { ...NAVER_HEADERS, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`naver ${res.status}`);
  const html = await res.text();

  // 주당배당금 파싱 시도
  // 네이버 금융에서 배당금은 '주당배당금' 텍스트 근처에 위치
  const dpsMatch = html.match(/주당배당금[\s\S]{0,200}?(\d[\d,]+)원/);
  const dps = dpsMatch ? Number(dpsMatch[1].replace(/,/g, '')) : null;

  // 연 1회 배당으로 가정, paymentMonths는 빈 배열 반환 (추정 불가)
  return { dps, paymentMonths: [], source: 'naver-fallback' };
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
      const res = await fetch(url, { headers: YAHOO_HEADERS, signal: AbortSignal.timeout(10000) });
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
      // 국내: etfshopping 시도 → 실패 시 네이버
      try {
        const result = await fetchEtfShoppingDividend(code);
        return res.json(result);
      } catch {
        const result = await fetchNaverDividend(code);
        return res.json(result);
      }
    }
  } catch {
    return res.json({ dps: null, paymentMonths: [], source: 'error' });
  }
}
