import { confirm, input } from '@inquirer/prompts';
import pc from 'picocolors';
import { startBot } from '../bot/index.js';
import { CONTRACTS, TOKENS } from '../config/constants.js';
import { getEnv } from '../config/env.js';
import { db } from '../services/json-db.js';
import { mintPosition, quoteOpenPosition } from '../services/lp.js';
import { getPnlSummary } from '../services/pnl.js';
import { discoverPoolsForToken } from '../services/pool.js';
import { closePosition100, getUserPositions } from '../services/position.js';
import { swapToUsdg } from '../services/swap.js';
import { approveToken, getWalletDetails } from '../services/wallet.js';
import { formatPrice, formatTokenAmount, formatUsd, parseTokenAmount, shortenAddress } from '../utils/formatter.js';
import { parseDropPercent } from '../utils/math.js';

let botStarted = false;

function printHeader() {
  console.clear();
  console.log(pc.cyan('==============================================================='));
  console.log(pc.bold(pc.magenta('     LINUNI — Robinhood Uniswap V3 & V4 LP Manager      ')));
  console.log(pc.cyan('==============================================================='));
  const env = getEnv();
  const botBadge = env.telegramBotToken
    ? pc.green('🟢 Active & Polling')
    : pc.dim('⚪ Inactive (Set TELEGRAM_BOT_TOKEN in .env)');
  console.log(pc.dim(`Chain ID: ${pc.yellow(env.chainId)} | Mode: ${env.dryRun ? pc.yellow('[DRY RUN / SIMULATION]') : pc.green('[LIVE ON-CHAIN]')}`));
  console.log(pc.dim(`RPC: ${env.rpcUrls[0]}`));
  console.log(pc.dim(`Telegram Bot: ${botBadge}`));
  console.log(pc.cyan('---------------------------------------------------------------\n'));
}

async function handleCheckWallet() {
  printHeader();
  console.log(pc.bold(pc.blue('👛 WALLET BALANCE & ALLOWANCE AUDIT')));
  console.log(pc.dim('Fetching wallet state from Robinhood Chain...\n'));

  try {
    const details = await getWalletDetails();
    console.log(`${pc.bold('Address:')}        ${pc.green(details.address)}`);
    console.log(`${pc.bold('Signer Status:')}  ${details.hasPrivateKey ? pc.green('Private Key Configured') : pc.yellow('Read-Only Mode (No Private Key)')}`);
    console.log('\n' + pc.bold('--- BALANCES ---'));
    console.log(`Native ETH:     ${pc.yellow(details.eth.formatted)} ETH`);
    console.log(`Wrapped WETH:   ${pc.yellow(details.weth.formatted)} WETH`);
    console.log(`Robinhood USDG: ${pc.yellow(details.usdg.formatted)} USDG`);

    console.log('\n' + pc.bold('--- ALLOWANCES ---'));
    console.log(`WETH -> PositionManager: ${details.weth.npmAllowance > 0n ? pc.green('APPROVED') : pc.red('NOT APPROVED')}`);
    console.log(`USDG -> PositionManager: ${details.usdg.npmAllowance > 0n ? pc.green('APPROVED') : pc.red('NOT APPROVED')}`);
    console.log(`WETH -> SwapRouter02:    ${details.weth.swapAllowance > 0n ? pc.green('APPROVED') : pc.red('NOT APPROVED')}`);
    console.log(`USDG -> SwapRouter02:    ${details.usdg.swapAllowance > 0n ? pc.green('APPROVED') : pc.red('NOT APPROVED')}`);

    if (details.hasPrivateKey) {
      const doApprove = await confirm({
        message: 'Do you want to approve tokens for Uniswap PositionManager / SwapRouter now?',
        default: false,
      });

      if (doApprove) {
        console.log('\n' + pc.bold('Select Token & Spender to Approve:'));
        console.log(` 1. Approve WETH for PositionManager`);
        console.log(` 2. Approve USDG for PositionManager`);
        console.log(` 3. Approve WETH for SwapRouter02`);
        console.log(` 4. Approve USDG for SwapRouter02`);

        const choiceInput = await input({ message: 'Input option number (1-4): ' });
        const cleanChoice = choiceInput.trim();

        if (cleanChoice === '1') await approveToken(TOKENS.WETH.address, CONTRACTS.POSITION_MANAGER);
        else if (cleanChoice === '2') await approveToken(TOKENS.USDG.address, CONTRACTS.POSITION_MANAGER);
        else if (cleanChoice === '3') await approveToken(TOKENS.WETH.address, CONTRACTS.SWAP_ROUTER);
        else if (cleanChoice === '4') await approveToken(TOKENS.USDG.address, CONTRACTS.SWAP_ROUTER);
        else console.log(pc.yellow('Invalid choice. Skipping approval.'));

        if (['1', '2', '3', '4'].includes(cleanChoice)) {
          console.log(pc.green('\nApproval transaction completed!'));
        }
      }
    }
  } catch (err) {
    console.log(pc.red(`\nError checking wallet: ${err.message}`));
  }

  await input({ message: '\nPress Enter to return to main menu...' });
}

