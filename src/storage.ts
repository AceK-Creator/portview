import CryptoJS from 'crypto-js';
import type { AppData, Profile, RootData } from './types';

const STORAGE_KEY_V1 = 'dad-portfolio-pwa:v1';
const STORAGE_KEY_V2 = 'dad-portfolio-pwa:v2';
const STORAGE_KEY_V3 = 'dad-portfolio-pwa:v3';
const STORAGE_KEY_ENC = 'dad-portfolio-pwa:v3:enc';
const SENTINEL = 'PORTVIEW::';

export function hasEncryptedData(): boolean {
  return !!localStorage.getItem(STORAGE_KEY_ENC);
}

export function saveEncrypted(data: RootData, pin: string): void {
  const json = SENTINEL + JSON.stringify(data);
  const encrypted = CryptoJS.AES.encrypt(json, pin).toString();
  localStorage.setItem(STORAGE_KEY_ENC, encrypted);
  localStorage.removeItem(STORAGE_KEY_V3);
  localStorage.removeItem(STORAGE_KEY_V2);
  localStorage.removeItem(STORAGE_KEY_V1);
}

export function loadEncrypted(pin: string): RootData | null {
  const encrypted = localStorage.getItem(STORAGE_KEY_ENC);
  if (!encrypted) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, pin);
    const decrypted = bytes.toString(CryptoJS.enc.Utf8);
    if (!decrypted.startsWith(SENTINEL)) return null;
    const parsed = JSON.parse(decrypted.slice(SENTINEL.length));
    return migrateToV3(parsed);
  } catch {
    return null;
  }
}

export const defaultData: AppData = {
  version: 1,
  password: '',
  account: { totalContribution: 0, cashBalance: 0 },
  holdings: [],
  dividends: [],
  realizedGains: [],
};

const defaultProfile: Profile = {
  id: '1',
  name: '내 계좌',
  domestic: { ...defaultData },
  overseas: { ...defaultData },
};

const defaultRootData: RootData = {
  version: 3,
  profiles: [{ ...defaultProfile }],
};

function parseAppData(raw: unknown): AppData {
  const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Partial<AppData>;
  return {
    ...defaultData,
    ...parsed,
    account: { ...defaultData.account, ...parsed.account },
    holdings: Array.isArray(parsed.holdings)
      ? parsed.holdings.map((h) => ({ ...h, quoteError: undefined }))
      : [],
    dividends: Array.isArray(parsed.dividends) ? parsed.dividends : [],
    realizedGains: Array.isArray(parsed.realizedGains) ? parsed.realizedGains : [],
    investmentStartDate: typeof parsed.investmentStartDate === 'string' ? parsed.investmentStartDate : undefined,
    monthlyDividendGoal: typeof parsed.monthlyDividendGoal === 'number' ? parsed.monthlyDividendGoal : undefined,
    dailySnapshots: Array.isArray(parsed.dailySnapshots) ? parsed.dailySnapshots : [],
    yearRecords: Array.isArray(parsed.yearRecords) ? parsed.yearRecords : [],
    weeklySnapshots: Array.isArray(parsed.weeklySnapshots) ? parsed.weeklySnapshots : [],
  };
}

function migrateToV3(raw: unknown): RootData {
  if (!raw || typeof raw !== 'object') return defaultRootData;
  const obj = raw as Record<string, unknown>;

  // 이미 v3
  if (obj.version === 3 && Array.isArray(obj.profiles)) {
    return {
      version: 3,
      profiles: (obj.profiles as Profile[]).map((p) => ({
        id: String(p.id),
        name: String(p.name),
        domestic: parseAppData(p.domestic),
        overseas: parseAppData(p.overseas),
      })),
    };
  }

  // v2 → v3 마이그레이션
  if (obj.version === 2 && obj.domestic && obj.overseas) {
    return {
      version: 3,
      profiles: [{
        id: '1',
        name: '내 계좌',
        domestic: parseAppData(obj.domestic),
        overseas: parseAppData(obj.overseas),
      }],
    };
  }

  // v1 → v3 마이그레이션
  if (Array.isArray((obj as Partial<AppData>).holdings)) {
    const domestic = parseAppData(obj);
    return {
      version: 3,
      profiles: [{
        id: '1',
        name: '내 계좌',
        domestic,
        overseas: { ...defaultData, password: domestic.password },
      }],
    };
  }

  return defaultRootData;
}

