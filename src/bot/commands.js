import { CONTRACTS, TOKENS } from '../config/constants.js';
import { getEnv } from '../config/env.js';
import { db } from '../services/json-db.js';
import { mintPosition, quoteOpenPosition } from '../services/lp.js';
import { getPnlSummary } from '../services/pnl.js';
import { discoverPoolsForToken } from '../services/pool.js';
import { closePosition100, getUserPositions } from '../services/position.js';
import { swapToUsdg } from '../services/swap.js';
import { approveToken, getWalletDetails } from '../services/wallet.js';
import { parseTokenAmount } from '../utils/formatter.js';
import { parseDropPercent } from '../utils/math.js';
import { sessionStore } from './flow-session.js';
import {
  escapeHtml,
  formatConfigCard,
  formatHeaderBanner,
  formatPnlCard,
  formatPositionCard,
  formatQuotePreview,
  formatWalletCard,
} from './formatters.js';
import {
  cancelKeyboard,
  closeOptionsKeyboard,
  confirmCloseKeyboard,
  confirmMintKeyboard,
  mainMenuKeyboard,
  poolSelectionKeyboard,
  positionListKeyboard,
  rangeSelectionKeyboard,
  tokenSpecifyKeyboard,
  walletApprovalKeyboard,
} from './keyboards.js';

export const autoPnlChats = new Set();

export async function handleStart(ctx) {
  const env = getEnv();
  const banner = formatHeaderBanner(env);
  const text = (
    `${banner}\n` +
    `Welcome to <b>LINUNI Telegram LP Manager</b>!\n\n` +
    `Manage Uniswap V3 liquidity positions, inspect wallet balances & allowances, execute 100% position closes, and monitor transactions directly from Telegram.\n\n` +
    `Use the menu below or type /help to see all commands.`
  );
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
}

export async function handleHelp(ctx) {
  const text = (
    `📖 <b>LINUNI TELEGRAM BOT COMMANDS & SAFETY GUIDE</b>\n\n` +
    `• /start — Main menu & status banner\n` +
    `• /wallet — Audit balances (ETH, WETH, USDG) and approve spenders\n` +
    `• /positions — Inspect active LP positions & uncollected fee earnings\n` +
    `• /pnl — Check instant LP portfolio PnL report & total value\n` +
    `• /autopnl — Toggle automatic 10-minute PnL report updates in chat\n` +
    `• /open — Interactive wizard to discover pools, select range & mint LP position\n` +
    `• /close — Close 100% LP position (Direct withdraw or auto-swap to USDG)\n` +
    `• /history — View transaction history from JSON database\n` +
    `• /config — View chain ID, RPC endpoints, gas caps & dry-run state\n` +
    `• /cancel — Cancel active interaction wizard\n\n` +
    `💡 <i>Tip: You can paste a token address (e.g. USDG contract) anytime to start position discovery!</i>`
  );
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
}

