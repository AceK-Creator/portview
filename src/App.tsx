import {
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Filter,
  KeyRound,
  Lock,
  LogOut,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { FormEvent, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fetchQuote, fetchMarketIndex, fetchOverseasIndex, logClientError, type MarketIndexItem, type OverseasIndexResult } from './api';
import { calculateAccountSummary, calculateHoldingRows } from './portfolioMath';
import {
  createBackupBlob,
  defaultData,
  loadRootData,
  saveRootData,
  validateBackup,
} from './storage';
import type { AccountMode, AppData, CurrencyMode, DividendRecord, Holding, HoldingRow, MenuKey, QuoteResult, RealizedGainRecord, RootData } from './types';

// ─── 통화 컨텍스트 ─────────────────────────────────────────────────────────────

interface CurrencyCtxType {
  isOverseas: boolean;
  currencyMode: CurrencyMode;
  usdKrwRate: number | null;
}

const CurrencyCtx = createContext<CurrencyCtxType>({
  isOverseas: false,
  currencyMode: 'usd',
  usdKrwRate: null,
});

function useCurrency() {
  const { isOverseas, currencyMode, usdKrwRate } = useContext(CurrencyCtx);

  const c = (value: number | null | undefined): string => {
    if (value == null || Number.isNaN(value)) return '-';
    if (!isOverseas) return `${Math.round(value).toLocaleString('ko-KR')}원`;
    if (currencyMode === 'usd') {
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (usdKrwRate == null) return `$${value.toFixed(2)}`;
    return `${Math.round(value * usdKrwRate).toLocaleString('ko-KR')}원`;
  };

  const sc = (value: number): string => {
    if (Number.isNaN(value)) return '-';
    if (!isOverseas) {
      return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString('ko-KR')}원`;
    }
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (currencyMode === 'usd') {
      return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (usdKrwRate == null) return `${sign}$${abs.toFixed(2)}`;
    return `${sign}${Math.round(abs * usdKrwRate).toLocaleString('ko-KR')}원`;
  };

  return { c, sc, isOverseas, currencyMode, usdKrwRate };
}

// ─── Smart Popup Position Hook ───────────────────────────────────────────────

type SmartPopupPlacement = 'bottom' | 'top';

interface SmartPopupOptions {
  gap?: number;
  minWidth?: number;
  margin?: number;
}

function useSmartPopup(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  options: SmartPopupOptions = {},
) {
  const { gap = 6, minWidth = 180, margin = 8 } = options;
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden' });
  const [arrowX, setArrowX] = useState(16);
  const [placement, setPlacement] = useState<SmartPopupPlacement>('bottom');

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPopupStyle({ position: 'fixed', visibility: 'hidden' });
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;

    // 상/하 배치 결정
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;
    const place: SmartPopupPlacement = spaceBelow >= 100 || spaceBelow >= spaceAbove ? 'bottom' : 'top';

    // 수직 위치
    const vertStyle: React.CSSProperties =
      place === 'bottom'
        ? { top: rect.bottom + gap }
        : { bottom: vh - rect.top + gap };

    // 수평 위치: 버튼 중앙 기준, 뷰포트 경계에서 clamp
    let left = rect.left + rect.width / 2 - minWidth / 2;
    if (left + minWidth > vw - margin) left = vw - minWidth - margin;
    if (left < margin) left = margin;

    // 화살표 위치: 버튼 중앙이 팝업 내에서 어느 x 위치인지
    const rawArrow = rect.left + rect.width / 2 - left;
    const clampedArrow = Math.max(12, Math.min(minWidth - 12, rawArrow));

    setPopupStyle({ position: 'fixed', left, ...vertStyle, zIndex: 200 });
    setArrowX(clampedArrow);
    setPlacement(place);
  }, [open, anchorRef, gap, minWidth, margin]);

  // 스크롤/리사이즈 시 팝업 닫기용 cleanup effect (호출 측에서 onClose 전달)
  return { popupStyle, arrowX, placement };
}

// ─── Custom Confirm Dialog ────────────────────────────────────────────────────

let _confirmResolve: ((v: boolean) => void) | null = null;
let _setConfirmMsg: ((msg: string | null) => void) | null = null;

function customConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    _setConfirmMsg?.(message);
  });
}

function ConfirmDialog() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    _setConfirmMsg = setMsg;
    return () => { _setConfirmMsg = null; };
  }, []);
  if (!msg) return null;
  const handle = (result: boolean) => {
    _confirmResolve?.(result);
    _confirmResolve = null;
    setMsg(null);
  };
  return (
    <div className="modal-backdrop" onClick={() => handle(false)}>
      <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
        <p className="confirm-msg">{msg}</p>
        <div className="confirm-actions">
          <button className="primary-button compact" type="button" onClick={() => handle(true)}>확인</button>
          <button className="ghost-button compact" type="button" onClick={() => handle(false)}>취소</button>
        </div>
      </div>
    </div>
  );
}

type HoldingDraft = {
  id?: string;
  query: string;
  shares: string;
  averagePrice: string;
};

type TabKey = 'live' | 'account' | 'dividend' | 'realized-gains';

const TAB_ITEMS: { key: TabKey; label: string }[] = [
  { key: 'live', label: '잔고' },
  { key: 'account', label: '자산' },
  { key: 'dividend', label: '배당' },
  { key: 'realized-gains', label: '손익' },
];

// ─── Particle Background ──────────────────────────────────────────────────────

function ptColor(t: number, alpha: number): string {
  const r = Math.round(160 + (0 - 160) * t);
  const g = Math.round(50 + (220 - 50) * t);
  const b = Math.round(255 + (255 - 255) * t);
  return `rgba(${r},${g},${b},${alpha})`;
}

function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0, h = 0;
    const resize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const COUNT = window.innerWidth < 600 ? 26 : 42;
    const MAX_D = 148;

    const pts = Array.from({ length: COUNT }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.42,
      vy: (Math.random() - 0.5) * 0.42,
      t: Math.random(),
    }));

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);

      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
        if (p.x > w) { p.x = w; p.vx = -Math.abs(p.vx); }
        if (p.y < 0) { p.y = 0; p.vy = Math.abs(p.vy); }
        if (p.y > h) { p.y = h; p.vy = -Math.abs(p.vy); }
      }

      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          if (dx * dx + dy * dy > MAX_D * MAX_D) continue;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const prog = 1 - dist / MAX_D;
          const alpha = Math.pow(prog, 1.5) * 0.48;

          const grad = ctx.createLinearGradient(pts[i].x, pts[i].y, pts[j].x, pts[j].y);
          grad.addColorStop(0, ptColor(pts[i].t, alpha));
          grad.addColorStop(1, ptColor(pts[j].t, alpha));

          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.1;
          ctx.stroke();
        }
      }

      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = ptColor(p.t, 0.88);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="particle-canvas" />;
}

// ──────────────────────────────────────────────────────────────────────────────


function currency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function numberText(value: number | null | undefined, unit = ''): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value.toLocaleString('ko-KR')}${unit}`;
}

function percent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function plainPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return `${value.toFixed(2)}%`;
}

function signedCurrency(value: number): string {
  return `${value > 0 ? '+' : ''}${currency(value)}`;
}

function tone(value: number): 'gain' | 'loss' | 'flat' {
  if (value > 0) return 'gain';
  if (value < 0) return 'loss';
  return 'flat';
}

function nowStamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}`;
}

function createHoldingFromQuote(quote: QuoteResult, draft: HoldingDraft): Holding {
  return {
    id: draft.id ?? crypto.randomUUID(),
    code: quote.code,
    name: quote.name,
    shares: Number(draft.shares),
    averagePrice: Number(draft.averagePrice),
    currentPrice: quote.price,
    change: quote.change,
    changeRate: quote.changeRate,
    lastPriceAt: quote.tradedAt,
    priceSource: quote.source,
  };
}

function LoginScreen({
  password,
  onSuccess,
}: {
  password: string;
  onSuccess: () => void;
}) {
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardOffset(kb > 50 ? kb : 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (shake) return;
    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
    setPin(val);
    if (val.length === 4) {
      if (val === password) {
        onSuccess();
      } else {
        setShake(true);
        setTimeout(() => {
          setPin('');
          setShake(false);
          inputRef.current?.focus();
        }, 650);
      }
    }
  };

  return (
    <main className="login-screen" onClick={() => inputRef.current?.focus()}>
      <div
        className="login-panel"
        style={{ transform: keyboardOffset > 0 ? `translateY(-${Math.min(keyboardOffset * 0.5, 120)}px)` : undefined, transition: 'transform 300ms ease' }}
      >
        <div className="login-mark">
          <img src={`${import.meta.env.BASE_URL}portview-icon-nobg.png`} alt="PortView" className="login-icon" />
        </div>
        <h1>PortView</h1>
        <p>Enter your 4-digit PIN to continue.</p>
        <div
          className={`pin-dots${shake ? ' shake' : ''}`}
          onClick={() => inputRef.current?.focus()}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`pin-dot${pin.length > i ? ' filled' : ''}${shake ? ' error' : ''}`}
            />
          ))}
        </div>
        <input
          ref={inputRef}
          aria-label="비밀번호"
          autoComplete="current-password"
          autoFocus
          inputMode="numeric"
          maxLength={4}
          pattern="[0-9]*"
          type="password"
          value={pin}
          onChange={handleChange}
          className="pin-hidden-input"
        />
      </div>
    </main>
  );
}

function AppHeader({
  activeMenu,
  onChangeMenu,
  onLogout,
  secretMode,
  onToggleSecret,
  onExportBackup,
  onImportBackup,
  accountMode,
  onChangeAccount,
  currencyMode,
  onToggleCurrency,
}: {
  activeMenu: MenuKey;
  onChangeMenu: (menu: MenuKey) => void;
  onLogout: () => void;
  secretMode: boolean;
  onToggleSecret: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  accountMode: AccountMode;
  onChangeAccount: (mode: AccountMode) => void;
  currencyMode: CurrencyMode;
  onToggleCurrency: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <header className="app-header">
      {/* 계좌 스위처 행 */}
      <div className="account-switcher-row">
        <div className="account-pills">
          <button
            className={`account-pill${accountMode === 'domestic' ? ' active' : ''}`}
            type="button"
            onClick={() => onChangeAccount('domestic')}
          >
            🇰🇷 국내
          </button>
          <button
            className={`account-pill${accountMode === 'overseas' ? ' active' : ''}`}
            type="button"
            onClick={() => onChangeAccount('overseas')}
          >
            🌍 해외
          </button>
        </div>
        {accountMode === 'overseas' && (
          <button
            className={`currency-toggle-btn${currencyMode === 'krw' ? ' krw' : ''}`}
            type="button"
            onClick={onToggleCurrency}
          >
            {currencyMode === 'usd' ? '$ USD' : '₩ KRW'}
          </button>
        )}
      </div>
      {/* 탭 + 메뉴 행 */}
      <div className="tabs-row">
        <nav className="nav-tabs">
          {TAB_ITEMS.map((tab, i) => (
            <div key={tab.key} className="nav-tab-item">
              {i > 0 && <div className="tab-divider" />}
              <button
                className={`nav-tab${activeMenu === tab.key ? ' active' : ''}`}
                type="button"
                onClick={() => onChangeMenu(tab.key)}
              >
                {tab.label}
              </button>
            </div>
          ))}
        </nav>
        <div className="menu-wrap" ref={menuRef}>
          <button
            aria-expanded={open}
            aria-label="메뉴"
            className="menu-dots-btn"
            type="button"
            onClick={() => setOpen((v) => !v)}
          >
            <MoreVertical size={20} />
          </button>
          {open && (
            <nav className="dropdown-menu">
              <button
                type="button"
                className="menu-util-btn"
                onClick={() => { onExportBackup(); setOpen(false); }}
              >
                <Download size={15} />
                백업 (국내+해외)
              </button>
              <button
                type="button"
                className="menu-util-btn"
                onClick={() => { onImportBackup(); setOpen(false); }}
              >
                <Upload size={15} />
                복원
              </button>
              <div className="dropdown-divider" />
              <button
                type="button"
                className="menu-util-btn"
                onClick={() => { onChangeMenu('password'); setOpen(false); }}
              >
                <KeyRound size={15} />
                비밀번호 변경
              </button>
              <button
                className={`menu-secret-btn${secretMode ? ' active' : ''}`}
                type="button"
                onClick={() => { onToggleSecret(); setOpen(false); }}
              >
                {secretMode ? <Eye size={15} /> : <EyeOff size={15} />}
                {secretMode ? '시크릿 해제' : '시크릿 모드'}
              </button>
              <button
                className="menu-logout-btn"
                type="button"
                onClick={() => { setOpen(false); onLogout(); }}
              >
                <LogOut size={15} />
                로그아웃
              </button>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}

function MarketIndexBar({
  mode,
  onUsdKrwRate,
}: {
  mode: AccountMode;
  onUsdKrwRate?: (rate: number) => void;
}) {
  const [kospi, setKospi] = useState<MarketIndexItem | null>(null);
  const [kosdaq, setKosdaq] = useState<MarketIndexItem | null>(null);
  const [overseas, setOverseas] = useState<OverseasIndexResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);

    if (mode === 'domestic') {
      fetchMarketIndex()
        .then(({ kospi, kosdaq }) => { setKospi(kospi); setKosdaq(kosdaq); })
        .catch((err) => {
          setError(true);
          logClientError({ context: 'MarketIndexBar/domestic', message: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => setLoading(false));
    } else {
      fetchOverseasIndex()
        .then((result) => {
          setOverseas(result);
          if (onUsdKrwRate && result.usdKrw?.price) onUsdKrwRate(result.usdKrw.price);
        })
        .catch((err) => {
          setError(true);
          logClientError({ context: 'MarketIndexBar/overseas', message: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => setLoading(false));
    }
  }, [mode]);

  const fmt = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtRate = (n: number) => `${Math.abs(n).toFixed(2)}%`;

  function IndexRow({ item }: { item: MarketIndexItem }) {
    const chg = item.change ?? 0;
    const rate = item.changeRate ?? 0;
    const up = chg > 0;
    const down = chg < 0;
    const tone = up ? 'idx-up' : down ? 'idx-down' : '';
    const arrow = up ? '▲' : down ? '▼' : '–';
    return (
      <div className="market-index-row">
        <span className="idx-name">{item.name}</span>
        <span className={`idx-price ${tone}`}>{item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span className={`idx-change ${tone}`}>{arrow} {fmt(chg)}</span>
        <span className={`idx-rate ${tone}`}>{fmtRate(rate)}</span>
      </div>
    );
  }

  return (
    <div className="market-index-bar">
      {loading ? (
        <div className="idx-loading">지수 로딩 중…</div>
      ) : error ? (
        <div className="idx-loading">지수 조회 실패</div>
      ) : mode === 'domestic' && kospi && kosdaq ? (
        <>
          <IndexRow item={kospi} />
          <div className="idx-divider" />
          <IndexRow item={kosdaq} />
        </>
      ) : mode === 'overseas' && overseas ? (
        <>
          <IndexRow item={overseas.nasdaq} />
          <div className="idx-divider" />
          <IndexRow item={overseas.sp500} />
          <div className="idx-divider" />
          <IndexRow item={overseas.usdKrw} />
        </>
      ) : null}
    </div>
  );
}

function LiveSummary({ rows }: { rows: HoldingRow[] }) {
  const { c, sc } = useCurrency();
  const totalInvested = rows.reduce((s, r) => s + (r.investedAmount ?? 0), 0);
  const totalProfitLoss = rows.reduce((s, r) => s + (r.profitLoss ?? 0), 0);
  const totalMarketValue = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0);
  const totalReturnRate = totalInvested > 0 ? (totalProfitLoss / totalInvested) * 100 : 0;

  if (rows.length === 0) return null;

  return (
    <section className="live-summary">
      <div className="live-summary-row">
        <div className="live-summary-item">
          <span className="live-summary-label">매입금액</span>
          <span className="live-summary-value"><span className="secret-value">{c(totalInvested)}</span></span>
        </div>
        <div className="live-summary-item">
          <span className="live-summary-label">평가손익</span>
          <span className={`live-summary-value ${tone(totalProfitLoss)}`}><span className="secret-value">{sc(totalProfitLoss)}</span></span>
        </div>
      </div>
      <div className="live-summary-row">
        <div className="live-summary-item">
          <span className="live-summary-label">평가금액</span>
          <span className="live-summary-value"><span className="secret-value">{c(totalMarketValue)}</span></span>
        </div>
        <div className="live-summary-item">
          <span className="live-summary-label">수익률</span>
          <span className={`live-summary-value ${tone(totalReturnRate)}`}><span className="secret-value">{percent(totalReturnRate)}</span></span>
        </div>
      </div>
    </section>
  );
}

function HoldingTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: HoldingRow[];
  onEdit: (row: HoldingRow) => void;
  onDelete: (row: HoldingRow) => void;
}) {
  const { c, sc } = useCurrency();

  if (rows.length === 0) {
    return (
      <section className="empty-state">
        <EyeOff size={30} />
        <strong>보유종목이 없습니다.</strong>
        <p>상단의 종목 추가 버튼으로 첫 종목을 등록하세요.</p>
      </section>
    );
  }

  return (
    <section className="holdings-shell" aria-label="보유종목 표">
      <div className="holdings-table">
        <div className="table-header">
          <div className="name-heading">종목명</div>
          <div className="metrics-grid">
            <div>잔고수량</div>
            <div>매입가</div>
            <div>평가손익</div>
            <div>매입금액</div>
            <div>대비</div>
            <div>보유비중</div>
            <div>현재가</div>
            <div>수익률</div>
            <div>평가금액</div>
            <div>등락률</div>
          </div>
          <div className="action-heading">관리</div>
        </div>
        {rows.map((row) => (
          <article className="holding-row" key={row.id}>
            <div className="holding-name">
              <strong>{row.name}</strong>
              {row.quoteError && <em>{row.quoteError}</em>}
            </div>
            <div className="metrics-grid">
              <div><span className="secret-value">{numberText(row.shares, '주')}</span></div>
              <div><span className="secret-value">{c(row.averagePrice)}</span></div>
              <div className={tone(row.profitLoss)}><span className="secret-value">{sc(row.profitLoss)}</span></div>
              <div><span className="secret-value">{c(row.investedAmount)}</span></div>
              <div className={row.change != null ? tone(row.change) : ''}>{row.change != null ? sc(row.change) : '-'}</div>
              <div><span className="secret-value">{plainPercent(row.weight)}</span></div>
              <div>{c(row.currentPrice)}</div>
              <div className={tone(row.returnRate)}><span className="secret-value">{percent(row.returnRate)}</span></div>
              <div><span className="secret-value">{c(row.marketValue)}</span></div>
              <div className={row.changeRate != null ? tone(row.changeRate) : ''}>{row.changeRate != null ? percent(row.changeRate) : '-'}</div>
            </div>
            <div className="row-actions">
              <button aria-label={`${row.name} 수정`} type="button" onClick={() => onEdit(row)}>
                <Pencil size={16} />
              </button>
              <button aria-label={`${row.name} 삭제`} type="button" onClick={() => onDelete(row)}>
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HoldingModal({
  draft,
  busy,
  onClose,
  onSubmit,
}: {
  draft: HoldingDraft | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (draft: HoldingDraft) => Promise<void>;
}) {
  const { isOverseas } = useCurrency();
  const [form, setForm] = useState<HoldingDraft>(
    draft ?? { query: '', shares: '', averagePrice: '' },
  );

  useEffect(() => {
    setForm(draft ?? { query: '', shares: '', averagePrice: '' });
  }, [draft]);

  if (!draft) return null;

  const editing = Boolean(draft.id);

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(form);
        }}
      >
        <div className="modal-title">
          <strong>{editing ? '종목 수정' : '종목 추가'}</strong>
          <button aria-label="닫기" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label>
          {isOverseas ? '티커 심볼 또는 종목명' : '종목명 또는 종목코드'}
          <input
            required
            placeholder={isOverseas ? '예: AAPL 또는 Apple' : '예: 005930 또는 삼성전자'}
            value={form.query}
            onChange={(event) => setForm((value) => ({ ...value, query: event.target.value }))}
          />
        </label>
        <label>
          주식수
          <input
            required
            inputMode="decimal"
            min="0"
            step="0.0001"
            type="number"
            value={form.shares}
            onChange={(event) => setForm((value) => ({ ...value, shares: event.target.value }))}
          />
        </label>
        <label>
          {isOverseas ? '매입가 (USD)' : '매입가'}
          <input
            required
            inputMode="decimal"
            min="0"
            step={isOverseas ? '0.01' : '1'}
            type="number"
            value={form.averagePrice}
            onChange={(event) =>
              setForm((value) => ({ ...value, averagePrice: event.target.value }))
            }
          />
        </label>
        <button className="primary-button" disabled={busy} type="submit">
          <Save size={17} />
          {busy ? '확인 중' : editing ? '수정 저장' : '추가'}
        </button>
      </form>
    </div>
  );
}

function LiveView({
  data,
  rows,
  onDataChange,
}: {
  data: AppData;
  rows: HoldingRow[];
  onDataChange: (data: AppData) => void;
}) {
  const [draft, setDraft] = useState<HoldingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [showLiveCsvGuide, setShowLiveCsvGuide] = useState(false);
  const [liveCsvRows, setLiveCsvRows] = useState<LiveCsvRow[] | null>(null);
  const liveCsvInputRef = useRef<HTMLInputElement>(null);
  const [cooldown, setCooldown] = useState(false);
  const [cooldownFill, setCooldownFill] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const COOLDOWN_MS = 3_000;

  useEffect(() => {
    return () => { if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const startCooldown = () => {
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    setCooldown(true);
    setCooldownFill(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setCooldownFill(true));
    });
    cooldownTimerRef.current = setTimeout(() => {
      cooldownTimerRef.current = null;
      setCooldown(false);
      setCooldownFill(false);
    }, COOLDOWN_MS);
  };

  const saveHoldings = (holdings: Holding[]) => onDataChange({ ...data, holdings });

  const handleLiveCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) return;
      const startIdx = /^\d/.test(lines[0].split(',')[0].trim()) ? 0 : 1;
      const parsed: LiveCsvRow[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 3) continue;
        const code = cols[0].trim();
        const shares = Number(cols[1].trim().replace(/[^0-9]/g, ''));
        const averagePrice = Number(cols[2].trim().replace(/[^0-9.]/g, ''));
        if (!code || !shares || !averagePrice) continue;
        parsed.push({ code, shares, averagePrice });
      }
      if (parsed.length > 0) setLiveCsvRows(parsed);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const { isOverseas } = useCurrency();
  const market: AccountMode = isOverseas ? 'overseas' : 'domestic';

  const submitHolding = async (nextDraft: HoldingDraft) => {
    if (Number(nextDraft.shares) <= 0 || Number(nextDraft.averagePrice) <= 0) {
      alert('주식수와 매입가는 0보다 커야 합니다.');
      return;
    }

    const ok = await customConfirm(
      nextDraft.id ? '변경사항을 저장할까요?' : '이 종목을 포트폴리오에 추가할까요?',
    );
    if (!ok) return;

    setBusy(true);
    try {
      const quote = await fetchQuote(nextDraft.query.trim(), market);
      const nextHolding = createHoldingFromQuote(quote, nextDraft);
      const holdings = nextDraft.id
        ? data.holdings.map((holding) => (holding.id === nextDraft.id ? nextHolding : holding))
        : [...data.holdings, nextHolding];
      saveHoldings(holdings);
      setDraft(null);
      setNotice(`${quote.name} 시세를 반영했습니다.`);
    } catch (error) {
      alert(error instanceof Error ? error.message : '종목을 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const refreshQuotes = async () => {
    if (data.holdings.length === 0) return;
    setRefreshing(true);
    const refreshed = await Promise.all(
      data.holdings.map(async (holding) => {
        try {
          const quote = await fetchQuote(holding.code, market);
          return {
            ...holding,
            name: quote.name || holding.name,
            currentPrice: quote.price,
            change: quote.change,
            changeRate: quote.changeRate,
            lastPriceAt: quote.tradedAt,
            priceSource: quote.source,
            quoteError: undefined,
          };
        } catch (error) {
          return {
            ...holding,
            quoteError: error instanceof Error ? error.message : '시세 조회 실패',
          };
        }
      }),
    );
    saveHoldings(refreshed);
    setRefreshing(false);
    startCooldown();
  };

  return (
    <div className="live-view">
      <section className="toolbar">
        <button className="primary-button" type="button" onClick={() => setDraft({ query: '', shares: '', averagePrice: '' })}>
          <Plus size={17} />
          종목 추가
        </button>
        <button
          className="ghost-button icon-btn"
          disabled={refreshing || cooldown || rows.length === 0}
          type="button"
          aria-label="시세 새로고침"
          onClick={refreshQuotes}
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          {cooldown && <span className="cooldown-fill" style={{ width: cooldownFill ? '100%' : '0%', transition: `width ${COOLDOWN_MS}ms linear` }} />}
          <span className="cooldown-content">
            <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
          </span>
        </button>
        <button className="ghost-button icon-btn" type="button" aria-label="CSV 파일 업로드" onClick={() => setShowLiveCsvGuide(true)}>
          <Upload size={17} />
        </button>
        <input ref={liveCsvInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleLiveCsvFile} />
      </section>
      {notice && <p className="notice">{notice}</p>}
      <LiveSummary rows={rows} />
      <HoldingTable
        rows={rows}
        onEdit={(row) =>
          setDraft({
            id: row.id,
            query: row.code,
            shares: String(row.shares),
            averagePrice: String(row.averagePrice),
          })
        }
        onDelete={async (row) => {
          if (!await customConfirm(`${row.name} 종목을 삭제할까요?`)) return;
          saveHoldings(data.holdings.filter((holding) => holding.id !== row.id));
        }}
      />
      <HoldingModal
        busy={busy}
        draft={draft}
        onClose={() => setDraft(null)}
        onSubmit={submitHolding}
      />
      {showLiveCsvGuide && (
        <CsvGuideModal
          columns={[
            { name: '종목코드', desc: '6자리 숫자' },
            { name: '주식수', desc: '보유 수량 (정수)' },
            { name: '매입가', desc: '평균 매입 단가 (원)' },
          ]}
          sample={'005930,10,75000\n000660,5,120000'}
          note={<>헤더 행은 있어도 없어도 됩니다. 기존 종목에 추가로 업로드됩니다.<br /><span style={{ color: '#ffe082' }}>엑셀 사용 시 A열/B열/C열에 값 입력 후 반드시 CSV 형식(.csv)으로 저장하세요.</span></>}
          onClose={() => setShowLiveCsvGuide(false)}
          onSelectFile={() => liveCsvInputRef.current?.click()}
        />
      )}
      {liveCsvRows && (
        <LiveHoldingCsvPreviewModal
          rows={liveCsvRows}
          onConfirm={(holdings) => {
            saveHoldings([...data.holdings, ...holdings]);
            setLiveCsvRows(null);
          }}
          onClose={() => setLiveCsvRows(null)}
        />
      )}
    </div>
  );
}

const formatNumberWithCommas = (val: string | number) => {
  if (val === undefined || val === null || val === '') return '';
  const numStr = String(val).replace(/[^0-9]/g, '');
  if (!numStr) return '';
  return Number(numStr).toLocaleString('ko-KR');
};

const parseNumberFromCommas = (val: string) => {
  return Number(val.replace(/,/g, '')) || 0;
};

function AccountView({
  data,
  summary,
  onDataChange,
}: {
  data: AppData;
  summary: ReturnType<typeof calculateAccountSummary>;
  onDataChange: (data: AppData) => void;
}) {
  const { c, sc, isOverseas } = useCurrency();
  const [totalContribution, setTotalContribution] = useState(formatNumberWithCommas(data.account.totalContribution || ''));
  const [cashBalance, setCashBalance] = useState(formatNumberWithCommas(data.account.cashBalance || ''));

  useEffect(() => {
    setTotalContribution(formatNumberWithCommas(data.account.totalContribution || ''));
    setCashBalance(formatNumberWithCommas(data.account.cashBalance || ''));
  }, [data.account.cashBalance, data.account.totalContribution]);

  const save = async () => {
    if (!await customConfirm('계좌 입력값을 저장할까요?')) return;
    onDataChange({
      ...data,
      account: {
        totalContribution: parseNumberFromCommas(totalContribution),
        cashBalance: parseNumberFromCommas(cashBalance),
      },
    });
  };

  return (
    <section className="account-panel">
      <div className="account-metrics">
        <Metric label="자산평가액" value={c(summary.currentTotalAssets)} secret highlight />
        <div className="account-metrics-divider" />
        <div className="account-metrics-grid">
          <Metric label={isOverseas ? '예수금(₩)' : '예수금'} value={currency(data.account.cashBalance)} secret right />
          <Metric label="예수금비중" value={plainPercent(summary.cashRatio)} secret right />
          <Metric label="수익" value={sc(summary.totalProfitLoss)} tone={tone(summary.totalProfitLoss)} secret right />
          <Metric label="수익률" value={percent(summary.totalReturnRate)} tone={tone(summary.totalReturnRate)} secret right />
        </div>
      </div>
      <div className="input-grid">
        <label>
          {isOverseas ? '총투입금액 (USD)' : '총투입금액'}
          <input
            className="secret-value"
            inputMode="decimal"
            type="text"
            value={totalContribution}
            onChange={(event) => setTotalContribution(formatNumberWithCommas(event.target.value))}
          />
        </label>
        <label>
          {isOverseas ? '예수금 (₩원화)' : '예수금'}
          <input
            className="secret-value"
            inputMode="numeric"
            type="text"
            value={cashBalance}
            onChange={(event) => setCashBalance(formatNumberWithCommas(event.target.value))}
          />
        </label>
        <button className="primary-button" type="button" onClick={save}>
          <Save size={17} />
          저장
        </button>
      </div>
    </section>
  );
}

function Metric({ label, value, tone: metricTone, secret, highlight, right }: { label: string; value: string; tone?: string; secret?: boolean; highlight?: boolean; right?: boolean }) {
  const cls = [metricTone, highlight ? 'metric-highlight' : ''].filter(Boolean).join(' ');
  return (
    <div className={`metric${right ? ' metric-right' : ''}`}>
      <span>{label}</span>
      <strong className={cls}>
        {secret ? <span className="secret-value">{value}</span> : value}
      </strong>
    </div>
  );
}

function PasswordView({
  data,
  onDataChange,
}: {
  data: AppData;
  onDataChange: (data: AppData) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const cleanPin = (value: string) => value.replace(/\D/g, '').slice(0, 4);

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (current !== data.password) {
      alert('현재 비밀번호가 맞지 않습니다.');
      return;
    }
    if (next.length !== 4 || next !== confirmPin) {
      alert('새 비밀번호 4자리를 동일하게 입력하세요.');
      return;
    }
    if (!await customConfirm('비밀번호를 변경할까요?')) return;
    onDataChange({ ...data, password: next });
    setCurrent('');
    setNext('');
    setConfirmPin('');
    alert('비밀번호가 변경되었습니다.');
  };

  return (
    <form className="password-panel" onSubmit={savePassword}>
      <label>
        현재 비밀번호
        <input
          required
          inputMode="numeric"
          maxLength={4}
          type="password"
          value={current}
          onChange={(event) => setCurrent(cleanPin(event.target.value))}
        />
      </label>
      <label>
        새 비밀번호
        <input
          required
          inputMode="numeric"
          maxLength={4}
          type="password"
          value={next}
          onChange={(event) => setNext(cleanPin(event.target.value))}
        />
      </label>
      <label>
        새 비밀번호 확인
        <input
          required
          inputMode="numeric"
          maxLength={4}
          type="password"
          value={confirmPin}
          onChange={(event) => setConfirmPin(cleanPin(event.target.value))}
        />
      </label>
      <button className="primary-button" type="submit">
        <Save size={17} />
        변경 저장
      </button>
    </form>
  );
}

// ─── Realized Gain Add Modal ──────────────────────────────────────────────────

function RealizedGainAddModal({
  holdings,
  onClose,
  onSave,
}: {
  holdings: Holding[];
  onClose: () => void;
  onSave: (record: RealizedGainRecord) => void;
}) {
  const { isOverseas } = useCurrency();
  const market: AccountMode = isOverseas ? 'overseas' : 'domestic';
  const today = new Date().toISOString().slice(0, 10);
  const [stockInput, setStockInput] = useState('');
  const [stockCode, setStockCode] = useState('');
  const [stockName, setStockName] = useState('');
  const [date, setDate] = useState(today);
  const [amountStr, setAmountStr] = useState('');
  const [gainType, setGainType] = useState<'gain' | 'loss'>('gain');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedFromDropdown, setSelectedFromDropdown] = useState(false);
  const [busy, setBusy] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const filtered = holdings.filter(
    (h) => h.name.includes(stockInput) || h.code.includes(stockInput),
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectHolding = (h: Holding) => {
    setStockInput(h.name);
    setStockCode(h.code);
    setStockName(h.name);
    setShowDropdown(false);
    setSelectedFromDropdown(true);
  };

  const handleStockChange = (val: string) => {
    setStockInput(val);
    setStockCode('');
    setStockName('');
    setShowDropdown(true);
    setSelectedFromDropdown(false);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseNumberFromCommas(amountStr);
    if (!stockInput.trim()) {
      alert('종목을 입력해주세요.');
      return;
    }
    if (amount <= 0) {
      alert('금액을 입력해주세요.');
      return;
    }

    let resolvedCode = stockCode || stockInput.trim();
    let resolvedName = stockName || stockInput.trim();

    if (!selectedFromDropdown) {
      setBusy(true);
      try {
        const quote = await fetchQuote(stockInput.trim(), market);
        resolvedCode = quote.code;
        resolvedName = quote.name;
      } catch {
        // 조회 실패 시 입력값 그대로 사용
      } finally {
        setBusy(false);
      }
    }

    const record: RealizedGainRecord = {
      id: crypto.randomUUID(),
      stockCode: resolvedCode,
      stockName: resolvedName,
      date,
      amount: gainType === 'gain' ? amount : -amount,
    };
    onSave(record);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={handleSave}>
        <div className="modal-title">
          <strong>실현손익 추가</strong>
          <button aria-label="닫기" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <label>
          종목
          <div className="combo-input-wrap" ref={comboRef}>
            <input
              autoComplete="off"
              placeholder="종목명 또는 코드 입력"
              value={stockInput}
              onFocus={() => setShowDropdown(true)}
              onChange={(e) => handleStockChange(e.target.value)}
            />
            {showDropdown && filtered.length > 0 && (
              <div className="combo-dropdown">
                {filtered.map((h) => (
                  <button key={h.id} type="button" onClick={() => selectHolding(h)}>
                    <span className="combo-name">{h.name}</span>
                    <span className="combo-code">{h.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>

        <label>
          날짜
          <input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>

        <label>
          구분
          <div className="rg-type-toggle">
            <button
              type="button"
              className={`gain-btn${gainType === 'gain' ? ' active' : ''}`}
              onClick={() => setGainType('gain')}
            >
              수익
            </button>
            <button
              type="button"
              className={`loss-btn${gainType === 'loss' ? ' active' : ''}`}
              onClick={() => setGainType('loss')}
            >
              손실
            </button>
          </div>
        </label>

        <label>
          {isOverseas ? '금액 (USD)' : '금액'}
          <div className={gainType === 'gain' ? 'rg-amount-gain' : 'rg-amount-loss'}>
            <input
              inputMode="decimal"
              placeholder={isOverseas ? '예: 1,500.00' : '예: 150,000'}
              value={amountStr}
              onChange={(e) => setAmountStr(formatNumberWithCommas(e.target.value))}
            />
          </div>
        </label>

        <button className="primary-button" disabled={busy} type="submit">
          <Save size={17} />
          {busy ? '종목 확인 중…' : '저장'}
        </button>
      </form>
    </div>
  );
}

// ─── Realized Gains View ──────────────────────────────────────────────────────

function RealizedGainsView({
  data,
  onDataChange,
}: {
  data: AppData;
  onDataChange: (data: AppData) => void;
}) {
  const { c, sc } = useCurrency();
  const [showAddModal, setShowAddModal] = useState(false);
  const [top5Type, setTop5Type] = useState<'gain' | 'loss'>('gain');
  const [rgCsvRows, setRgCsvRows] = useState<RgCsvRow[] | null>(null);
  const [showRgCsvGuide, setShowRgCsvGuide] = useState(false);
  const rgCsvInputRef = useRef<HTMLInputElement>(null);
  const records = data.realizedGains ?? [];

  // 필터 상태
  const allCodes = Array.from(new Set(records.map((r) => r.stockCode)));
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => new Set(allCodes));
  const allYears = Array.from(new Set(records.map((r) => parseInt(r.date.slice(0, 4))))).sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      allCodes.forEach((c) => next.add(c));
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records.length]);

  const toggleCode = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const allSelected = allCodes.every((c) => selectedCodes.has(c));
  const someSelected = !allSelected && allCodes.some((c) => selectedCodes.has(c));
  const isFiltered = !allSelected || selectedYear !== null || selectedMonth !== null;
  const toggleAll = () => {
    if (allSelected) setSelectedCodes(new Set());
    else setSelectedCodes(new Set(allCodes));
  };

  const thisYear = new Date().getFullYear();
  const prevYear = thisYear - 1;
  const totalAll = records.reduce((sum, r) => sum + r.amount, 0);
  const totalThisYear = records
    .filter((r) => r.date.startsWith(String(thisYear)))
    .reduce((sum, r) => sum + r.amount, 0);
  const totalPrevYear = records
    .filter((r) => r.date.startsWith(String(prevYear)))
    .reduce((sum, r) => sum + r.amount, 0);

  // 종목별 누적
  const stockMap: Record<string, { name: string; total: number }> = {};
  records.forEach((r) => {
    if (!stockMap[r.stockCode]) stockMap[r.stockCode] = { name: r.stockName, total: 0 };
    stockMap[r.stockCode].total += r.amount;
  });

  const top5Data =
    top5Type === 'gain'
      ? Object.entries(stockMap)
          .filter(([, v]) => v.total > 0)
          .sort((a, b) => b[1].total - a[1].total)
          .slice(0, 5)
      : Object.entries(stockMap)
          .filter(([, v]) => v.total < 0)
          .sort((a, b) => a[1].total - b[1].total)
          .slice(0, 5);

  const top5Max = top5Data.length > 0 ? Math.abs(top5Data[0][1].total) : 1;

  const filtered = [...records]
    .filter((r) => {
      if (selectedCodes.size > 0 && !selectedCodes.has(r.stockCode)) return false;
      if (selectedYear !== null && parseInt(r.date.slice(0, 4)) !== selectedYear) return false;
      if (selectedMonth !== null && parseInt(r.date.slice(5, 7)) !== selectedMonth) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const filteredTotal = filtered.reduce((sum, r) => sum + r.amount, 0);

  const deleteRecord = (id: string) => {
    onDataChange({ ...data, realizedGains: records.filter((r) => r.id !== id) });
  };

  const handleRgCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) return;
      const startIdx = /^\d/.test(lines[0].split(',')[0].trim()) ? 0 : 1;
      const parsed: RgCsvRow[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 3) continue;
        const stockCode = cols[0].trim();
        const date = cols[1].trim();
        const amount = Number(cols[2].trim().replace(/[^0-9.-]/g, ''));
        if (!stockCode || !date || isNaN(amount)) continue;
        parsed.push({ stockCode, date, amount });
      }
      if (parsed.length > 0) setRgCsvRows(parsed);
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="realized-view">
      {/* 상단 툴바 */}
      <div className="rg-toolbar">
        <button
          className="primary-button"
          style={{ whiteSpace: 'nowrap' }}
          type="button"
          onClick={() => setShowAddModal(true)}
        >
          <Plus size={17} />
          실현손익 추가
        </button>

        {/* 필터 버튼 */}
        <div className="filter-dropdown-wrap" ref={filterDropdownRef}>
          <button
            className="ghost-button icon-btn"
            type="button"
            aria-label="필터"
            style={isFiltered ? { color: '#ffe082' } : undefined}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <Filter size={17} />
          </button>
        </div>

        <button
          className="ghost-button icon-btn"
          type="button"
          aria-label="CSV 파일 업로드"
          onClick={() => setShowRgCsvGuide(true)}
        >
          <Upload size={17} />
        </button>

        {filterOpen && (
          <>
            <div className="filter-backdrop" onClick={() => setFilterOpen(false)} />
            <div className="filter-dropdown-panel">
              <div className="filter-panel-tip" />
              <div className="filter-panel-header">
                <span style={{ fontSize: 14, fontWeight: 700, color: '#dceaff' }}>필터</span>
                <button type="button" onClick={() => setFilterOpen(false)}
                  style={{ background: 'none', border: 'none', color: '#7fa9db', cursor: 'pointer', padding: 4 }}>
                  <X size={16} />
                </button>
              </div>

              {/* 연도 */}
              <div className="filter-section-label">연도</div>
              <div className="filter-select-wrap">
                <select
                  className="filter-select"
                  value={selectedYear ?? ''}
                  onChange={(e) => setSelectedYear(e.target.value === '' ? null : parseInt(e.target.value))}
                >
                  <option value="">전체 연도</option>
                  {allYears.map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
                <span className="filter-select-icon"><ChevronDown size={14} /></span>
              </div>

              {/* 월 */}
              <div className="filter-section-label">월</div>
              <div className="filter-select-wrap">
                <select
                  className="filter-select"
                  value={selectedMonth ?? ''}
                  onChange={(e) => setSelectedMonth(e.target.value === '' ? null : parseInt(e.target.value))}
                >
                  <option value="">전체 월</option>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
                </select>
                <span className="filter-select-icon"><ChevronDown size={14} /></span>
              </div>

              <div className="filter-check-divider" style={{ margin: '10px 0 6px' }} />

              {/* 종목 */}
              <div className="filter-section-label">종목</div>
              <label className="filter-check-row">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                />
                전체 선택/해제
              </label>
              <div className="filter-check-divider" />
              {allCodes.map((code) => {
                const name = records.find((r) => r.stockCode === code)?.stockName ?? code;
                return (
                  <label className="filter-check-row" key={code}>
                    <input type="checkbox" checked={selectedCodes.has(code)} onChange={() => toggleCode(code)} />
                    {name}
                  </label>
                );
              })}
            </div>
          </>
        )}
        <input
          ref={rgCsvInputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handleRgCsvFile}
        />
      </div>

      {/* 요약 카드 */}
      <div className="dividend-total-card">
        <div className="dividend-stat-label">누적 실현손익</div>
        <div className={`rg-total-xl secret-value ${tone(totalAll)}`}>
          {sc(totalAll)}
        </div>
        <div className="dividend-stat-sub">총 {records.length}건</div>
      </div>
      <div className="dividend-section">
        <div style={{ display: 'flex' }}>
          <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid rgba(145,181,220,0.15)', paddingRight: 8 }}>
            <div className="dividend-stat-label">{prevYear}년 실현손익</div>
            <div className={`dividend-stat-value ${tone(totalPrevYear)}`}>
              <span className="secret-value">{sc(totalPrevYear)}</span>
            </div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', paddingLeft: 8 }}>
            <div className="dividend-stat-label">{thisYear}년 실현손익</div>
            <div className={`dividend-stat-value ${tone(totalThisYear)}`}>
              <span className="secret-value">{sc(totalThisYear)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* TOP5 */}
      <div className="rg-section">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span className="dividend-stat-label" style={{ marginBottom: 0, flex: 1 }}>
            종목별 TOP5
          </span>
          <div className="rg-tab-switch">
            <button
              type="button"
              className={top5Type === 'gain' ? 'gain-active' : ''}
              onClick={() => setTop5Type('gain')}
            >
              수익
            </button>
            <button
              type="button"
              className={top5Type === 'loss' ? 'loss-active' : ''}
              onClick={() => setTop5Type('loss')}
            >
              손실
            </button>
          </div>
        </div>
        {top5Data.length === 0 ? (
          <div className="dividend-empty">해당 데이터가 없습니다.</div>
        ) : (
          top5Data.map(([code, { name, total }], idx) => (
            <div className="dividend-top5-row" key={code}>
              <span className={`top5-rank ${top5Type === 'gain' ? 'gain-rank' : 'loss-rank'}`}>
                {idx + 1}
              </span>
              <span className="top5-name">{name}</span>
              <div style={{ flex: 1 }}>
                <div className="dividend-top5-bar">
                  <div
                    className={top5Type === 'gain' ? 'rg-top5-bar-gain' : 'rg-top5-bar-loss'}
                    style={{ width: `${Math.round((Math.abs(total) / top5Max) * 100)}%` }}
                  />
                </div>
              </div>
              <span className={`top5-amount secret-value ${top5Type === 'gain' ? 'gain' : 'loss'}`}>
                {sc(total)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* 리스트 */}
      {records.length === 0 ? (
        <div className="dividend-empty-state">
          <Plus size={28} style={{ opacity: 0.4 }} />
          <strong>실현손익 기록이 없습니다.</strong>
          <p>위 버튼으로 첫 기록을 추가해보세요.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="dividend-empty">필터 조건에 맞는 기록이 없습니다.</div>
      ) : (
        <>
          <div className="rg-record-list">
            {filtered.map((r) => (
              <div className="dividend-record-row" key={r.id}>
                <span className="record-date">{r.date}</span>
                <span className="record-name">{r.stockName}</span>
                <span className={`record-amount secret-value ${tone(r.amount)}`}>
                  {sc(r.amount)}
                </span>
                <button
                  aria-label={`${r.stockName} 삭제`}
                  className="record-delete"
                  type="button"
                  onClick={async () => {
                    if (await customConfirm(`${r.stockName} ${r.date} 실현손익 기록을 삭제할까요?`)) {
                      deleteRecord(r.id);
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="dividend-summary-bar">
            <span>
              합계{' '}
              <strong>
                <span className={`secret-value ${tone(filteredTotal)}`}>{sc(filteredTotal)}</span>
              </strong>
            </span>
            <span>
              총 <strong>{filtered.length}건</strong>
              {isFiltered && <span style={{ color: '#7fa9db' }}> / {records.length}건</span>}
            </span>
          </div>
        </>
      )}

      {showAddModal && (
        <RealizedGainAddModal
          holdings={data.holdings}
          onClose={() => setShowAddModal(false)}
          onSave={(record) =>
            onDataChange({ ...data, realizedGains: [...records, record] })
          }
        />
      )}

      {showRgCsvGuide && (
        <CsvGuideModal
          columns={[
            { name: '종목코드', desc: '6자리 숫자' },
            { name: '날짜', desc: 'YYYY-MM-DD' },
            { name: '금액', desc: '양수=수익  /  음수(-)=손실' },
          ]}
          sample={'005930,2024-01-15,150000\n000660,2024-02-20,-50000'}
          note={<>헤더 행은 있어도 없어도 됩니다. 금액이 양수면 수익, 음수(-)이면 손실로 처리됩니다.<br /><span style={{ color: '#ffe082' }}>엑셀 사용 시 A열/B열/C열에 값 입력 후 반드시 CSV 형식(.csv)으로 저장하세요.</span></>}
          onClose={() => setShowRgCsvGuide(false)}
          onSelectFile={() => rgCsvInputRef.current?.click()}
        />
      )}

      {rgCsvRows && (
        <RgCsvPreviewModal
          rows={rgCsvRows}
          holdings={data.holdings}
          onConfirm={(newRecords) => {
            onDataChange({ ...data, realizedGains: [...records, ...newRecords] });
            setRgCsvRows(null);
          }}
          onClose={() => setRgCsvRows(null)}
        />
      )}
    </div>
  );
}

// ─── Dividend Add Modal ───────────────────────────────────────────────────────

function DividendAddModal({
  holdings,
  onClose,
  onSave,
}: {
  holdings: Holding[];
  onClose: () => void;
  onSave: (record: DividendRecord) => void;
}) {
  const { isOverseas } = useCurrency();
  const market: AccountMode = isOverseas ? 'overseas' : 'domestic';
  const today = new Date().toISOString().slice(0, 10);
  const [stockInput, setStockInput] = useState('');
  const [stockCode, setStockCode] = useState('');
  const [stockName, setStockName] = useState('');
  const [paidAt, setPaidAt] = useState(today);
  const [amountStr, setAmountStr] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedFromDropdown, setSelectedFromDropdown] = useState(false);
  const [busy, setBusy] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const filtered = holdings.filter(
    (h) =>
      h.name.includes(stockInput) || h.code.includes(stockInput),
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectHolding = (h: Holding) => {
    setStockInput(h.name);
    setStockCode(h.code);
    setStockName(h.name);
    setShowDropdown(false);
    setSelectedFromDropdown(true);
  };

  const handleStockChange = (val: string) => {
    setStockInput(val);
    setStockCode('');
    setStockName('');
    setShowDropdown(true);
    setSelectedFromDropdown(false);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseNumberFromCommas(amountStr);
    if (!stockInput.trim()) {
      alert('종목을 입력해주세요.');
      return;
    }
    if (amount <= 0) {
      alert('배당금액을 입력해주세요.');
      return;
    }

    let resolvedCode = stockCode || stockInput.trim();
    let resolvedName = stockName || stockInput.trim();

    if (!selectedFromDropdown) {
      setBusy(true);
      try {
        const quote = await fetchQuote(stockInput.trim(), market);
        resolvedCode = quote.code;
        resolvedName = quote.name;
      } catch {
        // 조회 실패 시 입력값 그대로 사용
      } finally {
        setBusy(false);
      }
    }

    const record: DividendRecord = {
      id: crypto.randomUUID(),
      stockCode: resolvedCode,
      stockName: resolvedName,
      paidAt,
      amount,
    };
    onSave(record);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal dividend-add-modal" onSubmit={handleSave}>
        <div className="modal-title">
          <strong>배당 기록 추가</strong>
          <button aria-label="닫기" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <label>
          종목
          <div className="combo-input-wrap" ref={comboRef}>
            <input
              autoComplete="off"
              placeholder="종목명 또는 코드 입력"
              value={stockInput}
              onFocus={() => setShowDropdown(true)}
              onChange={(e) => handleStockChange(e.target.value)}
            />
            {showDropdown && filtered.length > 0 && (
              <div className="combo-dropdown">
                {filtered.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => selectHolding(h)}
                  >
                    <span className="combo-name">{h.name}</span>
                    <span className="combo-code">{h.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>

        <label>
          지급일
          <input
            required
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </label>

        <label>
          {isOverseas ? '배당금액 (USD)' : '배당금액'}
          <input
            inputMode="decimal"
            placeholder={isOverseas ? '예: 150.00' : '예: 150,000'}
            value={amountStr}
            onChange={(e) => setAmountStr(formatNumberWithCommas(e.target.value))}
          />
        </label>

        <button className="primary-button" disabled={busy} type="submit">
          <Save size={17} />
          {busy ? '종목 확인 중…' : '저장'}
        </button>
      </form>
    </div>
  );
}

// ─── Dividend View ────────────────────────────────────────────────────────────

function DividendView({
  data,
  onDataChange,
}: {
  data: AppData;
  onDataChange: (data: AppData) => void;
}) {
  const [tab, setTab] = useState<'summary' | 'records'>('summary');
  const [showAddModal, setShowAddModal] = useState(false);
  const dividends = data.dividends ?? [];

  const saveDividends = (next: DividendRecord[]) =>
    onDataChange({ ...data, dividends: next });

  const handleBulkAdd = (records: DividendRecord[]) => {
    saveDividends([...dividends, ...records]);
  };

  return (
    <div className="dividend-view">
      <div className="dividend-tabs">
        <button
          className={`dividend-tab-btn${tab === 'summary' ? ' active' : ''}`}
          type="button"
          onClick={() => setTab('summary')}
        >
          요약
        </button>
        <button
          className={`dividend-tab-btn${tab === 'records' ? ' active' : ''}`}
          type="button"
          onClick={() => setTab('records')}
        >
          기록
        </button>
      </div>

      {tab === 'summary' && (
        <DividendSummaryTab
          dividends={dividends}
          onOpenAdd={() => setShowAddModal(true)}
        />
      )}
      {tab === 'records' && (
        <DividendRecordsTab
          dividends={dividends}
          holdings={data.holdings}
          onOpenAdd={() => setShowAddModal(true)}
          onDelete={(id) => saveDividends(dividends.filter((d) => d.id !== id))}
          onBulkAdd={handleBulkAdd}
        />
      )}

      {showAddModal && (
        <DividendAddModal
          holdings={data.holdings}
          onClose={() => setShowAddModal(false)}
          onSave={(record) => saveDividends([...dividends, record])}
        />
      )}
    </div>
  );
}

// ─── Dividend Summary Tab ─────────────────────────────────────────────────────

function DividendSummaryTab({
  dividends,
  onOpenAdd,
}: {
  dividends: DividendRecord[];
  onOpenAdd: () => void;
}) {
  const { c, sc } = useCurrency();
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  // 누적 배당금
  const totalAll = dividends.reduce((sum, d) => sum + d.amount, 0);

  // 전년도 합계
  const prevYear = currentYear - 1;
  const prevYearTotal = dividends
    .filter((d) => d.paidAt.startsWith(String(prevYear)))
    .reduce((sum, d) => sum + d.amount, 0);

  // 올해 (예상) = 최근 12개월 평균 배당금 × 12
  const twelveMonthsAgo = new Date(currentYear, currentMonth - 13, 1);
  const recent12Total = dividends
    .filter((d) => new Date(d.paidAt) >= twelveMonthsAgo)
    .reduce((sum, d) => sum + d.amount, 0);
  const monthlyAvg = Math.round(recent12Total / 12);
  const thisYearEstimated = monthlyAvg * 12;

  // 예상 배당금 설명 팝업 state
  const [showEstInfo, setShowEstInfo] = useState(false);
  const estInfoRef = useRef<HTMLDivElement>(null);
  const estBtnRef = useRef<HTMLButtonElement>(null);
  const { popupStyle: estPopupStyle, arrowX: estArrowX, placement: estPlacement } =
    useSmartPopup(estBtnRef, showEstInfo, { minWidth: 180 });

  useEffect(() => {
    if (!showEstInfo) return;
    const onDown = (e: MouseEvent) => {
      if (
        estInfoRef.current && !estInfoRef.current.contains(e.target as Node) &&
        estBtnRef.current && !estBtnRef.current.contains(e.target as Node)
      ) {
        setShowEstInfo(false);
      }
    };
    const onScroll = () => setShowEstInfo(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [showEstInfo]);

  // 이번달 배당 요약 state
  const [selYear, setSelYear] = useState(currentYear);
  const [selMonth, setSelMonth] = useState(currentMonth);

  const selMonthTotal = dividends
    .filter((d) => {
      const [y, m] = d.paidAt.split('-').map(Number);
      return y === selYear && m === selMonth;
    })
    .reduce((sum, d) => sum + d.amount, 0);

  const prevMonthDate = new Date(selYear, selMonth - 2, 1);
  const prevMonthTotal = dividends
    .filter((d) => {
      const [y, m] = d.paidAt.split('-').map(Number);
      return y === prevMonthDate.getFullYear() && m === prevMonthDate.getMonth() + 1;
    })
    .reduce((sum, d) => sum + d.amount, 0);

  const monthDiff = selMonthTotal - prevMonthTotal;

  // 월별 막대차트 데이터 (6/12개월 스위칭)
  const [chartMonths, setChartMonths] = useState<6 | 12>(6);
  const [selectedBar, setSelectedBar] = useState<number | null>(null);
  const chartData: { label: string; year: number; month: number; total: number }[] = [];
  for (let i = chartMonths - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const total = dividends
      .filter((rec) => {
        const [ry, rm] = rec.paidAt.split('-').map(Number);
        return ry === y && rm === m;
      })
      .reduce((sum, rec) => sum + rec.amount, 0);
    chartData.push({ label: `${m}월`, year: y, month: m, total });
  }

  const chartMax = Math.max(...chartData.map((m) => m.total), 1);

  // TOP5 state
  const [top5Period, setTop5Period] = useState(12);
  const top5Cutoff = new Date(today);
  top5Cutoff.setMonth(top5Cutoff.getMonth() - top5Period);
  const top5CutoffStr = top5Cutoff.toISOString().slice(0, 10);

  const top5Map: Record<string, { name: string; total: number }> = {};
  dividends
    .filter((d) => d.paidAt >= top5CutoffStr)
    .forEach((d) => {
      if (!top5Map[d.stockCode]) top5Map[d.stockCode] = { name: d.stockName, total: 0 };
      top5Map[d.stockCode].total += d.amount;
    });
  const top5 = Object.entries(top5Map)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);
  const top5Max = top5.length > 0 ? top5[0][1].total : 1;

  // 연도 옵션 (최근 3년)
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <div className="dividend-summary-content">
      {/* 1. 누적 배당금 카드 */}
      <div className="dividend-total-card">
        <div className="dividend-stat-label">누적 배당금 합계</div>
        <div className="dividend-stat-value-xl secret-value">{c(totalAll)}</div>
        <div className="dividend-stat-sub">총 {dividends.length}건</div>
      </div>

      {/* 2. 전년도 / 올해 카드 */}
      <div className="dividend-section">
        <div style={{ display: 'flex' }}>
          <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid rgba(145,181,220,0.15)', paddingRight: 8 }}>
            <div className="dividend-stat-label">{prevYear}년 (실제)</div>
            <div className="dividend-stat-value"><span className="secret-value">{c(prevYearTotal)}</span></div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', paddingLeft: 8 }}>
            <div className="dividend-stat-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <span>{currentYear}년 (예상)</span>
              <div className="est-info-wrap" ref={estInfoRef}>
                <button
                  type="button"
                  ref={estBtnRef}
                  className="est-info-btn"
                  onClick={() => setShowEstInfo((v) => !v)}
                  aria-label="예상 배당금 계산 방식"
                >
                  ⓘ
                </button>
                {showEstInfo && (
                  <div
                    className="est-info-popup"
                    data-placement={estPlacement}
                    style={{
                      ...estPopupStyle,
                      '--arrow-x': `${estArrowX}px`,
                    } as React.CSSProperties}
                  >
                    최근 12개월 평균 배당금 × 12
                    <br />
                    <span className="est-info-calc">
                      {c(monthlyAvg)} × 12
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="dividend-stat-value"><span className="secret-value">{c(thisYearEstimated)}</span></div>
          </div>
        </div>
      </div>

      {/* 3. 월별 배당금 추이 SVG 막대차트 */}
      <div className="dividend-section">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <span className="dividend-stat-label" style={{ marginBottom: 0, flex: 1 }}>월별 배당금 추이</span>
          <div style={{
            display: 'flex',
            borderRadius: 8,
            overflow: 'hidden',
            border: '1px solid rgba(145,181,220,0.22)',
          }}>
            {([6, 12] as const).map((n) => (
              <button
                key={n}
                type="button"
                style={{
                  padding: '4px 12px',
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 700,
                  background: chartMonths === n ? 'linear-gradient(135deg,#7c4dff,#00b4d8)' : 'transparent',
                  color: chartMonths === n ? '#fff' : '#7fa9db',
                  cursor: 'pointer',
                }}
                onClick={() => setChartMonths(n)}
              >
                {n}개월
              </button>
            ))}
          </div>
        </div>
        <div className="dividend-chart-wrap">
          <svg
            viewBox="0 0 520 190"
            preserveAspectRatio="xMidYMid meet"
            style={{ width: '100%', height: 'auto', display: 'block', WebkitTapHighlightColor: 'transparent', userSelect: 'none', WebkitUserSelect: 'none' }}
          >
            <defs>
              <linearGradient id="barGrad" x1="0" y1="0" x2="520" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#7c4dff" />
                <stop offset="100%" stopColor="#00b4d8" />
              </linearGradient>
            </defs>
            {chartData.map((item, idx) => {
              const chartH = 100;
              const barW = chartMonths === 6 ? 52 : 28;
              const gap = (520 - chartData.length * barW) / (chartData.length + 1);
              const x = gap + idx * (barW + gap);
              const cx = x + barW / 2;
              const barH = item.total > 0 ? Math.max(4, (item.total / chartMax) * chartH) : 2;
              const barY = 140 - barH;
              const isSelected = selectedBar === idx;

              // 팝업 위치 계산 (손가락에 안 가리도록 막대 위 충분히 위)
              const popupW = 140;
              const popupH = 46;
              const popupX = Math.min(Math.max(2, cx - popupW / 2), 520 - popupW - 2);
              const popupY = Math.max(2, barY - popupH - 18);

              return (
                <g
                  key={`${item.year}-${item.month}`}
                  style={{ cursor: item.total > 0 ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (item.total === 0) return;
                    setSelectedBar((prev) => (prev === idx ? null : idx));
                  }}
                >
                  {/* 터치 영역 확장용 투명 rect */}
                  <rect x={x} y={0} width={barW} height={160} fill="transparent" />
                  <rect
                    x={x}
                    y={barY}
                    width={barW}
                    height={barH}
                    fill="url(#barGrad)"
                    opacity={item.total === 0 ? 0.25 : isSelected ? 1 : 0.85}
                  />
                  <text
                    x={cx}
                    y={162}
                    textAnchor="middle"
                    fill={isSelected ? '#c9e0ff' : '#6a88aa'}
                    fontSize="15"
                    fontWeight={isSelected ? '700' : '400'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {item.label}
                  </text>
                  {/* 팝업 */}
                  {isSelected && item.total > 0 && (
                    <g style={{ pointerEvents: 'none' }}>
                      <rect
                        x={popupX}
                        y={popupY}
                        width={popupW}
                        height={popupH}
                        rx={6}
                        fill="#0a1830"
                        stroke="rgba(124,77,255,0.7)"
                        strokeWidth="1"
                      />
                      {/* 말풍선 꼬리 */}
                      <polygon
                        points={`${cx - 7},${popupY + popupH} ${cx + 7},${popupY + popupH} ${cx},${popupY + popupH + 9}`}
                        fill="#0a1830"
                        stroke="rgba(124,77,255,0.7)"
                        strokeWidth="1"
                        strokeLinejoin="round"
                      />
                      {/* 꼬리 위 선으로 border 가리기 */}
                      <line
                        x1={cx - 7}
                        y1={popupY + popupH}
                        x2={cx + 7}
                        y2={popupY + popupH}
                        stroke="#0a1830"
                        strokeWidth="2"
                      />
                      <text
                        x={popupX + popupW / 2}
                        y={popupY + popupH / 2 + 7}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="17"
                        fontWeight="700"
                      >
                        {c(item.total)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            <line x1="0" y1="140" x2="520" y2="140" stroke="rgba(145,181,220,0.12)" strokeWidth="1" />
          </svg>
        </div>
      </div>

      {/* 4. 이번달 배당 요약 카드 */}
      <div className="dividend-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div className="dividend-stat-label" style={{ marginBottom: 0 }}>월별 배당 요약</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <select
              className="dividend-select"
              value={selYear}
              onChange={(e) => setSelYear(Number(e.target.value))}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            <select
              className="dividend-select"
              value={selMonth}
              onChange={(e) => setSelMonth(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}월</option>
              ))}
            </select>
          </div>
        </div>
        <div className="dividend-stat-value"><span className="secret-value">{c(selMonthTotal)}</span></div>
        <div className={`dividend-month-diff ${monthDiff > 0 ? 'gain' : monthDiff < 0 ? 'loss' : ''}`}>
          전월 대비 <span className="secret-value">{monthDiff === 0 ? '±0' : sc(monthDiff)}</span>
        </div>
      </div>

      {/* 5. 종목별 TOP5 */}
      <div className="dividend-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div className="dividend-stat-label" style={{ marginBottom: 0 }}>종목별 배당금 TOP5</div>
          <select
            className="dividend-select"
            style={{ marginLeft: 'auto' }}
            value={top5Period}
            onChange={(e) => setTop5Period(Number(e.target.value))}
          >
            <option value={3}>3개월</option>
            <option value={6}>6개월</option>
            <option value={9}>9개월</option>
            <option value={12}>12개월</option>
          </select>
        </div>
        {top5.length === 0 ? (
          <div className="dividend-empty">해당 기간 배당 기록이 없습니다.</div>
        ) : (
          top5.map(([code, { name, total }], idx) => (
            <div className="dividend-top5-row" key={code}>
              <span className="top5-rank">{idx + 1}</span>
              <span className="top5-name">{name}</span>
              <div style={{ flex: 1 }}>
                <div className="dividend-top5-bar">
                  <div
                    className="dividend-top5-bar-fill"
                    style={{ width: `${Math.round((total / top5Max) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="top5-amount secret-value">{c(total)}</span>
            </div>
          ))
        )}
      </div>

      {/* 6. 배당 기록 추가 버튼 */}
      <div style={{ paddingBottom: 16 }}>
        <button className="primary-button" style={{ width: '100%' }} type="button" onClick={onOpenAdd}>
          <Plus size={17} />
          배당 기록 추가
        </button>
      </div>
    </div>
  );
}

