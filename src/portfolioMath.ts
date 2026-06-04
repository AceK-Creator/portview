import type { AccountInputs, AccountSummary, Holding, HoldingRow } from './types';

export function calculateHoldingRows(holdings: Holding[]): HoldingRow[] {
  const baseRows = holdings.map((holding) => {
    const investedAmount = holding.shares * holding.averagePrice;
    const marketValue = holding.shares * (holding.currentPrice ?? 0);
    const profitLoss = marketValue - investedAmount;
    const returnRate = investedAmount > 0 ? (profitLoss / investedAmount) * 100 : 0;

    return {
      ...holding,
      investedAmount,
      marketValue,
      profitLoss,
      returnRate,
      weight: 0,
    };
  });

  const totalMarketValue = baseRows.reduce((sum, row) => sum + row.marketValue, 0);

  return baseRows.map((row) => ({
    ...row,
    weight: totalMarketValue > 0 ? (row.marketValue / totalMarketValue) * 100 : 0,
  }));
}

export function calculateAccountSummary(
  rows: HoldingRow[],
  account: AccountInputs,
): AccountSummary {
  const totalMarketValue = rows.reduce((sum, row) => sum + row.marketValue, 0);
  const currentTotalAssets = totalMarketValue + account.cashBalance;
  const cashRatio =
    currentTotalAssets > 0 ? (account.cashBalance / currentTotalAssets) * 100 : 0;
  const totalProfitLoss = currentTotalAssets - account.totalContribution;
  const totalReturnRate =
    account.totalContribution > 0 ? (totalProfitLoss / account.totalContribution) * 100 : 0;

  return {
    totalMarketValue,
    currentTotalAssets,
    cashRatio,
    totalProfitLoss,
    totalReturnRate,
  };
}
