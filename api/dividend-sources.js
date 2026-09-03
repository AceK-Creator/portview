const HEADERS = {
  'User-Agent': 'PortView/1.0 (+https://github.com/) Mozilla/5.0',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
};

const KNOWN_OFFICIAL_URLS = {
  '473330': ['sol', 'https://www.soletf.com/ko/fund/etf/summary/211044'],
  '360750': ['tiger', 'https://investments.miraeasset.com/tigeretf/ko/product/search/detail/index.do?ksdFund=KR7360750004'],
  '483290': ['kodex', 'https://www.samsungfund.com/etf/product/view.do?id=2ETFN1'],
  '402970': ['ace', 'https://www.aceetf.co.kr/fund/K55101DN4471'],
  '475720': ['rise', 'https://www.riseetf.co.kr/prod/finderDetail/44G3?searchFlag=viewtab2'],
};

export function normalizeDate(value) {
  const match = String(value || '').match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function parsePositiveAmount(value) {
  const amount = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function textContent(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseDividendTable(html, code, source) {
  const pageText = textContent(html);
  if (!new RegExp(`(?:^|\\D)${code}(?:\\D|$)`).test(pageText)) return null;

  const rows = [];
  const rowMatches = String(html).match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rowMatches) {
    const text = textContent(row);
    const dates = [...text.matchAll(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g)].map((m) => normalizeDate(m[0]));
    if (dates.length < 2) continue;
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => textContent(match[1]));
    const dps = parsePositiveAmount(cells[2]);
    if (dps) rows.push({ recordDate: dates[0], payDate: dates[1], dps });
  }

  // Some official pages use definition lists rather than tables.
  if (!rows.length) {
    const pattern = /(20\d{2}[./-]\d{1,2}[./-]\d{1,2})[\s\S]{0,180}?(20\d{2}[./-]\d{1,2}[./-]\d{1,2})[\s\S]{0,180}?분배금액[^\d]{0,30}([\d,]+)(?:\s*원)?/gi;
    for (const match of String(html).matchAll(pattern)) {
      const dps = parsePositiveAmount(match[3]);
      if (dps) rows.push({ recordDate: normalizeDate(match[1]), payDate: normalizeDate(match[2]), dps });
    }
  }

  rows.sort((a, b) => b.recordDate.localeCompare(a.recordDate));
  const latest = rows[0];
  if (!latest?.dps || !latest.recordDate || !latest.payDate) return null;
  return {
    ...latest,
    paymentMonths: [...new Set(rows.map((row) => Number(row.payDate.slice(5, 7))))].sort((a, b) => a - b),
    source,
  };
}

export async function fetchHtml(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { headers: HEADERS, signal: globalThis.AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.text();
}

export async function fetchKnownOfficialDividend(code, fetchImpl = globalThis.fetch) {
  const entry = KNOWN_OFFICIAL_URLS[code];
  if (!entry) return null;
  const [manager, url] = entry;
  if (manager === 'kodex') {
    const productId = new globalThis.URL(url).searchParams.get('id');
    const response = await fetchImpl(`https://www.samsungfund.com/api/v1/kodex/divid-info.do?id=${encodeURIComponent(productId)}`, {
      headers: { ...HEADERS, Accept: 'application/json' },
      signal: globalThis.AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`upstream ${response.status}`);
    const rows = (await response.json())?.dividList || [];
    const latest = rows[0];
    const compactDate = (value) => /^20\d{6}$/.test(String(value))
      ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
      : null;
    const dps = parsePositiveAmount(latest?.dividA);
    if (!dps) return null;
    return {
      dps,
      recordDate: compactDate(latest.basicD),
      payDate: compactDate(latest.payD),
      paymentMonths: [...new Set(rows.map((row) => Number(String(row.payD).slice(4, 6))).filter(Boolean))].sort((a, b) => a - b),
      source: 'kodex-official',
    };
  }
  const html = await fetchHtml(url, fetchImpl);
  return parseDividendTable(html, code, `${manager}-official`);
}

export async function fetchEtfExplorerDividend(code, fetchImpl = globalThis.fetch) {
  const html = await fetchHtml(`https://etfexplorer.io/etf/${encodeURIComponent(code)}`, fetchImpl);
  return parseDividendTable(html, code, 'etf-explorer');
}

export async function fetchDomesticDividend(code, options = {}) {
  const officialFetchers = options.officialFetchers || [() => fetchKnownOfficialDividend(code)];
  for (const loader of officialFetchers) {
    try {
      const result = await loader(code);
      if (result?.dps) return result;
    } catch { /* continue to the next source */ }
  }
  try {
    const result = await (options.explorerFetcher || fetchEtfExplorerDividend)(code);
    if (result?.dps) return result;
  } catch { /* handled by empty result */ }
  return { dps: null, recordDate: null, payDate: null, paymentMonths: [], source: 'none' };
}
