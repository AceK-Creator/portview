const NAVER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
  Referer: 'https://finance.naver.com/',
};

const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── 국내 (네이버) ─────────────────────────────────────────────────────────────

function parsePrice(value) {
  const number = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

async function fetchNaverRealtime(code) {
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${encodeURIComponent(code)}`;
  const response = await fetch(url, { headers: NAVER_HEADERS });
  if (!response.ok) throw new Error(`네이버 실시간 응답 오류 ${response.status}`);

  const payload = await response.json();
  const item = payload?.datas?.[0];
  const price = parsePrice(item?.closePrice);
  if (!item || price == null) throw new Error('네이버 실시간 데이터가 비어 있습니다.');

  const changeRaw = parsePrice(item?.compareToPreviousClosePrice);
  const changeRateRaw =
    item?.fluctuationsRatio != null ? parseFloat(String(item.fluctuationsRatio)) : null;

  return {
    code: item.itemCode || code,
    name: item.stockName || code,
    price,
    change: Number.isFinite(changeRaw) ? changeRaw : null,
    changeRate: Number.isFinite(changeRateRaw) ? changeRateRaw : null,
    source: 'naver-realtime',
    tradedAt: item.localTradedAt || new Date().toISOString(),
  };
}

async function fetchNaverPage(code) {
  const url = `https://finance.naver.com/item/main.naver?code=${encodeURIComponent(code)}`;
  const response = await fetch(url, { headers: { ...NAVER_HEADERS, Accept: 'text/html,*/*' } });
  if (!response.ok) throw new Error(`네이버 페이지 응답 오류 ${response.status}`);

  const html = await response.text();
  const priceMatch = html.match(/<p class="no_today">[\s\S]*?<span class="blind">([^<]+)<\/span>/);
  const nameMatch = html.match(/<title>\s*([^:<]+)[\s\S]*?: 네이버페이 증권<\/title>/);
  const price = parsePrice(priceMatch?.[1]);
  if (price == null) throw new Error('네이버 페이지에서 가격을 찾지 못했습니다.');

  return {
    code,
    name: nameMatch?.[1]?.trim() || code,
    price,
    change: null,
    changeRate: null,
    source: 'naver-page',
    tradedAt: new Date().toISOString(),
  };
}

async function resolveCodeFromSearch(query) {
  const url = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(`${query} 주가`)}`;
  const response = await fetch(url, { headers: { ...NAVER_HEADERS, Accept: 'text/html,*/*' } });
  if (!response.ok) throw new Error(`네이버 검색 응답 오류 ${response.status}`);

  const html = await response.text();
  const match = html.match(/code=([0-9]{6})/);
  if (!match)
    throw new Error('종목명으로 종목코드를 찾지 못했습니다. 종목코드 6자리를 입력해 주세요.');
  return match[1];
}

const DOMESTIC_INDEX_CODES = new Set(['KOSPI', 'KOSDAQ']);

async function fetchNaverIndex(indexCode) {
  const url = `https://polling.finance.naver.com/api/realtime/domestic/index/${encodeURIComponent(indexCode)}`;
  const response = await fetch(url, { headers: NAVER_HEADERS });
  if (!response.ok) throw new Error(`지수 응답 오류 ${response.status}`);
  const payload = await response.json();
  const item = payload?.datas?.[0];
  if (!item) throw new Error('지수 데이터가 비어 있습니다.');
  const changeRaw = parseFloat(item.compareToPreviousClosePriceRaw);
  const changeRateRaw = parseFloat(item.fluctuationsRatioRaw);
  return {
    code: indexCode,
    name: item.stockName || indexCode,
    price: parseFloat(item.closePriceRaw) || 0,
    change: Number.isFinite(changeRaw) ? changeRaw : null,
    changeRate: Number.isFinite(changeRateRaw) ? changeRateRaw : null,
    source: 'naver-index',
    tradedAt: item.localTradedAt || new Date().toISOString(),
  };
}

// ─── 해외 (Yahoo Finance) ──────────────────────────────────────────────────────

const OVERSEAS_INDEX_CODES = {
  NASDAQ: { symbol: '^IXIC', displayName: 'NASDAQ' },
  SP500:  { symbol: '^GSPC', displayName: 'S&P500' },
  USDKRW: { symbol: 'KRW=X', displayName: '원/달러' },
};

async function fetchYahooQuote(ticker, displayName) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo Finance 응답 오류 ${res.status}`);

  const data = await res.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null)
    throw new Error('Yahoo Finance 데이터를 가져오지 못했습니다.');

  const price = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const change = price - prevClose;
  const changeRate = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    code: meta.symbol || ticker,
    name: displayName || meta.shortName || meta.longName || ticker,
    price,
    change,
    changeRate,
    source: 'yahoo',
    tradedAt: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : new Date().toISOString(),
  };
}

async function searchYahooTicker(query) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0`;
  const res = await fetch(url, { headers: YAHOO_HEADERS });
  if (!res.ok) throw new Error(`Yahoo Finance 검색 오류 ${res.status}`);

  const data = await res.json();
  const quote = data?.quotes?.find((q) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF');
  if (!quote?.symbol)
    throw new Error(`"${query}"에 해당하는 해외 종목을 찾지 못했습니다. 정확한 티커를 입력해 주세요.`);

  return { symbol: quote.symbol, name: quote.shortname || quote.longname || quote.symbol };
}

// ─── 핸들러 ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const query = String(req.query?.query || '').trim();
  if (!query) {
    return res.status(400).json({ message: '종목명 또는 종목코드를 입력해 주세요.' });
  }

  const market = String(req.query?.market || 'domestic').trim();

  try {
    // ── 해외 경로 ──────────────────────────────────────────────────────────────
    if (market === 'overseas') {
      const upperQuery = query.toUpperCase();

      // 해외 지수 코드 (NASDAQ, SP500, USDKRW)
      const indexEntry = OVERSEAS_INDEX_CODES[upperQuery];
      if (indexEntry) {
        return res.json(await fetchYahooQuote(indexEntry.symbol, indexEntry.displayName));
      }

      // 티커로 직접 조회 시도 → 실패 시 검색
      try {
        return res.json(await fetchYahooQuote(upperQuery));
      } catch {
        const { symbol, name } = await searchYahooTicker(query);
        const result = await fetchYahooQuote(symbol);
        return res.json({ ...result, name });
      }
    }

    // ── 국내 경로 ──────────────────────────────────────────────────────────────
    if (DOMESTIC_INDEX_CODES.has(query.toUpperCase())) {
      return res.json(await fetchNaverIndex(query.toUpperCase()));
    }

    const code = /^[0-9]{6}$/.test(query) ? query : await resolveCodeFromSearch(query);

    let result;
    try {
      result = await fetchNaverRealtime(code);
    } catch {
      result = await fetchNaverPage(code);
    }

    res.json(result);
  } catch (error) {
    res.status(502).json({
      message: error instanceof Error ? error.message : '시세 조회에 실패했습니다.',
    });
  }
}
