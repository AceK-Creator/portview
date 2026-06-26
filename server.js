import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dividendInfoHandler from './api/dividend-info.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 18440);
const CERT = process.env.SSL_CERT || '/etc/letsencrypt/live/narnialab.duckdns.org/fullchain.pem';
const KEY = process.env.SSL_KEY || '/etc/letsencrypt/live/narnialab.duckdns.org/privkey.pem';
const ERROR_LOG = path.join(__dirname, 'browser_errors.log');
const DIST_DIR = path.join(__dirname, 'dist');

const app = express();
app.use(express.json({ limit: '64kb' }));

const headers = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
  Referer: 'https://finance.naver.com/',
};

function parsePrice(value) {
  const number = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function normalizeQuery(query) {
  return String(query || '').trim();
}

async function fetchNaverRealtime(code) {
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${encodeURIComponent(
    code,
  )}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`네이버 실시간 응답 오류 ${response.status}`);

  const payload = await response.json();
  const item = payload?.datas?.[0];
  const price = parsePrice(item?.closePrice);
  if (!item || price == null) throw new Error('네이버 실시간 데이터가 비어 있습니다.');

  const changeRaw = parsePrice(item?.compareToPreviousClosePrice);
  const changeRateRaw = item?.fluctuationsRatio != null ? parseFloat(String(item.fluctuationsRatio)) : null;

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
  const response = await fetch(url, { headers: { ...headers, Accept: 'text/html,*/*' } });
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
  const url = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(
    `${query} 주가`,
  )}`;
  const response = await fetch(url, { headers: { ...headers, Accept: 'text/html,*/*' } });
  if (!response.ok) throw new Error(`네이버 검색 응답 오류 ${response.status}`);

  const html = await response.text();
  const match = html.match(/code=([0-9]{6})/);
  if (!match) throw new Error('종목명으로 종목코드를 찾지 못했습니다. 종목코드 6자리를 입력해 주세요.');
  return match[1];
}

const DOMESTIC_INDEX_CODES = new Set(['KOSPI', 'KOSDAQ']);

// 네이버 worldstock/index reuters 코드 매핑
const OVERSEAS_INDEX_MAP = {
  NASDAQ: { reutersCode: '.IXIC', displayName: 'NASDAQ 종합' },
  SP500:  { reutersCode: '.INX',  displayName: 'S&P 500' },
};

async function fetchNaverIndex(indexCode) {
  const url = `https://polling.finance.naver.com/api/realtime/domestic/index/${encodeURIComponent(indexCode)}`;
  const response = await fetch(url, { headers });
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

async function fetchNaverWorldIndex(reutersCode, displayName) {
  const url = `https://polling.finance.naver.com/api/realtime/worldstock/index/${encodeURIComponent(reutersCode)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`해외지수 응답 오류 ${res.status}`);
  const payload = await res.json();
  const item = payload?.datas?.[0];
  if (!item) throw new Error('해외지수 데이터가 비어 있습니다.');
  const price = parseFloat(item.closePriceRaw) || 0;
  const change = parseFloat(item.compareToPreviousClosePriceRaw);
  const changeRate = parseFloat(item.fluctuationsRatioRaw);
  return {
    code: item.symbolCode || reutersCode,
    name: displayName || item.indexName || reutersCode,
    price,
    change: Number.isFinite(change) ? change : null,
    changeRate: Number.isFinite(changeRate) ? changeRate : null,
    source: 'naver-worldindex',
    tradedAt: item.localTradedAt || new Date().toISOString(),
  };
}

async function fetchUsdKrw() {
  const res = await fetch('https://api.stock.naver.com/marketindex/exchange/FX_USDKRW', {
    headers,
  });
  if (!res.ok) throw new Error(`환율 API 오류 ${res.status}`);
  const data = await res.json();
  const info = data?.exchangeInfo;
  if (!info) throw new Error('환율 데이터를 가져오지 못했습니다.');
  const price = parsePrice(info.calcPrice || info.closePrice);
  if (!price) throw new Error('환율 데이터를 가져오지 못했습니다.');
  const change = parsePrice(info.fluctuations);
  const changeRateRaw = info.fluctuationsRatio != null ? parseFloat(String(info.fluctuationsRatio)) : null;
  return {
    code: 'USDKRW',
    name: '원/달러',
    price,
    change: Number.isFinite(change) ? change : null,
    changeRate: Number.isFinite(changeRateRaw) ? changeRateRaw : null,
    source: 'naver-exchange',
    tradedAt: info.localTradedAt || new Date().toISOString(),
  };
}

async function searchNaverWorldTicker(query) {
  const url = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=worldstock`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`네이버 종목 검색 오류 ${res.status}`);
  const data = await res.json();
  const item = data?.items?.[0];
  if (!item?.reutersCode) throw new Error(`"${query}"에 해당하는 해외 종목을 찾지 못했습니다. 정확한 티커를 입력해 주세요.`);
  return { reutersCode: item.reutersCode, name: item.name };
}

