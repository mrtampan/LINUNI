import { formatPrice, formatUsd, shortenAddress } from '../utils/formatter.js';

export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatHeaderBanner(env) {
  const modeBadge = env.dryRun ? '⚠️ <b>[DRY RUN / SIMULATION]</b>' : '🟢 <b>[LIVE ON-CHAIN]</b>';
  return (
    `<b>====================================</b>\n` +
    `🤖 <b>LINUNI — Robinhood Uniswap V3 LP Manager</b>\n` +
    `<b>====================================</b>\n` +
    `🌐 <b>Chain ID:</b> <code>${env.chainId}</code> | <b>Mode:</b> ${modeBadge}\n` +
    `⚡ <b>RPC:</b> <code>${escapeHtml(env.rpcUrls[0])}</code>\n` +
    `<b>------------------------------------</b>\n`
  );
}

export function formatWalletCard(details) {
  const signerBadge = details.hasPrivateKey
    ? '🟢 <b>Private Key Configured</b>'
    : '🟡 <b>Read-Only Mode (No Private Key)</b>';

  return (
    `👛 <b>WALLET BALANCE & ALLOWANCE AUDIT</b>\n\n` +
    `📍 <b>Address:</b> <code>${details.address}</code>\n` +
    `🔑 <b>Status:</b> ${signerBadge}\n\n` +
    `💰 <b>BALANCES</b>\n` +
    `• Native ETH: <code>${details.eth.formatted}</code> ETH\n` +
    `• Wrapped WETH: <code>${details.weth.formatted}</code> WETH\n` +
    `• Robinhood USDG: <code>${details.usdg.formatted}</code> USDG\n\n` +
    `🔐 <b>ALLOWANCES</b>\n` +
    `• WETH ➔ PositionManager: ${details.weth.npmAllowance > 0n ? '🟢 APPROVED' : '🔴 NOT APPROVED'}\n` +
    `• USDG ➔ PositionManager: ${details.usdg.npmAllowance > 0n ? '🟢 APPROVED' : '🔴 NOT APPROVED'}\n` +
    `• WETH ➔ SwapRouter02:    ${details.weth.swapAllowance > 0n ? '🟢 APPROVED' : '🔴 NOT APPROVED'}\n` +
    `• USDG ➔ SwapRouter02:    ${details.usdg.swapAllowance > 0n ? '🟢 APPROVED' : '🔴 NOT APPROVED'}`
  );
}

export function formatPositionCard(pos) {
  const statusBadge = pos.liquidityRaw > 0n
    ? (pos.inRange ? '🟢 <b>IN RANGE</b>' : '🟡 <b>OUT OF RANGE</b>')
    : '🔴 <b>CLOSED (0 LIQUIDITY)</b>';

  return (
    `📊 <b>Position NFT #${pos.tokenId}</b> ${statusBadge}\n` +
    `• <b>Fee Tier:</b> <code>${pos.feePercent}</code>\n` +
    `• <b>Pair:</b> <code>${pos.token0.symbol} / ${pos.token1.symbol}</code>\n` +
    `• <b>Min Price:</b> <code>${formatPrice(pos.lowerPrice)}</code> ${pos.token1.symbol}/${pos.token0.symbol}\n` +
    `• <b>Current Price:</b> <code>${formatPrice(pos.currentPrice)}</code> ${pos.token1.symbol}/${pos.token0.symbol}\n` +
    `• <b>Max Price:</b> <code>${formatPrice(pos.upperPrice)}</code> ${pos.token1.symbol}/${pos.token0.symbol}\n` +
    `💵 <b>Active Principal:</b>\n` +
    `  - <code>${pos.activeAmounts.formatted0}</code> ${pos.token0.symbol}\n` +
    `  - <code>${pos.activeAmounts.formatted1}</code> ${pos.token1.symbol}\n` +
    `🎁 <b>Uncollected Fees Earned:</b>\n` +
    `  - 🟢 <code>${pos.uncollectedFees.formatted0}</code> ${pos.token0.symbol}\n` +
    `  - 🟢 <code>${pos.uncollectedFees.formatted1}</code> ${pos.token1.symbol}`
  );
}

export function formatQuotePreview(quote, pool) {
  const singleSidedBadge = quote.isUsdgSingleSided
    ? `💵 <b>SINGLE-SIDED DEPOSIT: USDG ONLY (-${quote.dropPercent}% Drop Range)</b>\n`
    : '';

  return (
    `📋 <b>POSITION PREVIEW & FEE BREAKDOWN</b>\n` +
    `<b>====================================</b>\n` +
    singleSidedBadge +
    `• <b>Pool:</b> <code>${pool.token0.symbol} / ${pool.token1.symbol} (${pool.feeLabel})</code>\n` +
    `• <b>Current Price:</b> <code>${formatPrice(quote.currentPrice)}</code> ${pool.token1.symbol}/${pool.token0.symbol}\n` +
    `• <b>Min Price Bound:</b> <code>${formatPrice(quote.lowerPrice)}</code> ${pool.token1.symbol}/${pool.token0.symbol}\n` +
    `• <b>Max Price Bound:</b> <code>${formatPrice(quote.upperPrice)}</code> ${pool.token1.symbol}/${pool.token0.symbol}\n` +
    `<b>------------------------------------</b>\n` +
    `💵 <b>Required Deposit Breakdown:</b>\n` +
    `  - <code>${quote.formattedAmount0}</code> ${pool.token0.symbol}\n` +
    `  - <code>${quote.formattedAmount1}</code> ${pool.token1.symbol}\n` +
    `💰 <b>Total Projected Deposit Value:</b> <code>${quote.formattedTotalValueUsd}</code>\n` +
    `<b>------------------------------------</b>\n` +
    `⛽ <b>Estimated Gas Fee:</b> <code>${quote.estimatedGasFeeEth} ETH</code>\n` +
    `📊 <b>Projected Liquidity Units:</b> <code>${quote.liquidity.toString()}</code>\n` +
    `<b>====================================</b>`
  );
}

