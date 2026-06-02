import {
  ChevronDown,
  ChevronRight,
  Download,
  EyeOff,
  Lock,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { fetchQuote } from './api';
import { calculateAccountSummary, calculateHoldingRows } from './portfolioMath';
import {
  createBackupBlob,
  defaultData,
  loadData,
  saveData,
  validateBackup,
} from './storage';
import type { AppData, DividendRecord, Holding, HoldingRow, MenuKey, QuoteResult } from './types';

type HoldingDraft = {
  id?: string;
  query: string;
  shares: string;
  averagePrice: string;
};

type FlatMenuItem = { kind: 'item'; key: MenuKey; label: string };
type GroupMenuItem = { kind: 'group'; label: string; children: Array<{ key: MenuKey; label: string }> };
type MenuItem = FlatMenuItem | GroupMenuItem;

const menuItems: MenuItem[] = [
  { kind: 'item', key: 'live', label: '실시간 현황' },
  { kind: 'item', key: 'account', label: '전체 계좌 손익 누계' },
  {
    kind: 'group',
    label: '수익관리',
    children: [
      { key: 'dividend', label: '배당' },
      { key: 'realized-gains', label: '실현손익' },
    ],
  },
  { kind: 'item', key: 'password', label: '비밀번호 변경' },
];

// ─── Particle Background ──────────────────────────────────────────────────────

function ptColor(t: number, alpha: number): string {
  const r = Math.round(124 + (0 - 124) * t);
  const g = Math.round(77 + (180 - 77) * t);
  const b = Math.round(255 + (216 - 255) * t);
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
          const alpha = Math.pow(prog, 1.8) * 0.28;

          const grad = ctx.createLinearGradient(pts[i].x, pts[i].y, pts[j].x, pts[j].y);
          grad.addColorStop(0, ptColor(pts[i].t, alpha));
          grad.addColorStop(1, ptColor(pts[j].t, alpha));

          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 0.75;
          ctx.stroke();
        }
      }

      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        ctx.fillStyle = ptColor(p.t, 0.6);
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

function findMenuLabel(key: MenuKey): string {
  for (const item of menuItems) {
    if (item.kind === 'item' && item.key === key) return item.label;
    if (item.kind === 'group') {
      const child = item.children.find((c) => c.key === key);
      if (child) return child.label;
    }
  }
  return '실시간 현황';
}

function findParentGroup(key: MenuKey): string | null {
  for (const item of menuItems) {
    if (item.kind === 'group' && item.children.some((c) => c.key === key)) {
      return item.label;
    }
  }
  return null;
}

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
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pin === password) {
      setError('');
      onSuccess();
      return;
    }
    setError('비밀번호가 맞지 않습니다.');
    setPin('');
  };

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={submit}>
        <div className="login-mark">
          <img src={`${import.meta.env.BASE_URL}portview-icon-192.png`} alt="PortView" className="login-icon" />
        </div>
        <h1>PortView</h1>
        <p>Enter your 4-digit PIN to continue.</p>
        <input
          aria-label="비밀번호"
          autoComplete="current-password"
          inputMode="numeric"
          maxLength={4}
          pattern="[0-9]*"
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
        />
        {error && <span className="form-error">{error}</span>}
        <button className="primary-button" type="submit">
          LOGIN
        </button>
      </form>
    </main>
  );
}