export function loadRootData(): RootData {
  // v3 우선
  const rawV3 = localStorage.getItem(STORAGE_KEY_V3);
  if (rawV3) {
    try {
      return migrateToV3(JSON.parse(rawV3));
    } catch { /* fall through */ }
  }

  // v2 마이그레이션
  const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
  if (rawV2) {
    try {
      return migrateToV3(JSON.parse(rawV2));
    } catch { /* fall through */ }
  }

  // v1 마이그레이션
  const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
  if (rawV1) {
    try {
      return migrateToV3(JSON.parse(rawV1));
    } catch { /* fall through */ }
  }

  return defaultRootData;
}

export function saveRootData(data: RootData): void {
  localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(data));
  localStorage.removeItem(STORAGE_KEY_V2);
  localStorage.removeItem(STORAGE_KEY_V1);
}

export function createBackupBlob(data: RootData): Blob {
  return new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
}

function validateAppData(data: unknown): AppData {
  const d = data as Partial<AppData>;
  return {
    version: 1,
    password: typeof d?.password === 'string' ? d.password : '',
    account: {
      totalContribution: Number(d?.account?.totalContribution) || 0,
      cashBalance: Number(d?.account?.cashBalance) || 0,
    },
    holdings: Array.isArray(d?.holdings)
      ? d.holdings.map((h) => ({
          id: String(h.id),
          code: String(h.code),
          name: String(h.name),
          shares: Number(h.shares) || 0,
          averagePrice: Number(h.averagePrice) || 0,
          currentPrice: h.currentPrice == null ? null : Number(h.currentPrice),
          change: h.change == null ? null : Number(h.change),
          changeRate: h.changeRate == null ? null : Number(h.changeRate),
          lastPriceAt: h.lastPriceAt ? String(h.lastPriceAt) : null,
          priceSource: h.priceSource ?? null,
          quoteError: h.quoteError ? String(h.quoteError) : undefined,
        }))
      : [],
    dividends: Array.isArray(d?.dividends)
      ? d.dividends.map((div) => ({
          id: String(div.id),
          stockCode: String(div.stockCode),
          stockName: String(div.stockName),
          paidAt: String(div.paidAt),
          amount: Number(div.amount) || 0,
        }))
      : [],
    realizedGains: Array.isArray(d?.realizedGains)
      ? d.realizedGains.map((r) => ({
          id: String(r.id),
          stockCode: String(r.stockCode),
          stockName: String(r.stockName),
          date: String(r.date),
          amount: Number(r.amount) || 0,
        }))
      : [],
  };
}

export function validateBackup(value: unknown): RootData {
  if (!value || typeof value !== 'object') {
    throw new Error('백업 파일 형식이 올바르지 않습니다.');
  }

  const obj = value as Record<string, unknown>;

  // v3 형식
  if (obj.version === 3 && Array.isArray(obj.profiles)) {
    return {
      version: 3,
      profiles: (obj.profiles as Profile[]).map((p, i) => ({
        id: String(p.id || i + 1),
        name: String(p.name || `프로필 ${i + 1}`),
        domestic: validateAppData(p.domestic),
        overseas: validateAppData(p.overseas),
      })),
    };
  }

  // v2 형식 (RootData) — 자동 마이그레이션
  if (obj.version === 2 && obj.domestic && obj.overseas) {
    return {
      version: 3,
      profiles: [{
        id: '1',
        name: '내 계좌',
        domestic: validateAppData(obj.domestic),
        overseas: validateAppData(obj.overseas),
      }],
    };
  }

  // v1 형식 (AppData — 구버전 백업 파일)
  if (Array.isArray(obj.holdings) && obj.account && typeof obj.password === 'string') {
    const domestic = validateAppData(value);
    return {
      version: 3,
      profiles: [{
        id: '1',
        name: '내 계좌',
        domestic,
        overseas: { ...defaultData, password: domestic.password },
      }],
    };
  }

  throw new Error('이 앱의 백업 파일이 아닙니다.');
}