export function formatConfigCard(env) {
  return (
    `⚙️ <b>SYSTEM & RPC CONFIGURATION</b>\n\n` +
    `• <b>Chain ID:</b> <code>${env.chainId}</code>\n` +
    `• <b>Primary RPC:</b> <code>${escapeHtml(env.rpcUrls[0])}</code>\n` +
    `• <b>JSON Storage Dir:</b> <code>${escapeHtml(env.dataDir)}</code>\n` +
    `• <b>Dry Run Mode:</b> ${env.dryRun ? '🟡 <b>ENABLED (Simulation Only)</b>' : '🟢 <b>DISABLED (Live Execution)</b>'}\n` +
    `• <b>Execution Enabled:</b> ${env.executionEnabled ? '🟢 <b>YES</b>' : '🔴 <b>NO</b>'}\n` +
    `• <b>Max Gas Cap USD:</b> <code>$${env.maxGasCostUsd.toFixed(2)}</code>\n` +
    `• <b>Default Slippage:</b> <code>${env.defaultSlippageBps} bps (${(env.defaultSlippageBps / 100).toFixed(2)}%)</code>\n` +
    `• <b>Telegram Allowed Chats:</b> <code>${env.telegramAllowedChats.length > 0 ? env.telegramAllowedChats.join(', ') : 'All Allowed'}</code>`
  );
}

export function formatPnlCard(pnl) {
  const timeStr = new Date(pnl.timestamp).toLocaleTimeString();
  const feeEntries = Object.entries(pnl.feeTotals)
    .map(([token, amt]) => `  • 🟢 <code>${amt.toFixed(6)}</code> ${token}`)
    .join('\n');

  const totalBadge = pnl.totalIsProfit ? '🟢 <b>[PLUS / PROFIT]</b>' : '🔴 <b>[MINUS / LOSS]</b>';
  const totalSign = pnl.totalNetPnlUsd >= 0 ? '+' : '';

  let text = (
    `📈 <b>LP PORTFOLIO PnL AUDIT (${timeStr})</b>\n` +
    `<b>====================================</b>\n` +
    `📍 <b>Wallet:</b> <code>${shortenAddress(pnl.address)}</code>\n` +
    `📊 <b>Active Positions:</b> <code>${pnl.totalPositionsCount}</code> (🟢 In Range: ${pnl.inRangeCount} | 🟡 Out: ${pnl.outOfRangeCount})\n` +
    `<b>------------------------------------</b>\n` +
    `💡 <b>Rumus PnL:</b> <code>(Token + USDG + Fee) - Deposit USDG</code>\n\n` +
    `💵 <b>Initial Deposit USDG:</b> <code>${formatUsd(pnl.totalInitialDepositUsd)}</code>\n` +
    `💰 <b>Current Total Value (Token + USDG + Fee):</b> <code>${formatUsd(pnl.grandTotalUsd)}</code>\n` +
    `  • Active Principal: <code>${formatUsd(pnl.totalActiveUsd)}</code>\n` +
    `  • Uncollected Fees: <code>${formatUsd(pnl.totalUncollectedFeesUsd)}</code>\n\n` +
    `📊 <b>NET PnL RESULT:</b> ${totalBadge}\n` +
    `👉 <code>${totalSign}${formatUsd(pnl.totalNetPnlUsd)} (${totalSign}${pnl.totalNetPnlPercent.toFixed(2)}%)</code>\n` +
    `<b>------------------------------------</b>\n` +
    `🎁 <b>TOTAL UNCOLLECTED FEES EARNED:</b>\n` +
    `${feeEntries || '  • None'}\n` +
    `<b>====================================</b>\n`
  );

  if (pnl.positions.length > 0) {
    text += `\n📋 <b>POSITION PnL DETAILS:</b>\n`;
    for (const pos of pnl.positions) {
      const statusBadge = pos.inRange ? '🟢 IN RANGE' : '🟡 OUT OF RANGE';
      const posBadge = pos.isProfit ? '🟢 <b>PLUS</b>' : '🔴 <b>MINUS</b>';
      const posSign = pos.netPnlUsd >= 0 ? '+' : '';

      text += (
        `\n• <b>NFT #${pos.tokenId} (${pos.pair} - ${pos.feePercent})</b> [${statusBadge}]\n` +
        `  Current Price: <code>${formatPrice(pos.currentPrice)}</code>\n` +
        `  Breakdown: Token: <code>${formatUsd(pos.tokenUsd)}</code> | USDG: <code>${formatUsd(pos.usdgUsd)}</code> | Fee: 🟢 <code>${formatUsd(pos.feeUsd)}</code>\n` +
        `  Total Value (Token + USDG + Fee): <code>${formatUsd(pos.currentTotalValueUsd)}</code>\n` +
        `  Initial Deposit: <code>${formatUsd(pos.initialDepositUsd)}</code>\n` +
        `  PnL: ${posBadge} ➔ <code>${posSign}${formatUsd(pos.netPnlUsd)} (${posSign}${pos.netPnlPercent.toFixed(2)}%)</code>\n`
      );
    }
  }

  return text;
}