// ─── CSV Guide Modal ─────────────────────────────────────────────────────────

type CsvGuideColumn = { name: string; desc: string };

function CsvGuideModal({
  columns,
  sample,
  note,
  onClose,
  onSelectFile,
}: {
  columns: CsvGuideColumn[];
  sample: string;
  note?: React.ReactNode;
  onClose: () => void;
  onSelectFile: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-panel csv-guide-modal">
        <div className="csv-guide-header">
          <strong>CSV 업로드 형식 안내</strong>
          <button aria-label="닫기" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="csv-guide-desc">아래 순서로 열을 작성해주세요.</p>
        <div className="csv-guide-cols">
          {columns.map((c, i) => (
            <div key={i} className="csv-guide-col-row">
              <span className="csv-guide-col-num">{i + 1}열</span>
              <span className="csv-guide-col-name">{c.name}</span>
              <span className="csv-guide-col-desc">{c.desc}</span>
            </div>
          ))}
        </div>
        <div className="csv-guide-sample-box">
          <span className="csv-guide-sample-label">예시</span>
          <pre className="csv-guide-pre">{sample}</pre>
        </div>
        {note && <div className="csv-guide-note">{note}</div>}
        <div className="csv-guide-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            취소
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => { onSelectFile(); onClose(); }}
          >
            <Upload size={16} />
            파일 선택
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CSV Preview Modal ───────────────────────────────────────────────────────

type CsvRow = { stockCode: string; paidAt: string; amount: number };
type RgCsvRow = { stockCode: string; date: string; amount: number };
type LiveCsvRow = { code: string; shares: number; averagePrice: number };

function CsvPreviewModal({
  rows,
  holdings,
  onConfirm,
  onClose,
}: {
  rows: CsvRow[];
  holdings: Holding[];
  onConfirm: (records: DividendRecord[]) => void;
  onClose: () => void;
}) {
  // 종목코드 → 종목명 매핑 상태
  const [nameMap, setNameMap] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uniqueCodes = Array.from(new Set(rows.map((r) => r.stockCode)));
    const initialMap: Record<string, string | null> = {};
    uniqueCodes.forEach((c) => { initialMap[c] = null; });
    setNameMap(initialMap);

    // 보유 종목 먼저 매핑
    const holdingMap: Record<string, string> = {};
    holdings.forEach((h) => { holdingMap[h.code] = h.name; });

    const fetchAll = async () => {
      const results = await Promise.allSettled(
        uniqueCodes.map(async (code) => {
          if (holdingMap[code]) return { code, name: holdingMap[code] };
          const quote = await fetchQuote(code);
          return { code, name: quote.name };
        })
      );
      const resolved: Record<string, string | null> = {};
      results.forEach((r, i) => {
        const code = uniqueCodes[i];
        if (r.status === 'fulfilled') {
          resolved[code] = r.value.name;
        } else {
          resolved[code] = null; // 오류 표시
        }
      });
      setNameMap(resolved);
      setLoading(false);
    };

    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = () => {
    const records: DividendRecord[] = rows.map((r) => ({
      id: `div-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stockCode: r.stockCode,
      stockName: nameMap[r.stockCode] ?? r.stockCode,
      paidAt: r.paidAt,
      amount: r.amount,
    }));
    onConfirm(records);
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel csv-preview-modal">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 16, color: '#dceaff' }}>CSV 미리보기</strong>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#7fa9db', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        {loading && (
          <p style={{ color: '#6a88aa', fontSize: 13 }}>종목명 확인 중...</p>
        )}
        <div className="csv-preview-table-wrap">
          <table className="csv-preview-table">
            <thead>
              <tr>
                <th>종목코드</th>
                <th>종목명</th>
                <th>지급일</th>
                <th>배당금액</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const name = nameMap[r.stockCode];
                const isLoading = name === null && loading;
                const isError = name === null && !loading;
                return (
                  <tr key={i}>
                    <td>{r.stockCode}</td>
                    <td>
                      {isLoading && <span className="csv-name-loading">조회 중...</span>}
                      {isError && <span className="csv-name-error">{r.stockCode}</span>}
                      {!isLoading && !isError && name}
                    </td>
                    <td>{r.paidAt}</td>
                    <td style={{ textAlign: 'right' }}>{r.amount.toLocaleString()}원</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="csv-preview-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            취소
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={loading}
            onClick={handleConfirm}
          >
            총 {rows.length}건 업로드
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Live Holding CSV Preview Modal ─────────────────────────────────────────

function LiveHoldingCsvPreviewModal({
  rows,
  onConfirm,
  onClose,
}: {
  rows: LiveCsvRow[];
  onConfirm: (holdings: Holding[]) => void;
  onClose: () => void;
}) {
  const [results, setResults] = useState<(QuoteResult | null)[]>(() => rows.map(() => null));
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<(string | null)[]>(() => rows.map(() => null));

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      rows.map((row, i) =>
        fetchQuote(row.code)
          .then((q) => ({ i, q, err: null as string | null }))
          .catch((e) => ({ i, q: null as QuoteResult | null, err: e instanceof Error ? e.message : '조회 실패' }))
      )
    ).then((all) => {
      if (cancelled) return;
      const newResults = [...rows.map(() => null as QuoteResult | null)];
      const newErrors = [...rows.map(() => null as string | null)];
      all.forEach(({ i, q, err }) => { newResults[i] = q; newErrors[i] = err; });
      setResults(newResults);
      setErrors(newErrors);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const hasError = errors.some((e) => e !== null);

  const handleConfirm = () => {
    const holdings: Holding[] = rows
      .map((row, i) => {
        const q = results[i];
        if (!q) return null;
        return createHoldingFromQuote(q, { query: row.code, shares: String(row.shares), averagePrice: String(row.averagePrice) });
      })
      .filter((h): h is Holding => h !== null);
    onConfirm(holdings);
  };

  const successCount = results.filter((r) => r !== null).length;

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel csv-preview-modal">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 16, color: '#dceaff' }}>CSV 미리보기</strong>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#7fa9db', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        {loading && <p style={{ color: '#6a88aa', fontSize: 13 }}>시세 조회 중…</p>}
        <div className="csv-preview-table-wrap">
          <table className="csv-preview-table">
            <thead>
              <tr>
                <th>종목코드</th>
                <th>종목명</th>
                <th>주식수</th>
                <th>매입가</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const q = results[i];
                const err = errors[i];
                return (
                  <tr key={i}>
                    <td>{row.code}</td>
                    <td>
                      {loading && !q && !err && <span className="csv-name-loading">조회 중…</span>}
                      {err && <span className="csv-name-error">조회 실패</span>}
                      {q && q.name}
                    </td>
                    <td style={{ textAlign: 'right' }}>{row.shares.toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>{row.averagePrice.toLocaleString()}원</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hasError && (
          <p style={{ fontSize: 12, color: '#ff6b6b', marginTop: 6 }}>
            ⚠ 조회 실패한 종목은 업로드에서 제외됩니다.
          </p>
        )}
        <div className="csv-preview-footer">
          <button className="secondary-button" type="button" onClick={onClose}>취소</button>
          <button
            className="primary-button"
            type="button"
            disabled={loading || successCount === 0}
            onClick={handleConfirm}
          >
            총 {successCount}건 업로드
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── RG CSV Preview Modal ────────────────────────────────────────────────────

function RgCsvPreviewModal({
  rows,
  holdings,
  onConfirm,
  onClose,
}: {
  rows: RgCsvRow[];
  holdings: Holding[];
  onConfirm: (records: RealizedGainRecord[]) => void;
  onClose: () => void;
}) {
  const [nameMap, setNameMap] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const uniqueCodes = Array.from(new Set(rows.map((r) => r.stockCode)));
    const initial: Record<string, string | null> = {};
    uniqueCodes.forEach((c) => { initial[c] = null; });
    setNameMap(initial);

    const holdingMap: Record<string, string> = {};
    holdings.forEach((h) => { holdingMap[h.code] = h.name; });

    const fetchAll = async () => {
      const results = await Promise.allSettled(
        uniqueCodes.map(async (code) => {
          if (holdingMap[code]) return { code, name: holdingMap[code] };
          const quote = await fetchQuote(code);
          return { code, name: quote.name };
        }),
      );
      const resolved: Record<string, string | null> = {};
      results.forEach((r, i) => {
        const code = uniqueCodes[i];
        resolved[code] = r.status === 'fulfilled' ? r.value.name : null;
      });
      setNameMap(resolved);
      setLoading(false);
    };
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = () => {
    const records: RealizedGainRecord[] = rows.map((r) => ({
      id: `rg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      stockCode: r.stockCode,
      stockName: nameMap[r.stockCode] ?? r.stockCode,
      date: r.date,
      amount: r.amount,
    }));
    onConfirm(records);
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-panel csv-preview-modal">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong style={{ fontSize: 16, color: '#dceaff' }}>실현손익 CSV 미리보기</strong>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#7fa9db', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>
        {loading && <p style={{ color: '#6a88aa', fontSize: 13 }}>종목명 확인 중...</p>}
        <div className="csv-preview-table-wrap">
          <table className="csv-preview-table">
            <thead>
              <tr>
                <th>종목코드</th>
                <th>종목명</th>
                <th>날짜</th>
                <th>구분</th>
                <th>금액</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const name = nameMap[r.stockCode];
                const isLoading = name === null && loading;
                const isError = name === null && !loading;
                const isGain = r.amount >= 0;
                return (
                  <tr key={i}>
                    <td>{r.stockCode}</td>
                    <td>
                      {isLoading && <span className="csv-name-loading">조회 중...</span>}
                      {isError && <span className="csv-name-error">{r.stockCode}</span>}
                      {!isLoading && !isError && name}
                    </td>
                    <td>{r.date}</td>
                    <td style={{ color: isGain ? '#ff6464' : '#5b9eff', fontWeight: 700 }}>
                      {isGain ? '수익' : '손실'}
                    </td>
                    <td style={{ textAlign: 'right', color: isGain ? '#ff6464' : '#5b9eff' }}>
                      {Math.abs(r.amount).toLocaleString('ko-KR')}원
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="csv-preview-footer">
          <button className="secondary-button" type="button" onClick={onClose}>
            취소
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={loading}
            onClick={handleConfirm}
          >
            총 {rows.length}건 업로드
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dividend Records Tab ─────────────────────────────────────────────────────

function DividendRecordsTab({
  dividends,
  holdings,
  onOpenAdd,
  onDelete,
  onBulkAdd,
}: {
  dividends: DividendRecord[];
  holdings: Holding[];
  onOpenAdd: () => void;
  onDelete: (id: string) => void;
  onBulkAdd: (records: DividendRecord[]) => void;
}) {
  const { c } = useCurrency();
  // 종목 필터
  const allCodes = Array.from(new Set(dividends.map((d) => d.stockCode)));
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => new Set(allCodes));

  // 연도/월 필터
  const allYears = Array.from(new Set(dividends.map((d) => parseInt(d.paidAt.slice(0, 4))))).sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  // 필터 팝업 상태
  const [filterOpen, setFilterOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // CSV 파싱 미리보기
  const [csvRows, setCsvRows] = useState<CsvRow[] | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [showDivCsvGuide, setShowDivCsvGuide] = useState(false);

  // allCodes가 바뀌면 새 코드도 선택 추가
  useEffect(() => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      allCodes.forEach((c) => next.add(c));
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dividends.length]);

  const toggleCode = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const allSelected = allCodes.every((c) => selectedCodes.has(c));
  const someSelected = !allSelected && allCodes.some((c) => selectedCodes.has(c));
  const isFiltered = !allSelected || selectedYear !== null || selectedMonth !== null;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedCodes(new Set());
    } else {
      setSelectedCodes(new Set(allCodes));
    }
  };

  // CSV 파싱
  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) return;

      // 첫 줄 헤더 감지: 첫 컬럼이 숫자가 아니면 헤더로 간주
      const startIdx = /^\d/.test(lines[0].split(',')[0].trim()) ? 0 : 1;
      const parsed: CsvRow[] = [];
      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 3) continue;
        const stockCode = cols[0].trim();
        const paidAt = cols[1].trim();
        const amount = Number(cols[2].trim().replace(/[^0-9.-]/g, ''));
        if (!stockCode || !paidAt || isNaN(amount)) continue;
        parsed.push({ stockCode, paidAt, amount });
      }
      if (parsed.length > 0) setCsvRows(parsed);
      // input 초기화 (같은 파일 재선택 허용)
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const filtered = dividends
    .filter((d) => {
      if (selectedCodes.size > 0 && !selectedCodes.has(d.stockCode)) return false;
      if (selectedYear !== null && parseInt(d.paidAt.slice(0, 4)) !== selectedYear) return false;
      if (selectedMonth !== null && parseInt(d.paidAt.slice(5, 7)) !== selectedMonth) return false;
      return true;
    })
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  const filteredTotal = filtered.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="dividend-records-content">
      {/* 상단 3버튼 바 */}
      <div className="dividend-records-topbar">
        <button className="primary-button" type="button" onClick={onOpenAdd}>
          <Plus size={17} />
          배당 추가
        </button>

        {/* 필터 버튼 */}
        <div className="filter-dropdown-wrap" ref={filterDropdownRef}>
          <button
            className="ghost-button icon-btn"
            type="button"
            aria-label="필터"
            style={isFiltered ? { color: '#ffe082' } : undefined}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <Filter size={17} />
          </button>
        </div>

        {filterOpen && (
          <>
            <div className="filter-backdrop" onClick={() => setFilterOpen(false)} />
            <div className="filter-dropdown-panel">
              <div className="filter-panel-tip" />
              <div className="filter-panel-header">
                <span style={{ fontSize: 14, fontWeight: 700, color: '#dceaff' }}>필터</span>
                <button type="button" onClick={() => setFilterOpen(false)}
                  style={{ background: 'none', border: 'none', color: '#7fa9db', cursor: 'pointer', padding: 4 }}>
                  <X size={16} />
                </button>
              </div>

              {/* 연도 */}
              <div className="filter-section-label">연도</div>
              <div className="filter-select-wrap">
                <select
                  className="filter-select"
                  value={selectedYear ?? ''}
                  onChange={(e) => setSelectedYear(e.target.value === '' ? null : parseInt(e.target.value))}
                >
                  <option value="">전체 연도</option>
                  {allYears.map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
                <span className="filter-select-icon"><ChevronDown size={14} /></span>
              </div>

              {/* 월 */}
              <div className="filter-section-label">월</div>
              <div className="filter-select-wrap">
                <select
                  className="filter-select"
                  value={selectedMonth ?? ''}
                  onChange={(e) => setSelectedMonth(e.target.value === '' ? null : parseInt(e.target.value))}
                >
                  <option value="">전체 월</option>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
                </select>
                <span className="filter-select-icon"><ChevronDown size={14} /></span>
              </div>

              <div className="filter-check-divider" style={{ margin: '10px 0 6px' }} />

              {/* 종목 */}
              <div className="filter-section-label">종목</div>
              <label className="filter-check-row">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                />
                전체 선택/해제
              </label>
              <div className="filter-check-divider" />
              {allCodes.map((code) => {
                const name = dividends.find((d) => d.stockCode === code)?.stockName ?? code;
                return (
                  <label className="filter-check-row" key={code}>
                    <input type="checkbox" checked={selectedCodes.has(code)} onChange={() => toggleCode(code)} />
                    {name}
                  </label>
                );
              })}
            </div>
          </>
        )}

        {/* 파일 업로드 */}
        <button
          className="ghost-button icon-btn"
          type="button"
          aria-label="CSV 파일 업로드"
          onClick={() => setShowDivCsvGuide(true)}
        >
          <Upload size={17} />
        </button>
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={handleCsvFile}
        />
      </div>

      {/* 기록 리스트 */}
      {filtered.length === 0 ? (
        <div className="dividend-empty-state">
          <Plus size={28} style={{ opacity: 0.4 }} />
          <strong>배당 기록이 없습니다.</strong>
          <p>위 버튼으로 첫 배당 기록을 추가해보세요.</p>
        </div>
      ) : (
        <div className="dividend-record-list">
          {filtered.map((d) => (
            <div className="dividend-record-row" key={d.id}>
              <span className="record-date">{d.paidAt}</span>
              <span className="record-name">{d.stockName}</span>
              <span className="record-amount secret-value">{c(d.amount)}</span>
              <button
                aria-label={`${d.stockName} 배당 삭제`}
                className="record-delete"
                type="button"
                onClick={async () => {
                  if (await customConfirm(`${d.stockName} ${d.paidAt} 배당 기록을 삭제할까요?`)) {
                    onDelete(d.id);
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 하단 고정 요약 바 */}
      <div className="dividend-summary-bar">
        <span>합계 <strong><span className="secret-value">{c(filteredTotal)}</span></strong></span>
        <span>총 <strong>{filtered.length}건</strong></span>
      </div>

      {/* CSV 미리보기 모달 */}
      {csvRows && (
        <CsvPreviewModal
          rows={csvRows}
          holdings={holdings}
          onConfirm={(records) => {
            onBulkAdd(records);
            setCsvRows(null);
          }}
          onClose={() => setCsvRows(null)}
        />
      )}

      {/* CSV 형식 안내 모달 */}
      {showDivCsvGuide && (
        <CsvGuideModal
          columns={[
            { name: '종목코드', desc: '6자리 숫자' },
            { name: '지급일', desc: 'YYYY-MM-DD' },
            { name: '배당금액', desc: '숫자 (원 단위, 양수)' },
          ]}
          sample={'005930,2024-01-15,50000\n000660,2024-03-20,30000'}
          note={<>헤더 행은 있어도 없어도 됩니다.<br /><span style={{ color: '#ffe082' }}>엑셀 사용 시 A열/B열/C열에 값 입력 후 반드시 CSV 형식(.csv)으로 저장하세요.</span></>}
          onClose={() => setShowDivCsvGuide(false)}
          onSelectFile={() => csvInputRef.current?.click()}
        />
      )}
    </div>
  );
}

function InstallBanner() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(localStorage.getItem('dad-portfolio-pwa:install-dismissed') === '1');

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (standalone) return;

    const handler = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!promptEvent || hidden) return null;

  return (
    <aside className="install-banner">
      <div>
        <strong>홈 화면에 설치</strong>
        <span>앱처럼 바로 열 수 있습니다.</span>
      </div>
      <button
        className="primary-button compact"
        type="button"
        onClick={async () => {
          await promptEvent.prompt();
          setPromptEvent(null);
        }}
      >
        설치
      </button>
      <button
        aria-label="설치 배너 닫기"
        type="button"
        onClick={() => {
          localStorage.setItem('dad-portfolio-pwa:install-dismissed', '1');
          setHidden(true);
        }}
      >
        <X size={17} />
      </button>
    </aside>
  );
}

export default function App() {
  const [rootData, setRootData] = useState<RootData>(() => loadRootData());
  const [accountMode, setAccountMode] = useState<AccountMode>('domestic');
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('usd');
  const [usdKrwRate, setUsdKrwRate] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuKey>('live');
  const [secretMode, setSecretMode] = useState(false);
  const backupFileRef = useRef<HTMLInputElement>(null);

  // 현재 계좌 데이터
  const data = rootData[accountMode];

  const rows = useMemo(() => calculateHoldingRows(data.holdings), [data.holdings]);
  const summary = useMemo(() => calculateAccountSummary(rows, data.account), [rows, data.account]);

  const persist = (nextAccountData: AppData) => {
    const next: RootData = { ...rootData, [accountMode]: nextAccountData };
    setRootData(next);
    saveRootData(next);
  };

  const persistPassword = (nextAccountData: AppData) => {
    // 비밀번호는 두 계좌 모두 동기화
    const next: RootData = {
      ...rootData,
      domestic: { ...rootData.domestic, password: nextAccountData.password },
      overseas: { ...rootData.overseas, password: nextAccountData.password },
    };
    setRootData(next);
    saveRootData(next);
  };

  const exportBackup = () => {
    const blob = createBackupBlob(rootData);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dad-portfolio-backup-${nowStamp()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const restored = validateBackup(parsed);
        if (!await customConfirm('백업 파일의 데이터로 현재 내용을 교체할까요?')) return;
        setRootData(restored);
        saveRootData(restored);
      } catch (error) {
        alert(error instanceof Error ? error.message : '백업 파일을 읽지 못했습니다.');
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // 구버전 서비스워커(scope: 루트 /) 자동 제거
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => {
          if (!reg.scope.includes('/portview/')) reg.unregister();
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });
    }
  }, []);

  const ctxValue: CurrencyCtxType = {
    isOverseas: accountMode === 'overseas',
    currencyMode,
    usdKrwRate,
  };

  return (
    <CurrencyCtx.Provider value={ctxValue}>
      <ConfirmDialog />
      <ParticleBackground />
      {!unlocked ? (
        <LoginScreen password={rootData.domestic.password} onSuccess={() => setUnlocked(true)} />
      ) : (
      <main className={`app-shell${secretMode ? ' secret-mode' : ''}`}>
      <InstallBanner />
      <AppHeader
        activeMenu={activeMenu}
        onChangeMenu={setActiveMenu}
        onLogout={() => setUnlocked(false)}
        secretMode={secretMode}
        onToggleSecret={() => setSecretMode((v) => !v)}
        onExportBackup={exportBackup}
        onImportBackup={() => backupFileRef.current?.click()}
        accountMode={accountMode}
        onChangeAccount={setAccountMode}
        currencyMode={currencyMode}
        onToggleCurrency={() => setCurrencyMode((m) => (m === 'usd' ? 'krw' : 'usd'))}
      />
      <input
        ref={backupFileRef}
        hidden
        accept="application/json"
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) importBackup(file);
          event.target.value = '';
        }}
      />
      {activeMenu === 'live' && (
        <LiveView data={data} rows={rows} onDataChange={persist} />
      )}
      {activeMenu === 'account' && (
        <AccountView data={data} summary={summary} onDataChange={persist} />
      )}
      {activeMenu === 'dividend' && <DividendView data={data} onDataChange={persist} />}
      {activeMenu === 'realized-gains' && <RealizedGainsView data={data} onDataChange={persist} />}
      {activeMenu === 'password' && (
        <PasswordView data={rootData.domestic} onDataChange={persistPassword} />
      )}
      <button className="floating-menu" type="button" onClick={() => setActiveMenu('live')}>
        <ChevronDown size={16} />
        실시간
      </button>
    </main>
      )}
      {unlocked && activeMenu === 'live' && (
        <MarketIndexBar
          mode={accountMode}
          onUsdKrwRate={setUsdKrwRate}
        />
      )}
    </CurrencyCtx.Provider>
  );
}