export async function handlePnlCommand(ctx) {
  const loading = await ctx.reply('⏳ <i>Calculating PnL & aggregating LP position metrics...</i>', { parse_mode: 'HTML' });
  try {
    const pnl = await getPnlSummary();
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
    const text = formatPnlCard(pnl);
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
    return ctx.reply(`❌ <b>Error calculating PnL:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
  }
}

export async function handleAutoPnlCommand(ctx) {
  const chatId = String(ctx.chat.id);
  const textArg = ctx.message?.text?.split(' ')[1]?.toLowerCase();

  let isEnabled = false;
  if (textArg === 'off') {
    autoPnlChats.delete(chatId);
    isEnabled = false;
  } else if (textArg === 'on') {
    autoPnlChats.add(chatId);
    isEnabled = true;
  } else {
    if (autoPnlChats.has(chatId)) {
      autoPnlChats.delete(chatId);
      isEnabled = false;
    } else {
      autoPnlChats.add(chatId);
      isEnabled = true;
    }
  }

  if (isEnabled) {
    return ctx.reply(
      `⏱️ <b>Auto PnL Monitoring Enabled!</b>\n\n` +
      `You will receive automated PnL updates every 10 minutes in this chat.\n` +
      `Type <code>/autopnl off</code> anytime to disable.`,
      { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() }
    );
  } else {
    return ctx.reply(
      `🔴 <b>Auto PnL Monitoring Disabled.</b>\n\n` +
      `Automated 10-minute PnL updates have been turned off for this chat.`,
      { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() }
    );
  }
}


export async function handleWalletCommand(ctx) {
  const loading = await ctx.reply('⏳ <i>Querying wallet state from Robinhood Chain...</i>', { parse_mode: 'HTML' });
  try {
    const details = await getWalletDetails();
    const env = getEnv();
    const text = `${formatHeaderBanner(env)}\n${formatWalletCard(details)}`;
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
    return ctx.reply(text, { parse_mode: 'HTML', reply_markup: walletApprovalKeyboard(details.hasPrivateKey) });
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
    return ctx.reply(`❌ <b>Error checking wallet:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
  }
}

export async function handlePositionsCommand(ctx) {
  const loading = await ctx.reply('⏳ <i>Querying LP positions on Robinhood Chain...</i>', { parse_mode: 'HTML' });
  try {
    const wallet = await getWalletDetails();
    const positions = await getUserPositions(wallet.address);
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });

    const activePositions = positions.filter(p => p.liquidityRaw > 0n);

    if (activePositions.length === 0) {
      return ctx.reply('ℹ️ <b>No active LP positions found for this wallet.</b>', {
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      });
    }

    await ctx.reply(`📊 <b>Found ${activePositions.length} Active Position(s):</b>`, { parse_mode: 'HTML' });

    for (const pos of activePositions) {
      await ctx.reply(formatPositionCard(pos), { parse_mode: 'HTML' });
    }

    return ctx.reply('👇 <b>Management Quick Actions:</b>', {
      parse_mode: 'HTML',
      reply_markup: positionListKeyboard(activePositions),
    });
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
    return ctx.reply(`❌ <b>Error fetching positions:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
  }
}

export async function handleOpenCommand(ctx, tokenInputOverride = null) {
  sessionStore.clearSession(ctx.chat.id);

  if (!tokenInputOverride) {
    sessionStore.setSession(ctx.chat.id, { flow: 'OPEN_POSITION', state: 'AWAITING_TOKEN' });
    return ctx.reply(
      `🚀 <b>OPEN LP POSITION WIZARD</b>\n\n` +
      `Please input Token Contract Address or Symbol:\n` +
      `<i>Default: Robinhood USDG (<code>${TOKENS.USDG.address}</code>)</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: cancelKeyboard(),
      }
    );
  }

  return processTokenDiscovery(ctx, tokenInputOverride);
}