async function handleCheckPositions() {
  printHeader();
  console.log(pc.bold(pc.blue('📊 UNISWAP V3 & V4 LP POSITIONS INSPECTOR')));
  console.log(pc.dim('Querying positions on Robinhood Chain...\n'));

  try {
    const wallet = await getWalletDetails();
    const positions = await getUserPositions(wallet.address);
    const activePositions = positions.filter(p => p.liquidityRaw > 0n);

    if (activePositions.length === 0) {
      console.log(pc.yellow('No active open LP positions found for this wallet.'));
    } else {
      console.log(pc.bold(`Found ${activePositions.length} active position(s):\n`));
      for (const pos of activePositions) {
        const versionBadge = pos.version === 'V4' ? pc.bgBlue(pc.white(' UNISWAP V4 ')) : pc.bgMagenta(pc.white(' UNISWAP V3 '));
        const statusBadge = pos.inRange
          ? pc.bgGreen(pc.black(' IN RANGE '))
          : pc.bgYellow(pc.black(' OUT OF RANGE '));

        console.log(pc.cyan('---------------------------------------------------------------'));
        console.log(`${pc.bold(`Position NFT #${pos.tokenId}`)} ${versionBadge} ${statusBadge} Fee: ${pos.feePercent}`);
        console.log(`Pair:           ${pc.yellow(pos.token0.symbol)} / ${pc.yellow(pos.token1.symbol)}`);
        console.log(`Min Price:      ${formatPrice(pos.lowerPrice)} ${pos.token1.symbol} per ${pos.token0.symbol}`);
        console.log(`Current Price:  ${formatPrice(pos.currentPrice)} ${pos.token1.symbol} per ${pos.token0.symbol}`);
        console.log(`Max Price:      ${formatPrice(pos.upperPrice)} ${pos.token1.symbol} per ${pos.token0.symbol}`);
        console.log(pc.bold('\nActive Principal Amounts:'));
        console.log(`  - ${pos.activeAmounts.formatted0} ${pos.token0.symbol}`);
        console.log(`  - ${pos.activeAmounts.formatted1} ${pos.token1.symbol}`);
        console.log(pc.bold('Uncollected Fees Earned:'));
        console.log(`  - ${pc.green(pos.uncollectedFees.formatted0)} ${pos.token0.symbol}`);
        console.log(`  - ${pc.green(pos.uncollectedFees.formatted1)} ${pos.token1.symbol}`);
      }
      console.log(pc.cyan('---------------------------------------------------------------\n'));
    }
  } catch (err) {
    console.log(pc.red(`\nError fetching positions: ${err.message}`));
  }

  await input({ message: 'Press Enter to return to main menu...' });
}

async function handleCheckPnl() {
  printHeader();
  console.log(pc.bold(pc.blue('📈 INSTANT LP PORTFOLIO PnL AUDIT')));
  console.log(pc.dim('Querying positions and computing PnL metrics...\n'));

  try {
    const pnl = await getPnlSummary();
    const totalSign = pnl.totalNetPnlUsd >= 0 ? '+' : '';
    const totalColor = pnl.totalIsProfit ? pc.green : pc.red;
    const totalBadge = pnl.totalIsProfit ? pc.bgGreen(pc.black(' PLUS / PROFIT ')) : pc.bgRed(pc.white(' MINUS / LOSS '));

    console.log(pc.cyan('==============================================================='));
    console.log(`${pc.bold('Wallet:')}                 ${pc.green(shortenAddress(pnl.address))}`);
    console.log(`${pc.bold('Total Active Positions:')} ${pc.yellow(pnl.totalPositionsCount)} (${pc.green(`In-Range: ${pnl.inRangeCount}`)} | ${pc.yellow(`Out-of-Range: ${pnl.outOfRangeCount}`)})`);
    console.log(pc.dim('\n💡 Rumus PnL: (Token + USDG + Fee) - Deposit USDG'));
    console.log(pc.cyan('---------------------------------------------------------------'));
    console.log(`${pc.bold('Initial Deposit USDG:')}  ${pc.yellow(formatUsd(pnl.totalInitialDepositUsd))}`);
    console.log(`${pc.bold('Current Total Value:')}   ${pc.bold(pc.green(formatUsd(pnl.grandTotalUsd)))} (Token: ${formatUsd(pnl.totalActiveUsd)} | Fee: ${formatUsd(pnl.totalUncollectedFeesUsd)})`);
    console.log(pc.cyan('---------------------------------------------------------------'));
    console.log(`${pc.bold('NET PnL RESULT:')}        ${totalBadge} ${totalColor(`${totalSign}${formatUsd(pnl.totalNetPnlUsd)} (${totalSign}${pnl.totalNetPnlPercent.toFixed(2)}%)`)}`);
    console.log(pc.cyan('---------------------------------------------------------------'));
    console.log(pc.bold('Uncollected Fees Earned Breakdown:'));
    const feeEntries = Object.entries(pnl.feeTotals);
    if (feeEntries.length === 0) {
      console.log(pc.dim('  (No uncollected fees earned yet)'));
    } else {
      for (const [token, amt] of feeEntries) {
        console.log(`  - ${pc.green(amt.toFixed(6))} ${token}`);
      }
    }
    console.log(pc.cyan('===============================================================\n'));

    if (pnl.positions.length > 0) {
      console.log(pc.bold('Position-by-Position PnL Details:'));
      for (const pos of pnl.positions) {
        const badge = pos.inRange ? pc.green('[IN RANGE]') : pc.yellow('[OUT OF RANGE]');
        const pnlBadge = pos.isProfit ? pc.bgGreen(pc.black(' PLUS ')) : pc.bgRed(pc.white(' MINUS '));
        const posSign = pos.netPnlUsd >= 0 ? '+' : '';
        const pnlColor = pos.isProfit ? pc.green : pc.red;

        console.log(`\n• ${pc.bold(`NFT #${pos.tokenId}`)} (${pos.pair} - ${pos.feePercent}) ${badge}`);
        console.log(`  Current Price:        ${formatPrice(pos.currentPrice)}`);
        console.log(`  Value Breakdown:      Token: ${formatUsd(pos.tokenUsd)} | USDG: ${formatUsd(pos.usdgUsd)} | Fee: ${pc.green(formatUsd(pos.feeUsd))}`);
        console.log(`  Total Current Value:  ${formatUsd(pos.currentTotalValueUsd)} (Deposit: ${formatUsd(pos.initialDepositUsd)})`);
        console.log(`  Position PnL Result:  ${pnlBadge} ${pnlColor(`${posSign}${formatUsd(pos.netPnlUsd)} (${posSign}${pos.netPnlPercent.toFixed(2)}%)`)}`);
      }
      console.log(pc.cyan('\n---------------------------------------------------------------'));
    }
  } catch (err) {
    console.log(pc.red(`\nError generating PnL report: ${err.message}`));
  }

  await input({ message: '\nPress Enter to return to main menu...' });
}

async function handleAutoPnlMonitor() {
  printHeader();
  console.log(pc.bold(pc.blue('⏱️ 10-MINUTE AUTOMATED PnL LIVE MONITOR')));
  console.log(pc.dim('Starting continuous monitor mode... Refreshes PnL every 10 minutes.'));
  console.log(pc.dim('Press Enter at any prompt to return to main menu.\n'));

  const renderCurrentPnl = async () => {
    printHeader();
    console.log(pc.bold(pc.blue(`⏱️ LIVE PnL MONITOR — Updated at ${new Date().toLocaleTimeString()}`)));
    console.log(pc.dim('Refreshes automatically every 10 minutes. Press Enter to exit monitor mode.\n'));

    try {
      const pnl = await getPnlSummary();
      const totalSign = pnl.totalNetPnlUsd >= 0 ? '+' : '';
      const totalColor = pnl.totalIsProfit ? pc.green : pc.red;
      const totalBadge = pnl.totalIsProfit ? pc.bgGreen(pc.black(' PLUS / PROFIT ')) : pc.bgRed(pc.white(' MINUS / LOSS '));

      console.log(pc.cyan('==============================================================='));
      console.log(`${pc.bold('Wallet:')}                 ${pc.green(shortenAddress(pnl.address))}`);
      console.log(`${pc.bold('Total Active Positions:')} ${pc.yellow(pnl.totalPositionsCount)} (${pc.green(`In-Range: ${pnl.inRangeCount}`)} | ${pc.yellow(`Out-of-Range: ${pnl.outOfRangeCount}`)})`);
      console.log(pc.dim('\n💡 Rumus PnL: (Token + USDG + Fee) - Deposit USDG'));
      console.log(pc.cyan('---------------------------------------------------------------'));
      console.log(`${pc.bold('Initial Deposit USDG:')}  ${pc.yellow(formatUsd(pnl.totalInitialDepositUsd))}`);
      console.log(`${pc.bold('Current Total Value:')}   ${pc.bold(pc.green(formatUsd(pnl.grandTotalUsd)))} (Token: ${formatUsd(pnl.totalActiveUsd)} | Fee: ${formatUsd(pnl.totalUncollectedFeesUsd)})`);
      console.log(pc.cyan('---------------------------------------------------------------'));
      console.log(`${pc.bold('NET PnL RESULT:')}        ${totalBadge} ${totalColor(`${totalSign}${formatUsd(pnl.totalNetPnlUsd)} (${totalSign}${pnl.totalNetPnlPercent.toFixed(2)}%)`)}`);
      console.log(pc.cyan('===============================================================\n'));
    } catch (err) {
      console.log(pc.red(`Error fetching PnL update: ${err.message}`));
    }
  };

  await renderCurrentPnl();


  const intervalTimer = setInterval(() => {
    renderCurrentPnl();
  }, 10 * 60 * 1000);

  await input({ message: '\n[MONITORING ACTIVE] Press Enter anytime to stop live monitor and return to main menu...' });
  clearInterval(intervalTimer);
}

async function handleOpenPosition() {
  printHeader();
  console.log(pc.bold(pc.blue('🚀 OPEN NEW LP POSITION')));

  try {
    const tokenInput = await input({
      message: 'Input Token Contract Address (e.g. USDG contract 0x5fc536... or token symbol):',
      default: TOKENS.USDG.address,
    });

    console.log(pc.dim('\nSearching pools on Robinhood Chain...'));
    const discovery = await discoverPoolsForToken(tokenInput);

    if (discovery.pools.length === 0) {
      console.log(pc.yellow(`\nNo initialized pools found for token ${discovery.token.symbol}`));
      await input({ message: 'Press Enter to return to main menu...' });
      return;
    }

    console.log(pc.bold(`\nAvailable Pools for ${discovery.token.symbol}:`));
    discovery.pools.forEach((p, idx) => {
      console.log(` ${idx + 1}. ${p.token0.symbol}/${p.token1.symbol} (Fee: ${p.feeLabel}) - Price: ${formatPrice(p.priceToken1PerToken0)} ${p.token1.symbol}/${p.token0.symbol}`);
    });

    const poolIdxStr = await input({ message: `Select pool number to open position in (1-${discovery.pools.length}): ` });
    const selectedPoolIdx = Math.max(0, Math.min(discovery.pools.length - 1, (parseInt(poolIdxStr.trim(), 10) || 1) - 1));

    const pool = discovery.pools[selectedPoolIdx];
    console.log(pc.green(`\nSelected Pool: ${pool.token0.symbol}/${pool.token1.symbol} (${pool.feeLabel})`));

    const hasUsdg = pool.token0.symbol === 'USDG' || pool.token1.symbol === 'USDG';

    console.log('\n' + pc.bold('Choose Position Price Range:'));
    let rIdx = 1;
    const rangeMap = [];

    if (hasUsdg) {
      console.log(` ${rIdx}. 📉 USDG Single-Sided Range (-50% Price Drop, USDG Only)`);
      rangeMap.push('USDG_DROP_50'); rIdx++;
      console.log(` ${rIdx}. ✏️ Custom % Price Drop Range (e.g. -50, -60, -30%, USDG Only)`);
      rangeMap.push('USDG_DROP_CUSTOM'); rIdx++;
    }
    console.log(` ${rIdx}. Narrow Range (±5% around current price)`); rangeMap.push('NARROW'); rIdx++;
    console.log(` ${rIdx}. Medium Range (±10% around current price)`); rangeMap.push('MEDIUM'); rIdx++;
    console.log(` ${rIdx}. Wide Range (±20% around current price)`); rangeMap.push('WIDE'); rIdx++;
    console.log(` ${rIdx}. Full Range (0 to ∞)`); rangeMap.push('FULL'); rIdx++;
    console.log(` ${rIdx}. Custom Range (Set Min Price & Max Price)`); rangeMap.push('CUSTOM'); rIdx++;

    const rangeNumInput = await input({ message: `Select range option number (1-${rangeMap.length}): ` });
    const rangeChoice = rangeMap[Math.max(0, Math.min(rangeMap.length - 1, (parseInt(rangeNumInput.trim(), 10) || 1) - 1))];

    let customLower = null;
    let customUpper = null;
    let dropPercent = null;
    let isUsdgDropFlow = false;

    if (rangeChoice === 'USDG_DROP_50') {
      dropPercent = 50;
      isUsdgDropFlow = true;
    } else if (rangeChoice === 'USDG_DROP_CUSTOM') {
      const dropStr = await input({
        message: 'Input price drop percentage (e.g. -50, -60, -30% or 50):',
        default: '-50%',
      });
      dropPercent = parseDropPercent(dropStr);
      if (!dropPercent) {
        console.log(pc.red('\nInvalid drop percentage! Must be a number between 0 and 100 (e.g. -50 or -60).'));
        await input({ message: 'Press Enter to return to main menu...' });
        return;
      }
      isUsdgDropFlow = true;
    } else if (rangeChoice === 'CUSTOM') {
      const lowerStr = await input({ message: `Input Min Price (${pool.token1.symbol} per ${pool.token0.symbol}):` });
      const upperStr = await input({ message: `Input Max Price (${pool.token1.symbol} per ${pool.token0.symbol}):` });
      customLower = parseFloat(lowerStr);
      customUpper = parseFloat(upperStr);
    }

    let desiredAmount0 = 0n;
    let desiredAmount1 = 0n;

    if (isUsdgDropFlow) {
      const usdgAmountStr = await input({
        message: `Input amount of USDG to deposit:`,
      });
      if (pool.token0.symbol === 'USDG') {
        desiredAmount0 = parseTokenAmount(usdgAmountStr, pool.token0.decimals);
      } else {
        desiredAmount1 = parseTokenAmount(usdgAmountStr, pool.token1.decimals);
      }
    } else {
      console.log(`\nWhich token amount do you want to specify?`);
      console.log(` 1. ${pool.token0.symbol} Amount`);
      console.log(` 2. ${pool.token1.symbol} Amount`);
      const tokenChoiceInput = await input({ message: 'Select token choice (1 or 2): ' });
      const inputWhichToken = tokenChoiceInput.trim() === '2' ? 'TOKEN1' : 'TOKEN0';

      const amountStr = await input({
        message: `Input amount of ${inputWhichToken === 'TOKEN0' ? pool.token0.symbol : pool.token1.symbol}:`,
      });

      if (inputWhichToken === 'TOKEN0') {
        desiredAmount0 = parseTokenAmount(amountStr, pool.token0.decimals);
      } else {
        desiredAmount1 = parseTokenAmount(amountStr, pool.token1.decimals);
      }
    }

    console.log(pc.dim('\nCalculating range quote & fee breakdown...'));
    const quote = await quoteOpenPosition({
      pool,
      rangeChoice: isUsdgDropFlow ? 'USDG_DROP' : rangeChoice,
      customLowerPrice: customLower,
      customUpperPrice: customUpper,
      dropPercent,
      desiredAmount0,
      desiredAmount1,
    });

    console.log('\n' + pc.cyan('==============================================================='));
    console.log(pc.bold(pc.magenta('📋 POSITION PREVIEW & FEE BREAKDOWN')));
    if (quote.isUsdgSingleSided) {
      console.log(pc.bgGreen(pc.black(` 💵 SINGLE-SIDED DEPOSIT: USDG ONLY (-${quote.dropPercent}% Drop Range) `)));
    }
    console.log(pc.cyan('==============================================================='));
    console.log(`${pc.bold('Pool:')}                ${pool.token0.symbol} / ${pool.token1.symbol} (${pool.feeLabel})`);
    console.log(`${pc.bold('Current Price:')}       ${formatPrice(quote.currentPrice)} ${pool.token1.symbol} per ${pool.token0.symbol}`);
    console.log(`${pc.bold('Min Price Bound:')}     ${formatPrice(quote.lowerPrice)} ${pool.token1.symbol} per ${pool.token0.symbol}`);
    console.log(`${pc.bold('Max Price Bound:')}     ${formatPrice(quote.upperPrice)} ${pool.token1.symbol} per ${pool.token0.symbol}`);
    console.log(pc.cyan('---------------------------------------------------------------'));
    console.log(pc.bold('Required Deposit Breakdown:'));
    console.log(`  - ${pc.yellow(quote.formattedAmount0)} ${pool.token0.symbol}`);
    console.log(`  - ${pc.yellow(quote.formattedAmount1)} ${pool.token1.symbol}`);
    console.log(`Total Projected Deposit Value: ${pc.green(quote.formattedTotalValueUsd)}`);
    console.log(pc.cyan('---------------------------------------------------------------'));
    console.log(`Estimated Gas Fee: ${quote.estimatedGasFeeEth} ETH (~$${(parseFloat(quote.estimatedGasFeeEth) * (pool.token0.symbol === 'WETH' ? quote.currentPrice : 1)).toFixed(2)})`);
    console.log(`Projected Liquidity Units: ${quote.liquidity.toString()}`);
    console.log(pc.cyan('===============================================================\n'));

    const confirmMint = await confirm({
      message: 'Do you want to proceed and mint this LP position on-chain?',
      default: true,
    });

    if (confirmMint) {
      console.log(pc.dim('\nExecuting mint position...'));
      const res = await mintPosition({
        pool,
        tickLower: quote.tickLower,
        tickUpper: quote.tickUpper,
        amount0Desired: quote.requiredAmount0,
        amount1Desired: quote.requiredAmount1,
      });

      if (res.status === 'DRY_RUN') {
        console.log(pc.yellow('\n[DRY RUN COMPLETE] Simulated transaction successfully! No on-chain changes made.'));
      } else {
        console.log(pc.green(`\n[SUCCESS] Position Minted! NFT Token ID: #${res.tokenId}`));
        console.log(`Tx Hash: ${pc.yellow(res.txHash)}`);
      }
    }
  } catch (err) {
    console.log(pc.red(`\nError preparing position: ${err.message}`));
  }

  await input({ message: 'Press Enter to return to main menu...' });
}

async function handleClosePosition() {
  printHeader();
  console.log(pc.bold(pc.blue('🔒 CLOSE LP POSITION (100% LIQUIDITY)')));

  try {
    const wallet = await getWalletDetails();
    const positions = await getUserPositions(wallet.address);
    const activePositions = positions.filter(p => p.liquidityRaw > 0n);

    if (activePositions.length === 0) {
      console.log(pc.yellow('No active open positions found for this wallet.'));
      await input({ message: 'Press Enter to return to main menu...' });
      return;
    }

    console.log('\n' + pc.bold('Select Position NFT to Close 100%:'));
    activePositions.forEach((p, idx) => {
      console.log(` ${idx + 1}. NFT #${p.tokenId} - ${p.token0.symbol}/${p.token1.symbol} (${p.feePercent}) | Amounts: ${p.activeAmounts.formatted0} ${p.token0.symbol} + ${p.activeAmounts.formatted1} ${p.token1.symbol}`);
    });

    const posChoiceInput = await input({ message: `Select position number (1-${activePositions.length}): ` });
    const selectedIdx = Math.max(0, Math.min(activePositions.length - 1, (parseInt(posChoiceInput.trim(), 10) || 1) - 1));
    const targetPos = activePositions[selectedIdx];
    const selectedTokenId = targetPos.tokenId;

    console.log(pc.cyan('\n---------------------------------------------------------------'));
    console.log(pc.bold(`Closing Position NFT #${targetPos.tokenId}`));
    console.log(`Pair:               ${targetPos.token0.symbol} / ${targetPos.token1.symbol}`);
    console.log(`Active Liquidity:   ${targetPos.activeAmounts.formatted0} ${targetPos.token0.symbol} + ${targetPos.activeAmounts.formatted1} ${targetPos.token1.symbol}`);
    console.log(`Uncollected Fees:   ${targetPos.uncollectedFees.formatted0} ${targetPos.token0.symbol} + ${targetPos.uncollectedFees.formatted1} ${targetPos.token1.symbol}`);
    console.log(pc.cyan('---------------------------------------------------------------\n'));

    console.log(pc.bold('Select Close Action Option:'));
    console.log(' 1. Option A: Withdraw Langsung (Keep returned tokens as ETH & USDG in wallet)');
    console.log(' 2. Option B: Tukar USDG Langsung (Automatically swap returned non-USDG tokens directly to USDG via SwapRouter02)');

    const optInput = await input({ message: 'Select Close Option (1 or 2): ' });
    const closeOption = optInput.trim() === '2' ? 'SWAP_USDG' : 'WITHDRAW_DIRECT';

    const confirmClose = await confirm({
      message: `Are you sure you want to CLOSE 100% liquidity of Position #${selectedTokenId}?`,
      default: true,
    });

    if (confirmClose) {
      console.log(pc.dim('\nExecuting 100% decrease liquidity & collect...'));
      const closeRes = await closePosition100(selectedTokenId);

      if (closeRes.status === 'DRY_RUN') {
        console.log(pc.yellow('\n[DRY RUN COMPLETE] Simulated 100% position close successfully.'));
      } else {
        console.log(pc.green(`\n[SUCCESS] Position #${selectedTokenId} closed 100%! Tx Hash: ${closeRes.txHash}`));
      }

      // If Option B selected: auto swap non-USDG token to USDG
      if (closeOption === 'SWAP_USDG') {
        console.log(pc.bold(pc.magenta('\nOption B Selected: Swapping non-USDG tokens to USDG...')));
        const t0IsUsdg = targetPos.token0.symbol === 'USDG';
        const t1IsUsdg = targetPos.token1.symbol === 'USDG';

        if (!t0IsUsdg && targetPos.activeAmounts.amount0 > 0n) {
          console.log(`Swapping ${targetPos.activeAmounts.formatted0} ${targetPos.token0.symbol} -> USDG...`);
          const swap0Res = await swapToUsdg({
            tokenInAddress: targetPos.token0.address,
            amountIn: targetPos.activeAmounts.amount0,
          });
          console.log(pc.green(`Swap Result: ${swap0Res.status} | Tx: ${swap0Res.txHash}`));
        }

        if (!t1IsUsdg && targetPos.activeAmounts.amount1 > 0n) {
          console.log(`Swapping ${targetPos.activeAmounts.formatted1} ${targetPos.token1.symbol} -> USDG...`);
          const swap1Res = await swapToUsdg({
            tokenInAddress: targetPos.token1.address,
            amountIn: targetPos.activeAmounts.amount1,
          });
          console.log(pc.green(`Swap Result: ${swap1Res.status} | Tx: ${swap1Res.txHash}`));
        }
      }
    }
  } catch (err) {
    console.log(pc.red(`\nError closing position: ${err.message}`));
  }

  await input({ message: 'Press Enter to return to main menu...' });
}

async function handleViewTransactions() {
  printHeader();
  console.log(pc.bold(pc.blue('📜 TRANSACTION HISTORY (JSON DB)')));
  const txs = db.getTransactions();

  if (txs.length === 0) {
    console.log(pc.yellow('\nNo transactions recorded in data/transactions.json yet.'));
  } else {
    console.log(pc.bold(`\nRecorded ${txs.length} transaction(s):\n`));
    for (const tx of txs.slice(0, 20)) {
      console.log(`${pc.cyan(tx.timestamp)} | ${pc.bold(tx.type)} | Status: ${tx.status || 'UNKNOWN'}`);
      console.log(`Tx Hash: ${pc.yellow(tx.txHash)}`);
      console.log(pc.dim('---------------------------------------------------------------'));
    }
  }

  await input({ message: 'Press Enter to return to main menu...' });
}

async function handleViewConfig() {
  printHeader();
  console.log(pc.bold(pc.blue('⚙️ CONFIGURATION & SYSTEM STATUS')));
  const env = getEnv();

  console.log(`Chain ID:             ${env.chainId}`);
  console.log(`RPC Primary:          ${env.rpcUrls[0]}`);
  console.log(`JSON Data Dir:        ${env.dataDir}`);
  console.log(`Dry Run Mode:         ${env.dryRun ? pc.yellow('ENABLED (Simulation Only)') : pc.green('DISABLED (Live Execution)')}`);
  console.log(`Execution Enabled:    ${env.executionEnabled ? pc.green('YES') : pc.red('NO')}`);
  console.log(`Max Gas Cap USD:      $${env.maxGasCostUsd.toFixed(2)}`);
  console.log(`Default Slippage Bps: ${env.defaultSlippageBps} bps (${(env.defaultSlippageBps / 100).toFixed(2)}%)`);

  await input({ message: '\nPress Enter to return to main menu...' });
}

function handleHelpGuide() {
  printHeader();
  console.log(pc.bold(pc.blue('📖 LINUNI CLI COMMANDS & NAVIGATION GUIDE')));
  console.log(pc.dim('You can type command names (e.g. /pnl or positions) or menu numbers (1-10):\n'));
  console.log(` • 1 or /wallet     - Check wallet balances (ETH, WETH, USDG) and approve spenders`);
  console.log(` • 2 or /positions  - Inspect active LP positions & uncollected fees`);
  console.log(` • 3 or /pnl        - Check instant LP portfolio PnL report & total USD value`);
  console.log(` • 4 or /autopnl    - Run live 10-minute PnL monitoring loop in terminal`);
  console.log(` • 5 or /open       - Open new Uniswap V3 LP position`);
  console.log(` • 6 or /close      - Close position 100% (Withdraw direct or auto-swap to USDG)`);
  console.log(` • 7 or /history    - View transaction history from JSON database`);
  console.log(` • 8 or /config     - View chain ID, RPC endpoints & dry-run state`);
  console.log(` • 9 or /help       - Display this help guide`);
  console.log(` • 10 or /exit      - Exit LINUNI CLI\n`);
}

async function main() {
  const env = getEnv();
  if (!botStarted && env.telegramBotToken) {
    botStarted = true;
    startBot({ silent: true }).catch(err => {
      console.warn(pc.yellow(`[Telegram Bot Warning] ${err.message}`));
    });
  }

  while (true) {
    printHeader();
    console.log(pc.bold('LINUNI Command Menu (Type option number or command name):'));
    console.log(` 1. ${pc.cyan('/wallet')}     - Check Wallet (ETH, USDG, Allowances)`);
    console.log(` 2. ${pc.cyan('/positions')}  - Check LP Positions (Active & Fees)`);
    console.log(` 3. ${pc.cyan('/pnl')}        - Check Instant LP Portfolio PnL Report`);
    console.log(` 4. ${pc.cyan('/autopnl')}    - Start 10-Minute PnL Live Monitor Loop`);
    console.log(` 5. ${pc.cyan('/open')}       - Open New LP Position (Wizard)`);
    console.log(` 6. ${pc.cyan('/close')}      - Close Position 100% (Withdraw / Swap to USDG)`);
    console.log(` 7. ${pc.cyan('/history')}    - View Transaction History (JSON DB)`);
    console.log(` 8. ${pc.cyan('/config')}     - View System & RPC Configuration`);
    console.log(` 9. ${pc.cyan('/help')}       - Help Guide`);
    console.log(` 10. ${pc.cyan('/exit')}      - Exit CLI\n`);

    const rawInput = await input({ message: 'Input command or number (e.g. 3 or /pnl) > ' });
    const cmd = rawInput.trim().toLowerCase();

    if (cmd === '1' || cmd === 'wallet' || cmd === '/wallet') {
      await handleCheckWallet();
    } else if (cmd === '2' || cmd === 'positions' || cmd === '/positions') {
      await handleCheckPositions();
    } else if (cmd === '3' || cmd === 'pnl' || cmd === '/pnl') {
      await handleCheckPnl();
    } else if (cmd === '4' || cmd === 'autopnl' || cmd === '/autopnl') {
      await handleAutoPnlMonitor();
    } else if (cmd === '5' || cmd === 'open' || cmd === '/open') {
      await handleOpenPosition();
    } else if (cmd === '6' || cmd === 'close' || cmd === '/close') {
      await handleClosePosition();
    } else if (cmd === '7' || cmd === 'history' || cmd === '/history') {
      await handleViewTransactions();
    } else if (cmd === '8' || cmd === 'config' || cmd === '/config') {
      await handleViewConfig();
    } else if (cmd === '9' || cmd === 'help' || cmd === '/help') {
      handleHelpGuide();
      await input({ message: '\nPress Enter to return to main menu...' });
    } else if (cmd === '10' || cmd === 'exit' || cmd === '/exit' || cmd === 'q' || cmd === 'quit') {
      console.log(pc.bold(pc.cyan('\nThank you for using LINUNI! Goodbye.\n')));
      process.exit(0);
    } else {
      console.log(pc.red(`\nUnknown command: "${rawInput}". Type /help for options.`));
      await input({ message: 'Press Enter to continue...' });
    }
  }
}

main().catch(err => {
  console.error(pc.red(`Fatal Error: ${err.message}`));
  process.exit(1);
});
