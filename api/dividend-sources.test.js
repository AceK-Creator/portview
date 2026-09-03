import { describe, expect, it, vi } from 'vitest';
import {
  parseDividendTable,
  fetchDomesticDividend,
} from './dividend-sources.js';

describe('domestic dividend sources', () => {
  it('parses the latest valid dividend row', () => {
    const html = `
      <h1>SOL ETF (473330)</h1>
      <tr><td>2026-07-31</td><td>2026-08-03</td><td>55</td><td>4</td></tr>
      <tr><td>2026-08-31</td><td>2026-09-01</td><td>60</td><td>6</td></tr>`;

    expect(parseDividendTable(html, '473330', 'sol-official')).toEqual({
      dps: 60,
      recordDate: '2026-08-31',
      payDate: '2026-09-01',
      paymentMonths: [8, 9],
      source: 'sol-official',
    });
  });

  it('rejects a page for a different code or a non-positive amount', () => {
    expect(parseDividendTable('<p>000000</p><p>2026-08-31 2026-09-01 60</p>', '473330', 'sol-official')).toBeNull();
    expect(parseDividendTable('<p>473330</p><p>2026-08-31 2026-09-01 0</p>', '473330', 'sol-official')).toBeNull();
  });

  it('uses official source before ETF Explorer', async () => {
    const official = vi.fn().mockResolvedValue({ dps: 60, recordDate: '2026-08-31', payDate: '2026-09-01', paymentMonths: [9], source: 'sol-official' });
    const explorer = vi.fn();
    const result = await fetchDomesticDividend('473330', { officialFetchers: [official], explorerFetcher: explorer });
    expect(result.source).toBe('sol-official');
    expect(explorer).not.toHaveBeenCalled();
  });

  it('falls back to ETF Explorer after official sources fail', async () => {
    const explorer = vi.fn().mockResolvedValue({ dps: 58, recordDate: '2026-08-31', payDate: '2026-09-02', paymentMonths: [9], source: 'etf-explorer' });
    const result = await fetchDomesticDividend('473330', {
      officialFetchers: [vi.fn().mockResolvedValue(null), vi.fn().mockRejectedValue(new Error('blocked'))],
      explorerFetcher: explorer,
    });
    expect(result.source).toBe('etf-explorer');
  });
});
