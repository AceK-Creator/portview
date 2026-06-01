import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

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

async function quote(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) throw new Error('종목명 또는 종목코드를 입력해 주세요.');

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
    const result = await quote(req.query.query);
    res.json(result);
  } catch (error) {
    res.status(502).json({
      message: error instanceof Error ? error.message : '시세 조회에 실패했습니다.',
    });
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

app.use(express.static(DIST_DIR, { extensions: ['html'] }));
app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
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