function AppHeader({
  activeMenu,
  onChangeMenu,
  onLogout,
}: {
  activeMenu: MenuKey;
  onChangeMenu: (menu: MenuKey) => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const parent = findParentGroup(activeMenu);
    return parent ? new Set([parent]) : new Set();
  });

  const activeLabel = findMenuLabel(activeMenu);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <header className="app-header">
      <div>
        <span className="eyebrow">PortView</span>
        <h1>{activeLabel}</h1>
      </div>
      <div className="menu-wrap">
        <button
          aria-expanded={open}
          aria-label="전체 메뉴"
          className="icon-button"
          type="button"
          onClick={() => setOpen((value) => !value)}
        >
          <Menu size={22} />
        </button>
        {open && (
          <nav className="dropdown-menu">
            {menuItems.map((item) =>
              item.kind === 'item' ? (
                <button
                  key={item.key}
                  className={activeMenu === item.key ? 'active' : ''}
                  type="button"
                  onClick={() => {
                    onChangeMenu(item.key);
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ) : (
                <div key={item.label} className="menu-group">
                  <button
                    className={`menu-group-label${expandedGroups.has(item.label) ? ' expanded' : ''}`}
                    type="button"
                    onClick={() => toggleGroup(item.label)}
                  >
                    <span>{item.label}</span>
                    <ChevronRight size={14} className="group-chevron" />
                  </button>
                  {expandedGroups.has(item.label) && (
                    <div className="menu-sub-list">
                      {item.children.map((child) => (
                        <button
                          key={child.key}
                          className={`menu-sub-item${activeMenu === child.key ? ' active' : ''}`}
                          type="button"
                          onClick={() => {
                            onChangeMenu(child.key);
                            setOpen(false);
                          }}
                        >
                          <span className="sub-dot" aria-hidden="true" />
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
            <div className="menu-logout-divider" />
            <button
              className="menu-logout-btn"
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <LogOut size={15} />
              로그아웃
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}

function SummaryStrip({
  summary,
}: {
  summary: ReturnType<typeof calculateAccountSummary>;
}) {
  return (
    <section className="summary-strip" aria-label="계좌 요약">
      <div>
        <span>현재총자산</span>
        <strong>{currency(summary.currentTotalAssets)}</strong>
      </div>
      <div>
        <span>총투입 대비 손익</span>
        <strong className={tone(summary.totalProfitLoss)}>{signedCurrency(summary.totalProfitLoss)}</strong>
      </div>
      <div>
        <span>총투입 대비 수익률</span>
        <strong className={tone(summary.totalReturnRate)}>{percent(summary.totalReturnRate)}</strong>
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
            <div>주식수</div>
            <div>매입가</div>
            <div>평가손익</div>
            <div>매입원금</div>
            <div>대비</div>
            <div>비중</div>
            <div>현재가격</div>
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
              <div>{numberText(row.shares, '주')}</div>
              <div>{currency(row.averagePrice)}</div>
              <div className={tone(row.profitLoss)}>{signedCurrency(row.profitLoss)}</div>
              <div>{currency(row.investedAmount)}</div>
              <div className={row.change != null ? tone(row.change) : ''}>{row.change != null ? signedCurrency(row.change) : '-'}</div>
              <div>{plainPercent(row.weight)}</div>
              <div>{currency(row.currentPrice)}</div>
              <div className={tone(row.returnRate)}>{percent(row.returnRate)}</div>
              <div>{currency(row.marketValue)}</div>
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
          종목명 또는 종목코드
          <input
            required
            placeholder="예: 005930 또는 삼성전자"
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
          매입가
          <input
            required
            inputMode="numeric"
            min="0"
            step="1"
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
  summary,
  onDataChange,
}: {
  data: AppData;
  rows: HoldingRow[];
  summary: ReturnType<typeof calculateAccountSummary>;
  onDataChange: (data: AppData) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<HoldingDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');

  const saveHoldings = (holdings: Holding[]) => onDataChange({ ...data, holdings });

  const submitHolding = async (nextDraft: HoldingDraft) => {
    if (Number(nextDraft.shares) <= 0 || Number(nextDraft.averagePrice) <= 0) {
      alert('주식수와 매입가는 0보다 커야 합니다.');
      return;
    }

    const ok = confirm(
      nextDraft.id ? '변경사항을 저장할까요?' : '이 종목을 포트폴리오에 추가할까요?',
    );
    if (!ok) return;

    setBusy(true);
    try {
      const quote = await fetchQuote(nextDraft.query.trim());
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
          const quote = await fetchQuote(holding.code);
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
    setNotice('시세 새로고침을 마쳤습니다.');
  };

  const exportBackup = () => {
    const blob = createBackupBlob(data);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dad-portfolio-backup-${nowStamp()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const restored = validateBackup(parsed);
        if (!confirm('백업 파일의 데이터로 현재 내용을 교체할까요?')) return;
        onDataChange(restored);
        setNotice('백업을 복원했습니다.');
      } catch (error) {
        alert(error instanceof Error ? error.message : '백업 파일을 읽지 못했습니다.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <SummaryStrip summary={summary} />
      <section className="toolbar">
        <button className="primary-button" type="button" onClick={() => setDraft({ query: '', shares: '', averagePrice: '' })}>
          <Plus size={17} />
          종목 추가
        </button>
        <button className="ghost-button" disabled={refreshing || rows.length === 0} type="button" onClick={refreshQuotes}>
          <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
          새로고침
        </button>
        <button className="ghost-button icon-label" type="button" onClick={exportBackup}>
          <Download size={17} />
          백업
        </button>
        <button className="ghost-button icon-label" type="button" onClick={() => fileInputRef.current?.click()}>
          <Upload size={17} />
          복원
        </button>
        <input
          ref={fileInputRef}
          hidden
          accept="application/json"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importBackup(file);
            event.target.value = '';
          }}
        />
      </section>
      {notice && <p className="notice">{notice}</p>}
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
        onDelete={(row) => {
          if (!confirm(`${row.name} 종목을 삭제할까요?`)) return;
          saveHoldings(data.holdings.filter((holding) => holding.id !== row.id));
        }}
      />
      <HoldingModal
        busy={busy}
        draft={draft}
        onClose={() => setDraft(null)}
        onSubmit={submitHolding}
      />
    </>
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
  const [totalContribution, setTotalContribution] = useState(formatNumberWithCommas(data.account.totalContribution || ''));
  const [cashBalance, setCashBalance] = useState(formatNumberWithCommas(data.account.cashBalance || ''));

  useEffect(() => {
    setTotalContribution(formatNumberWithCommas(data.account.totalContribution || ''));
    setCashBalance(formatNumberWithCommas(data.account.cashBalance || ''));
  }, [data.account.cashBalance, data.account.totalContribution]);

  const save = () => {
    if (!confirm('계좌 입력값을 저장할까요?')) return;
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
      <div className="input-grid">
        <label>
          총투입금액
          <input
            inputMode="numeric"
            type="text"
            value={totalContribution}
            onChange={(event) => setTotalContribution(formatNumberWithCommas(event.target.value))}
          />
        </label>
        <label>
          예수금
          <input
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
      <div className="account-metrics">
        <Metric label="총 평가금액" value={currency(summary.totalMarketValue)} />
        <Metric label="현재총자산" value={currency(summary.currentTotalAssets)} />
        <Metric label="투입금대비 예수금비율" value={plainPercent(summary.cashRatio)} />
        <Metric label="총투입 대비 손익" value={signedCurrency(summary.totalProfitLoss)} tone={tone(summary.totalProfitLoss)} />
        <Metric label="총투입 대비 수익률" value={percent(summary.totalReturnRate)} tone={tone(summary.totalReturnRate)} />

      </div>
    </section>
  );
}

function Metric({ label, value, tone: metricTone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={metricTone}>{value}</strong>
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

  const savePassword = (event: FormEvent) => {
    event.preventDefault();
    if (current !== data.password) {
      alert('현재 비밀번호가 맞지 않습니다.');
      return;
    }
    if (next.length !== 4 || next !== confirmPin) {
      alert('새 비밀번호 4자리를 동일하게 입력하세요.');
      return;
    }
    if (!confirm('비밀번호를 변경할까요?')) return;
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

function ComingSoonView({ label }: { label: string }) {
  return (
    <section className="coming-soon-view">
      <div className="coming-soon-icon">🚧</div>
      <strong>{label}</strong>
      <p>준비 중입니다.</p>
    </section>
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
        const quote = await fetchQuote(stockInput.trim());
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
          배당금액
          <input
            inputMode="numeric"
            placeholder="예: 150,000"
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

  // 올해 (예상) = 월평균배당금 × 12 (소수점 없음)
  const thisYearActual = dividends
    .filter((d) => d.paidAt.startsWith(String(currentYear)))
    .reduce((sum, d) => sum + d.amount, 0);
  const thisYearMonthsElapsed = currentMonth;
  const thisYearMonthlyAvg = thisYearMonthsElapsed > 0 ? thisYearActual / thisYearMonthsElapsed : 0;
  const thisYearEstimated = Math.round(thisYearMonthlyAvg * 12);

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
      <div className="dividend-section">
        <div className="dividend-stat-label">누적 배당금 합계</div>
        <div className="dividend-stat-value-xl">{currency(totalAll)}</div>
        <div className="dividend-stat-sub">총 {dividends.length}건</div>
      </div>

      {/* 2. 전년도 / 올해 카드 */}
      <div className="dividend-two-col">
        <div className="dividend-section">
          <div className="dividend-stat-label">{prevYear}년 (실제)</div>
          <div className="dividend-stat-value">{currency(prevYearTotal)}</div>
        </div>
        <div className="dividend-section">
          <div className="dividend-stat-label">{currentYear}년(예상/월평균배당금×12)</div>
          <div className="dividend-stat-value">{currency(thisYearEstimated)}</div>
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
                        {item.total.toLocaleString('ko-KR')}원
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
        <div className="dividend-stat-value">{currency(selMonthTotal)}</div>
        <div className={`dividend-month-diff ${monthDiff > 0 ? 'gain' : monthDiff < 0 ? 'loss' : ''}`}>
          전월 대비 {monthDiff === 0 ? '±0원' : signedCurrency(monthDiff)}
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
              <span className="top5-amount">{currency(total)}</span>
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

// ─── CSV Preview Modal ───────────────────────────────────────────────────────

type CsvRow = { stockCode: string; paidAt: string; amount: number };

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
  // 종목 필터
  const allCodes = Array.from(new Set(dividends.map((d) => d.stockCode)));
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => new Set(allCodes));

  // 연도/월 필터
  const allYears = Array.from(new Set(dividends.map((d) => parseInt(d.paidAt.slice(0, 4))))).sort((a, b) => b - a);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonths, setSelectedMonths] = useState<Set<number>>(new Set());

  // 필터 드롭다운 상태
  const [filterOpen, setFilterOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  // CSV 파싱 미리보기
  const [csvRows, setCsvRows] = useState<CsvRow[] | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // allCodes가 바뀌면 새 코드도 선택 추가
  useEffect(() => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      allCodes.forEach((c) => next.add(c));
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dividends.length]);

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

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
  const isFiltered = !allSelected || selectedYear !== null || selectedMonths.size > 0;

  const toggleMonth = (m: number) => {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });
  };

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
      if (selectedMonths.size > 0 && !selectedMonths.has(parseInt(d.paidAt.slice(5, 7)))) return false;
      return true;
    })
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt));

  const filteredTotal = filtered.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="dividend-records-content">
      {/* 상단 3버튼 바 */}
      <div className="dividend-records-topbar">
        <button className="primary-button compact" type="button" onClick={onOpenAdd}
          style={{ backgroundSize: '300% 100%', backgroundPosition: '0% 0%' }}>
          <Plus size={15} />
          배당 추가
        </button>

        {/* 필터 드롭다운 */}
        <div className="filter-dropdown-wrap" ref={filterDropdownRef}>
          <button
            className="primary-button compact"
            type="button"
            style={isFiltered
              ? { backgroundSize: '300% 100%', backgroundPosition: '50% 0%', boxShadow: 'inset 0 0 0 1000px rgba(0,0,0,0.22)', color: '#ffe082' }
              : { backgroundSize: '300% 100%', backgroundPosition: '50% 0%' }}
            onClick={() => setFilterOpen((v) => !v)}
          >
            필터{isFiltered ? ` (${selectedCodes.size}/${allCodes.length})` : ''}
          </button>
          {filterOpen && (
            <div className="filter-dropdown-panel">
              {/* 연도 필터 */}
              <div className="filter-section-label">연도</div>
              <div className="filter-chip-row">
                <button
                  type="button"
                  className={`filter-chip${selectedYear === null ? ' active' : ''}`}
                  onClick={() => setSelectedYear(null)}
                >전체</button>
                {allYears.map((y) => (
                  <button
                    key={y}
                    type="button"
                    className={`filter-chip${selectedYear === y ? ' active' : ''}`}
                    onClick={() => setSelectedYear(selectedYear === y ? null : y)}
                  >{y}</button>
                ))}
              </div>

              {/* 월 필터 */}
              <div className="filter-section-label" style={{ marginTop: 10 }}>월</div>
              <div className="filter-chip-row">
                <button
                  type="button"
                  className={`filter-chip${selectedMonths.size === 0 ? ' active' : ''}`}
                  onClick={() => setSelectedMonths(new Set())}
                >전체</button>
                {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`filter-chip${selectedMonths.has(m) ? ' active' : ''}`}
                    onClick={() => toggleMonth(m)}
                  >{m}월</button>
                ))}
              </div>

              <div className="filter-check-divider" style={{ margin: '10px 0 6px' }} />

              {/* 종목 필터 */}
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
                    <input
                      type="checkbox"
                      checked={selectedCodes.has(code)}
                      onChange={() => toggleCode(code)}
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* 파일 업로드 */}
        <button
          className="primary-button compact"
          type="button"
          style={{ backgroundSize: '300% 100%', backgroundPosition: '100% 0%' }}
          onClick={() => csvInputRef.current?.click()}
        >
          <Upload size={15} />
          파일 업로드
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
              <span className="record-amount">{currency(d.amount)}</span>
              <button
                aria-label={`${d.stockName} 배당 삭제`}
                className="record-delete"
                type="button"
                onClick={() => {
                  if (confirm(`${d.stockName} ${d.paidAt} 배당 기록을 삭제할까요?`)) {
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
        <span>합계 <strong>{currency(filteredTotal)}</strong></span>
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
  const [data, setData] = useState<AppData>(() => loadData());
  const [unlocked, setUnlocked] = useState(false);
  const [activeMenu, setActiveMenu] = useState<MenuKey>('live');

  const rows = useMemo(() => calculateHoldingRows(data.holdings), [data.holdings]);
  const summary = useMemo(() => calculateAccountSummary(rows, data.account), [rows, data.account]);

  const persist = (nextData: AppData) => {
    setData(nextData);
    saveData(nextData);
  };

  useEffect(() => {
    if (!localStorage.getItem('dad-portfolio-pwa:v1')) {
      saveData(defaultData);
    }
  }, []);

  return (
    <>
      <ParticleBackground />
      {!unlocked ? (
        <LoginScreen password={data.password} onSuccess={() => setUnlocked(true)} />
      ) : (
      <main className="app-shell">
      <InstallBanner />
      <AppHeader activeMenu={activeMenu} onChangeMenu={setActiveMenu} onLogout={() => setUnlocked(false)} />
      {activeMenu === 'live' && (
        <LiveView data={data} rows={rows} summary={summary} onDataChange={persist} />
      )}
      {activeMenu === 'account' && (
        <AccountView data={data} summary={summary} onDataChange={persist} />
      )}
      {activeMenu === 'dividend' && <DividendView data={data} onDataChange={persist} />}
      {activeMenu === 'realized-gains' && <ComingSoonView label="실현손익" />}
      {activeMenu === 'password' && <PasswordView data={data} onDataChange={persist} />}
      <button className="floating-menu" type="button" onClick={() => setActiveMenu('live')}>
        <ChevronDown size={16} />
        실시간
      </button>
    </main>
      )}
    </>
  );
}