async function fetchNaverWorldStock(reutersCode, displayName) {
  const url = `https://polling.finance.naver.com/api/realtime/worldstock/stock/${encodeURIComponent(reutersCode)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`해외주식 응답 오류 ${res.status}`);
  const payload = await res.json();
  const item = payload?.datas?.[0];
  if (!item) throw new Error('해외주식 데이터가 비어 있습니다.');
  const price = parseFloat(item.closePriceRaw) || 0;
  const change = parseFloat(item.compareToPreviousClosePriceRaw);
  const changeRate = parseFloat(item.fluctuationsRatioRaw);
  return {
    code: item.symbolCode || reutersCode,
    name: displayName || item.stockName || reutersCode,
    price,
    change: Number.isFinite(change) ? change : null,
    changeRate: Number.isFinite(changeRate) ? changeRate : null,
    source: 'naver-worldstock',
    tradedAt: item.localTradedAt || new Date().toISOString(),
    currency: item.currencyType?.code || 'USD',
  };
}

async function quoteOverseas(query) {
  const upperQuery = query.toUpperCase();

  // 지수
  if (OVERSEAS_INDEX_MAP[upperQuery]) {
    const { reutersCode, displayName } = OVERSEAS_INDEX_MAP[upperQuery];
    return fetchNaverWorldIndex(reutersCode, displayName);
  }

  // 환율
  if (upperQuery === 'USDKRW') {
    return fetchUsdKrw();
  }

  // 종목 - 티커에 거래소 접미사가 있으면 직접 조회, 없으면 검색
  const hasExchangeSuffix = /\.[A-Z]+$/.test(upperQuery);
  if (hasExchangeSuffix) {
    return fetchNaverWorldStock(upperQuery);
  }

  // 검색 후 조회 (TSLA → TSLA.O 등)
  try {
    // NASDAQ 종목은 .O suffix가 일반적
    return await fetchNaverWorldStock(`${upperQuery}.O`);
  } catch {
    const { reutersCode, name } = await searchNaverWorldTicker(query);
    return fetchNaverWorldStock(reutersCode, name);
  }
}

async function quoteDomestic(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) throw new Error('종목명 또는 종목코드를 입력해 주세요.');

  if (DOMESTIC_INDEX_CODES.has(normalized.toUpperCase())) {
    return fetchNaverIndex(normalized.toUpperCase());
  }

  const code = /^[0-9]{6}$/.test(normalized)
    ? normalized
    : await resolveCodeFromSearch(normalized);

  try {
    return await fetchNaverRealtime(code);
  } catch {
    return fetchNaverPage(code);
  }
}

app.get('/api/quote', async (req, res) => {
  try {
    const query = normalizeQuery(req.query.query);
    if (!query) return res.status(400).json({ message: '종목명 또는 종목코드를 입력해 주세요.' });

    const market = String(req.query.market || 'domestic').trim();
    const result = market === 'overseas'
      ? await quoteOverseas(query)
      : await quoteDomestic(query);

    res.json(result);
  } catch (error) {
    res.status(502).json({
      message: error instanceof Error ? error.message : '시세 조회에 실패했습니다.',
    });
  }
});

app.get('/api/dividend-info', async (req, res) => {
  try {
    await dividendInfoHandler(req, res);
  } catch (e) {
    res.status(502).json({ message: e instanceof Error ? e.message : '배당 정보 조회 실패' });
  }
});

app.post('/api/client-error', (req, res) => {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    ip: req.ip,
    body: req.body,
  });
  fs.appendFile(ERROR_LOG, `${line}\n`, () => undefined);
  res.status(204).end();
});

app.use(express.static(DIST_DIR));
app.use('/portview', express.static(DIST_DIR, { extensions: ['html'] }));
app.get('/portview/*', (_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});
app.get('/', (_req, res) => {
  res.redirect('/portview/');
});

if (!fs.existsSync(DIST_DIR)) {
  console.error('dist 폴더가 없습니다. npm run build를 먼저 실행하세요.');
  process.exit(1);
}

https
  .createServer(
    {
      cert: fs.readFileSync(CERT),
      key: fs.readFileSync(KEY),
    },
    app,
  )
  .listen(PORT, '0.0.0.0', () => {
    console.log(`HTTPS server running at https://narnialab.duckdns.org:${PORT}`);
  });