export async function processTokenDiscovery(ctx, tokenInput) {
  const loading = await ctx.reply(`⏳ <i>Searching pools for token <code>${escapeHtml(tokenInput)}</code>...</i>`, { parse_mode: 'HTML' });
  try {
    const discovery = await discoverPoolsForToken(tokenInput);
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });

    if (discovery.pools.length === 0) {
      sessionStore.clearSession(ctx.chat.id);
      return ctx.reply(`⚠️ <b>No initialized pools found for token ${escapeHtml(discovery.token.symbol)}</b>`, {
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      });
    }

    sessionStore.setSession(ctx.chat.id, {
      flow: 'OPEN_POSITION',
      state: 'AWAITING_POOL',
      token: discovery.token,
      pools: discovery.pools,
    });

    let poolListText = `🏊 <b>Available Pools for ${escapeHtml(discovery.token.symbol)}:</b>\n\n`;
    discovery.pools.forEach((p, idx) => {
      poolListText +=
        `<b>${idx + 1}. ${escapeHtml(p.token0.symbol)} / ${escapeHtml(p.token1.symbol)}</b> (${escapeHtml(p.feeLabel)})\n` +
        `   • <b>Price:</b> <code>${formatPrice(p.priceToken1PerToken0)}</code> ${p.token1.symbol}/${p.token0.symbol}\n` +
        `   • <b>TVL:</b> <code>${p.formattedTvl || '$0'}</code> | <b>24h Vol:</b> <code>${p.formattedVolume24h || '$0'}</code>\n\n`;
    });
    poolListText += `Select pool to open position in:`;

    return ctx.reply(
      poolListText,
      {
        parse_mode: 'HTML',
        reply_markup: poolSelectionKeyboard(discovery.pools),
      }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
    sessionStore.clearSession(ctx.chat.id);
    return ctx.reply(`❌ <b>Error discovering pool:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
  }
}

export async function handleCloseCommand(ctx) {
  sessionStore.clearSession(ctx.chat.id);
  const loading = await ctx.reply('⏳ <i>Fetching active positions...</i>', { parse_mode: 'HTML' });

  try {
    const wallet = await getWalletDetails();
    const positions = await getUserPositions(wallet.address);
    const activePositions = positions.filter(p => p.liquidityRaw > 0n);
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });

    if (activePositions.length === 0) {
      return ctx.reply('ℹ️ <b>No active open positions found for this wallet.</b>', {
        parse_mode: 'HTML',
        reply_markup: mainMenuKeyboard(),
      });
    }

    sessionStore.setSession(ctx.chat.id, {
      flow: 'CLOSE_POSITION',
      state: 'AWAITING_POSITION',
      activePositions,
    });

    return ctx.reply(
      `🔒 <b>CLOSE LP POSITION (100% LIQUIDITY)</b>\n\nSelect position NFT to close 100%:`,
      {
        parse_mode: 'HTML',
        reply_markup: positionListKeyboard(activePositions),
      }
    );
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
    return ctx.reply(`❌ <b>Error loading active positions:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
  }
}

export async function handleHistoryCommand(ctx) {
  const txs = db.getTransactions();
  if (txs.length === 0) {
    return ctx.reply('📜 <b>No transactions recorded in data/transactions.json yet.</b>', {
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(),
    });
  }

  let text = `📜 <b>TRANSACTION HISTORY (Recorded ${txs.length})</b>\n\n`;
  for (const tx of txs.slice(0, 10)) {
    text += `• <b>${escapeHtml(tx.type)}</b> | Status: <code>${escapeHtml(tx.status || 'SUCCESS')}</code>\n`;
    text += `  Time: <code>${escapeHtml(tx.timestamp)}</code>\n`;
    text += `  Tx: <code>${escapeHtml(tx.txHash)}</code>\n\n`;
  }

  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
}

