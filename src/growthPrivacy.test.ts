import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('growth tab secret mode coverage', () => {
  it('marks every growth financial value and the asset graph as secret', () => {
    const protectedGrowthClasses = [
      'growth-graph-private',
      'growth-metric-value secret-value',
      'growth-return-rate secret-value',
      'growth-record-amount secret-value',
      'growth-record-month secret-value',
      'growth-target-goal-amount secret-value',
      'growth-bar-wrap secret-value',
      'growth-remaining-amount secret-value',
      'growth-year-preview-value secret-value',
      'growth-year-metric-value secret-value',
    ];

    for (const className of protectedGrowthClasses) {
      expect(appSource, `missing secret-mode coverage for ${className}`).toContain(className);
    }
  });
});
