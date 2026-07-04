export type MenuKey = 'live' | 'account' | 'dividend' | 'realized-gains' | 'growth' | 'password';
export type AccountMode = 'domestic' | 'overseas';
export type CurrencyMode = 'usd' | 'krw';

export type PriceSource = 'naver-realtime' | 'naver-page' | 'naver-search' | 'test' | 'manual-seed' | 'yahoo';

export interface Holding {
  id: string;
  code: string;
  name: string;
  shares: number;
  averagePrice: number;
  currentPrice: number | null;
  change: number | null;
  changeRate: number | null;
  lastPriceAt: string | null;
  priceSource: PriceSource | null;
  quoteError?: string;
}

export interface HoldingRow extends Holding {
  investedAmount: number;
  marketValue: number;
  profitLoss: number;
  returnRate: number;
  weight: number;
}

export interface AccountInputs {
  totalContribution: number;
  cashBalance: number;
}

export interface AccountSummary {
  totalMarketValue: number;
  currentTotalAssets: number;
  cashRatio: number;
  totalProfitLoss: number;
  totalReturnRate: number;
}

export interface DividendRecord {
  id: string;
  stockCode: string;
  stockName: string;
  paidAt: string;      // YYYY-MM-DD
  amount: number;
}

export interface RealizedGainRecord {
  id: string;
  stockCode: string;
  stockName: string;
  date: string;        // YYYY-MM-DD
  amount: number;      // positive = gain, negative = loss
}

export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  totalContribution: number;
  totalAssets: number;
  returnRate: number;
  cumulativeDividend: number;
  monthlyDividend: number;
}

export interface YearRecord {
  year: number;
  date: string; // YYYY-MM-DD — 실제 스냅샷 날짜
  isManual: boolean;
  totalContribution: number;
  totalAssets: number;
  returnRate: number;
  cumulativeDividend: number;
  monthlyDividend: number;
}

export interface AppData {
  version: number;
  password: string;
  account: AccountInputs;
  holdings: Holding[];
  dividends: DividendRecord[];
  realizedGains: RealizedGainRecord[];
  investmentStartDate?: string;   // YYYY-MM-DD
  monthlyDividendGoal?: number;
  dailySnapshots?: DailySnapshot[];
  yearRecords?: YearRecord[];
}

export interface RootData {
  version: 2;
  domestic: AppData;
  overseas: AppData;
}

export interface QuoteResult {
  code: string;
  name: string;
  price: number;
  change: number | null;
  changeRate: number | null;
  source: PriceSource;
  tradedAt: string;
}