export async function handleConfigCommand(ctx) {
  const env = getEnv();
  return ctx.reply(formatConfigCard(env), { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
}

export async function handleCancelCommand(ctx) {
  sessionStore.clearSession(ctx.chat.id);
  return ctx.reply('❌ <b>Interaction flow cancelled.</b> No transactions were sent.', {
    parse_mode: 'HTML',
    reply_markup: mainMenuKeyboard(),
  });
}

export async function handleCallbackQuery(ctx) {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery().catch(() => { });

  if (data === 'menu:main') return handleStart(ctx);
  if (data === 'menu:wallet') return handleWalletCommand(ctx);
  if (data === 'menu:positions') return handlePositionsCommand(ctx);
  if (data === 'menu:pnl') return handlePnlCommand(ctx);
  if (data === 'menu:autopnl') return handleAutoPnlCommand(ctx);
  if (data === 'menu:open') return handleOpenCommand(ctx);
  if (data === 'menu:close') return handleCloseCommand(ctx);
  if (data === 'menu:history') return handleHistoryCommand(ctx);
  if (data === 'menu:config') return handleConfigCommand(ctx);
  if (data === 'action:cancel') return handleCancelCommand(ctx);

  // Approval actions
  if (data.startsWith('approve:')) {
    const choice = data.split(':')[1];
    const loading = await ctx.reply(`⏳ <i>Executing approval for ${choice}...</i>`, { parse_mode: 'HTML' });
    try {
      if (choice === 'WETH_NPM') await approveToken(TOKENS.WETH.address, CONTRACTS.POSITION_MANAGER);
      if (choice === 'USDG_NPM') await approveToken(TOKENS.USDG.address, CONTRACTS.POSITION_MANAGER);
      if (choice === 'WETH_SWAP') await approveToken(TOKENS.WETH.address, CONTRACTS.SWAP_ROUTER);
      if (choice === 'USDG_SWAP') await approveToken(TOKENS.USDG.address, CONTRACTS.SWAP_ROUTER);
      await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
      await ctx.reply(`✅ <b>Approval transaction completed!</b>`, { parse_mode: 'HTML' });
      return handleWalletCommand(ctx);
    } catch (err) {
      await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
      return ctx.reply(`❌ <b>Approval failed:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
    }
  }

  // Open Position: Pool Selection
  if (data.startsWith('pool:')) {
    const session = sessionStore.getSession(ctx.chat.id);
    if (!session || session.flow !== 'OPEN_POSITION' || session.state !== 'AWAITING_POOL') {
      return ctx.reply('⚠️ Session expired or invalid. Please start again with /open.', { parse_mode: 'HTML' });
    }
    const idx = parseInt(data.split(':')[1], 10);
    const selectedPool = session.pools[idx];
    if (!selectedPool) return ctx.reply('Invalid pool selection.', { parse_mode: 'HTML' });

    sessionStore.setSession(ctx.chat.id, {
      ...session,
      state: 'AWAITING_RANGE',
      pool: selectedPool,
    });

    const hasUsdg = selectedPool.token0.symbol === 'USDG' || selectedPool.token1.symbol === 'USDG';

    return ctx.reply(
      `🎯 <b>Selected Pool:</b> <code>${selectedPool.token0.symbol}/${selectedPool.token1.symbol} (${selectedPool.feeLabel})</code>\n\n` +
      `Choose Position Price Range:`,
      {
        parse_mode: 'HTML',
        reply_markup: rangeSelectionKeyboard(hasUsdg),
      }
    );
  }

  // Open Position: Range Selection
  if (data.startsWith('range:')) {
    const session = sessionStore.getSession(ctx.chat.id);
    if (!session || session.flow !== 'OPEN_POSITION' || session.state !== 'AWAITING_RANGE') {
      return ctx.reply('⚠️ Session expired or invalid. Please start again with /open.', { parse_mode: 'HTML' });
    }
    const rangeChoice = data.split(':')[1];

    if (rangeChoice === 'DROP_50') {
      const usdgChoice = session.pool.token0.symbol === 'USDG' ? 'TOKEN0' : 'TOKEN1';
      sessionStore.setSession(ctx.chat.id, {
        ...session,
        state: 'AWAITING_AMOUNT',
        rangeChoice: 'USDG_DROP',
        dropPercent: 50,
        tokenChoice: usdgChoice,
      });
      return ctx.reply(
        `📉 <b>-50% Drop Range Selected (USDG Only)</b>\n\n` +
        `💵 Input desired amount of <b>USDG</b> to deposit (e.g. <code>100</code>):`,
        { parse_mode: 'HTML', reply_markup: cancelKeyboard() }
      );
    }

    if (rangeChoice === 'DROP_CUSTOM') {
      sessionStore.setSession(ctx.chat.id, {
        ...session,
        state: 'AWAITING_DROP_PERCENT',
        rangeChoice: 'USDG_DROP',
      });
      return ctx.reply(
        `✏️ <b>Custom Price Drop Range (USDG Only)</b>\n` +
        `Please input price drop percentage (e.g. <code>-50</code>, <code>-60</code>, <code>-30%</code>, or <code>50</code>):`,
        { parse_mode: 'HTML', reply_markup: cancelKeyboard() }
      );
    }

    if (rangeChoice === 'CUSTOM') {
      sessionStore.setSession(ctx.chat.id, {
        ...session,
        state: 'AWAITING_CUSTOM_RANGE',
        rangeChoice,
      });
      return ctx.reply(
        `✏️ <b>Custom Price Range</b>\n` +
        `Please send lower & upper price as text, e.g.:\n<code>0.95 1.05</code>`,
        { parse_mode: 'HTML', reply_markup: cancelKeyboard() }
      );
    }

    sessionStore.setSession(ctx.chat.id, {
      ...session,
      state: 'AWAITING_TOKEN_CHOICE',
      rangeChoice,
    });

    return ctx.reply(
      `🔀 Which token amount do you want to specify?`,
      {
        parse_mode: 'HTML',
        reply_markup: tokenSpecifyKeyboard(session.pool.token0.symbol, session.pool.token1.symbol),
      }
    );
  }

  // Open Position: Token Amount Choice
  if (data.startsWith('token_amt:')) {
    const session = sessionStore.getSession(ctx.chat.id);
    if (!session || session.flow !== 'OPEN_POSITION' || session.state !== 'AWAITING_TOKEN_CHOICE') {
      return ctx.reply('⚠️ Session expired or invalid. Please start again with /open.', { parse_mode: 'HTML' });
    }
    const tokenChoice = data.split(':')[1];
    const targetToken = tokenChoice === 'TOKEN0' ? session.pool.token0 : session.pool.token1;

    sessionStore.setSession(ctx.chat.id, {
      ...session,
      state: 'AWAITING_AMOUNT',
      tokenChoice,
    });

    return ctx.reply(
      `💵 Input desired amount of <b>${escapeHtml(targetToken.symbol)}</b> (e.g. <code>10</code> or <code>0.05</code>):`,
      { parse_mode: 'HTML', reply_markup: cancelKeyboard() }
    );
  }

  // Open Position: Confirm Mint
  if (data === 'mint:confirm') {
    const session = sessionStore.getSession(ctx.chat.id);
    if (!session || session.flow !== 'OPEN_POSITION' || session.state !== 'AWAITING_CONFIRM') {
      return ctx.reply('⚠️ Session expired or invalid. Please start again with /open.', { parse_mode: 'HTML' });
    }

    const loading = await ctx.reply('⏳ <i>Executing mint position on-chain...</i>', { parse_mode: 'HTML' });
    try {
      const res = await mintPosition({
        pool: session.pool,
        tickLower: session.quote.tickLower,
        tickUpper: session.quote.tickUpper,
        amount0Desired: session.quote.requiredAmount0,
        amount1Desired: session.quote.requiredAmount1,
      });

      await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
      sessionStore.clearSession(ctx.chat.id);

      if (res.status === 'DRY_RUN') {
        return ctx.reply(
          `🟡 <b>[DRY RUN COMPLETE]</b> Simulated transaction successfully!\n` +
          `No on-chain changes were made.`,
          { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() }
        );
      } else {
        return ctx.reply(
          `🎉 <b>[SUCCESS] Position Minted!</b>\n` +
          `NFT Token ID: <code>#${res.tokenId}</code>\n` +
          `Tx Hash: <code>${res.txHash}</code>`,
          { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() }
        );
      }
    } catch (err) {
      await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
      return ctx.reply(`❌ <b>Mint failed:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
    }
  }

  // Close Position: Select Position NFT
  if (data.startsWith('close_pos:')) {
    const tokenId = data.split(':')[1];
    const session = sessionStore.getSession(ctx.chat.id) || {};

    sessionStore.setSession(ctx.chat.id, {
      ...session,
      flow: 'CLOSE_POSITION',
      state: 'AWAITING_OPTION',
      tokenId,
    });

    return ctx.reply(
      `🔒 <b>Closing Position NFT #${tokenId}</b>\n\nSelect Close Action Option:`,
      {
        parse_mode: 'HTML',
        reply_markup: closeOptionsKeyboard(tokenId),
      }
    );
  }

  // Close Position: Option Selection
  if (data.startsWith('close_opt:')) {
    const [, option, tokenId] = data.split(':');
    const session = sessionStore.getSession(ctx.chat.id);

    sessionStore.setSession(ctx.chat.id, {
      ...session,
      state: 'AWAITING_CONFIRM',
      tokenId,
      closeOption: option,
    });

    const optText = option === 'A'
      ? 'Option A: Direct Withdraw (keep ETH & USDG in wallet)'
      : 'Option B: Auto-Swap non-USDG tokens directly to USDG';

    return ctx.reply(
      `⚠️ <b>CONFIRM CLOSE POSITION 100%</b>\n\n` +
      `Position NFT: <code>#${tokenId}</code>\n` +
      `Selected Option: <b>${optText}</b>\n\n` +
      `Are you sure you want to proceed?`,
      {
        parse_mode: 'HTML',
        reply_markup: confirmCloseKeyboard(tokenId, option),
      }
    );
  }

  // Close Position: Confirm Execution
  if (data.startsWith('confirm_close:')) {
    const [, option, tokenId] = data.split(':');
    const loading = await ctx.reply(`⏳ <i>Executing 100% decrease liquidity & collect for #${tokenId}...</i>`, { parse_mode: 'HTML' });

    try {
      const closeRes = await closePosition100(tokenId);
      await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
      sessionStore.clearSession(ctx.chat.id);

      let msg = '';
      if (closeRes.status === 'DRY_RUN') {
        msg += `🟡 <b>[DRY RUN COMPLETE]</b> Simulated 100% position close successfully!\n\n`;
      } else {
        msg += `✅ <b>[SUCCESS] Position #${tokenId} Closed 100%!</b>\nTx Hash: <code>${closeRes.txHash}</code>\n\n`;
      }

      // Handle Option B auto-swap
      if (option === 'B' && closeRes.details) {
        const targetPos = closeRes.details;
        const t0IsUsdg = targetPos.token0.symbol === 'USDG';
        const t1IsUsdg = targetPos.token1.symbol === 'USDG';

        if (!t0IsUsdg && targetPos.activeAmounts.amount0 > 0n) {
          msg += `🔄 Swapping ${targetPos.activeAmounts.formatted0} ${targetPos.token0.symbol} ➔ USDG...\n`;
          const swap0 = await swapToUsdg({
            tokenInAddress: targetPos.token0.address,
            amountIn: targetPos.activeAmounts.amount0,
          });
          msg += `Swap status: <code>${swap0.status}</code> (Tx: <code>${swap0.txHash}</code>)\n`;
        }

        if (!t1IsUsdg && targetPos.activeAmounts.amount1 > 0n) {
          msg += `🔄 Swapping ${targetPos.activeAmounts.formatted1} ${targetPos.token1.symbol} ➔ USDG...\n`;
          const swap1 = await swapToUsdg({
            tokenInAddress: targetPos.token1.address,
            amountIn: targetPos.activeAmounts.amount1,
          });
          msg += `Swap status: <code>${swap1.status}</code> (Tx: <code>${swap1.txHash}</code>)\n`;
        }
      }

      return ctx.reply(msg, { parse_mode: 'HTML', reply_markup: mainMenuKeyboard() });
    } catch (err) {
      await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
      return ctx.reply(`❌ <b>Close failed:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
    }
  }
}

export async function handleTextMessage(ctx) {
  const session = sessionStore.getSession(ctx.chat.id);
  const text = ctx.message.text.trim();

  // If text starts with 0x address or token symbol and no session active, start token discovery
  if (!session && (text.startsWith('0x') || text.toUpperCase() === 'USDG' || text.toUpperCase() === 'WETH')) {
    return processTokenDiscovery(ctx, text);
  }

  if (!session) return;

  if (session.flow === 'OPEN_POSITION') {
    if (session.state === 'AWAITING_TOKEN') {
      return processTokenDiscovery(ctx, text);
    }

    if (session.state === 'AWAITING_DROP_PERCENT') {
      const dropVal = parseDropPercent(text);
      if (!dropVal) {
        return ctx.reply('⚠️ Invalid percentage drop. Please input a number between 0 and 100 (e.g. <code>-50</code>, <code>-60</code>, <code>-30%</code>, or <code>50</code>)', { parse_mode: 'HTML' });
      }

      const usdgChoice = session.pool.token0.symbol === 'USDG' ? 'TOKEN0' : 'TOKEN1';
      sessionStore.setSession(ctx.chat.id, {
        ...session,
        state: 'AWAITING_AMOUNT',
        dropPercent: dropVal,
        tokenChoice: usdgChoice,
      });

      return ctx.reply(
        `📉 <b>-${dropVal}% Drop Range Set (USDG Only)</b>\n\n` +
        `💵 Input desired amount of <b>USDG</b> to deposit (e.g. <code>100</code>):`,
        { parse_mode: 'HTML', reply_markup: cancelKeyboard() }
      );
    }

    if (session.state === 'AWAITING_CUSTOM_RANGE') {
      const parts = text.split(/\s+/);
      if (parts.length !== 2) {
        return ctx.reply('⚠️ Please provide lower and upper price separated by a space (e.g. <code>0.95 1.05</code>)', { parse_mode: 'HTML' });
      }
      const customLower = parseFloat(parts[0]);
      const customUpper = parseFloat(parts[1]);
      if (isNaN(customLower) || isNaN(customUpper) || customLower >= customUpper) {
        return ctx.reply('⚠️ Invalid price bounds. Ensure Min Price < Max Price.', { parse_mode: 'HTML' });
      }

      sessionStore.setSession(ctx.chat.id, {
        ...session,
        state: 'AWAITING_TOKEN_CHOICE',
        customLower,
        customUpper,
      });

      return ctx.reply(
        `🔀 Which token amount do you want to specify?`,
        {
          parse_mode: 'HTML',
          reply_markup: tokenSpecifyKeyboard(session.pool.token0.symbol, session.pool.token1.symbol),
        }
      );
    }

    if (session.state === 'AWAITING_AMOUNT') {
      const targetToken = session.tokenChoice === 'TOKEN0' ? session.pool.token0 : session.pool.token1;
      let desiredAmount0 = 0n;
      let desiredAmount1 = 0n;

      try {
        if (session.tokenChoice === 'TOKEN0') {
          desiredAmount0 = parseTokenAmount(text, session.pool.token0.decimals);
        } else {
          desiredAmount1 = parseTokenAmount(text, session.pool.token1.decimals);
        }
      } catch {
        return ctx.reply(`⚠️ Invalid token amount string <code>${escapeHtml(text)}</code>`, { parse_mode: 'HTML' });
      }

      const loading = await ctx.reply('⏳ <i>Calculating quote & fee breakdown...</i>', { parse_mode: 'HTML' });

      try {
        const quote = await quoteOpenPosition({
          pool: session.pool,
          rangeChoice: session.rangeChoice,
          customLowerPrice: session.customLower,
          customUpperPrice: session.customUpper,
          dropPercent: session.dropPercent,
          desiredAmount0,
          desiredAmount1,
        });

        await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });

        sessionStore.setSession(ctx.chat.id, {
          ...session,
          state: 'AWAITING_CONFIRM',
          amountStr: text,
          quote,
        });

        const previewText = formatQuotePreview(quote, session.pool);
        return ctx.reply(previewText, {
          parse_mode: 'HTML',
          reply_markup: confirmMintKeyboard(),
        });
      } catch (err) {
        await ctx.api.deleteMessage(ctx.chat.id, loading.message_id).catch(() => { });
        return ctx.reply(`❌ <b>Quote error:</b> <code>${escapeHtml(err.message)}</code>`, { parse_mode: 'HTML' });
      }
    }
  }
}
