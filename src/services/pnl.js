import { getUserPositions, getOnChainInitialDeposit } from './position.js';
import { getWalletDetails } from './wallet.js';
import { formatPrice, formatTokenAmount, formatUsd } from '../utils/formatter.js';
import { db } from './json-db.js';

export async function getPnlSummary(targetAddress = null) {
  let address = targetAddress;
  if (!address) {
    const wallet = await getWalletDetails();
    address = wallet.address;
  }

  const positions = await getUserPositions(address);
  const activePositions = positions.filter(p => p.liquidityRaw > 0n);

  let totalActiveUsd = 0;
  let totalUncollectedFeesUsd = 0;
  let totalInitialDepositUsd = 0;
  let inRangeCount = 0;
  let outOfRangeCount = 0;

  const feeTotals = {}; // symbol -> float amount
  const positionSummaries = [];

  for (const pos of activePositions) {
    if (pos.inRange) {
      inRangeCount++;
    } else {
      outOfRangeCount++;
    }

    const t0 = pos.token0.symbol;
    const t1 = pos.token1.symbol;

    // Estimate prices in USDG (1 USDG = $1)
    let p0Usd = 0;
    let p1Usd = 0;

    if (t0 === 'USDG') {
      p0Usd = 1;
      p1Usd = pos.currentPrice > 0 ? 1 / pos.currentPrice : 0;
    } else if (t1 === 'USDG') {
      p1Usd = 1;
      p0Usd = pos.currentPrice;
    } else {
      // Fallback default
      p0Usd = pos.currentPrice;
      p1Usd = 1;
    }

    const amt0 = parseFloat(pos.activeAmounts.formatted0 || '0');
    const amt1 = parseFloat(pos.activeAmounts.formatted1 || '0');
    const fee0 = parseFloat(pos.uncollectedFees.formatted0 || '0');
    const fee1 = parseFloat(pos.uncollectedFees.formatted1 || '0');

    // Separate token amount vs USDG amount for user formula (token + usdg + fee)
    const tokenUsd = t0 === 'USDG' ? amt1 * p1Usd : amt0 * p0Usd;
    const usdgUsd = t0 === 'USDG' ? amt0 * p0Usd : (t1 === 'USDG' ? amt1 * p1Usd : 0);
    const activeUsdTotal = (amt0 * p0Usd) + (amt1 * p1Usd);

    const feeUsd0 = fee0 * p0Usd;
    const feeUsd1 = fee1 * p1Usd;
    const feeUsdTotal = feeUsd0 + feeUsd1;

    // Current total value: token + usdg + fee
    const currentTotalValueUsd = activeUsdTotal + feeUsdTotal;

    // Lookup initial deposit USDG from initial transaction history in transactions.json or fetch directly on-chain
    const txs = db.getTransactions();
    const mintTx = txs.find(t => t.tokenId && t.tokenId.toString() === pos.tokenId.toString() && t.type && t.type.startsWith('MINT_POSITION'));

    let initialDepositUsd = 0;
    if (mintTx && mintTx.initialDepositUsd && parseFloat(mintTx.initialDepositUsd) > 0) {
      initialDepositUsd = parseFloat(mintTx.initialDepositUsd);
    } else {
      const dbRecord = db.getPositionByTokenId(pos.tokenId);
      if (dbRecord && dbRecord.initialDepositUsdSource === 'ONCHAIN' && dbRecord.initialDepositUsd && parseFloat(dbRecord.initialDepositUsd) > 0) {
        initialDepositUsd = parseFloat(dbRecord.initialDepositUsd);
      } else {
        // Fetch initial deposit amounts directly on-chain from position creation mint event logs
        const onChain = await getOnChainInitialDeposit(pos);
        initialDepositUsd = onChain.initialDepositUsd;
        db.savePosition({
          ...pos,
          initialDepositUsd,
          initialDepositUsdSource: 'ONCHAIN',
          initialDepositAmt0: onChain.formatted0,
          initialDepositAmt1: onChain.formatted1,
        });
      }
    }

    // Rumus: (token + usdg + fee) - deposit Usdg
    const netPnlUsd = currentTotalValueUsd - initialDepositUsd;
    const netPnlPercent = initialDepositUsd > 0 ? (netPnlUsd / initialDepositUsd) * 100 : 0;
    const isProfit = netPnlUsd >= 0;

    totalActiveUsd += activeUsdTotal;
    totalUncollectedFeesUsd += feeUsdTotal;
    totalInitialDepositUsd += initialDepositUsd;

    // Track token fees earned
    feeTotals[t0] = (feeTotals[t0] || 0) + fee0;
    feeTotals[t1] = (feeTotals[t1] || 0) + fee1;

    positionSummaries.push({
      tokenId: pos.tokenId,
      version: pos.version,
      pair: `${t0}/${t1}`,
      feePercent: pos.feePercent,
      inRange: pos.inRange,
      currentPrice: pos.currentPrice,
      lowerPrice: pos.lowerPrice,
      upperPrice: pos.upperPrice,
      activeAmountsFormatted: `${pos.activeAmounts.formatted0} ${t0} + ${pos.activeAmounts.formatted1} ${t1}`,
      tokenUsd,
      usdgUsd,
      feeUsd: feeUsdTotal,
      activeUsd: activeUsdTotal,
      uncollectedFeesFormatted: `${pos.uncollectedFees.formatted0} ${t0} + ${pos.uncollectedFees.formatted1} ${t1}`,
      currentTotalValueUsd,
      initialDepositUsd,
      netPnlUsd,
      netPnlPercent,
      isProfit,
      pnlType: isProfit ? 'PLUS' : 'MINUS',
      pnlSign: isProfit ? '+' : '-',
    });
  }

  const grandTotalUsd = totalActiveUsd + totalUncollectedFeesUsd;
  const totalNetPnlUsd = grandTotalUsd - totalInitialDepositUsd;
  const totalNetPnlPercent = totalInitialDepositUsd > 0 ? (totalNetPnlUsd / totalInitialDepositUsd) * 100 : 0;
  const totalIsProfit = totalNetPnlUsd >= 0;

  return {
    timestamp: new Date().toISOString(),
    address,
    totalPositionsCount: activePositions.length,
    inRangeCount,
    outOfRangeCount,
    totalActiveUsd,
    totalUncollectedFeesUsd,
    grandTotalUsd,
    totalInitialDepositUsd,
    totalNetPnlUsd,
    totalNetPnlPercent,
    totalIsProfit,
    totalPnlType: totalIsProfit ? 'PLUS' : 'MINUS',
    totalPnlSign: totalIsProfit ? '+' : '-',
    feeTotals,
    positions: positionSummaries,
  };
}
