import { Bot } from 'grammy';
import picocolors from 'picocolors';
import { getEnv } from '../config/env.js';
import { getPnlSummary } from '../services/pnl.js';
import {
  autoPnlChats,
  handleAutoPnlCommand,
  handleCancelCommand,
  handleCallbackQuery,
  handleConfigCommand,
  handleHelp,
  handleHistoryCommand,
  handleOpenCommand,
  handlePnlCommand,
  handlePositionsCommand,
  handleStart,
  handleTextMessage,
  handleWalletCommand,
} from './commands.js';
import { formatPnlCard } from './formatters.js';

const BOT_COMMAND_MENU = [
  { command: 'start', description: 'Start bot & show main menu' },
  { command: 'help', description: 'Show command guide & safety info' },
  { command: 'wallet', description: 'Check wallet balances & approvals' },
  { command: 'positions', description: 'Inspect LP positions & uncollected fees' },
  { command: 'pnl', description: 'Check instant LP portfolio PnL report' },
  { command: 'autopnl', description: 'Toggle auto 10-minute PnL updates' },
  { command: 'open', description: 'Open new Uniswap V3 LP position' },
  { command: 'close', description: 'Close 100% LP position (Withdraw / Swap)' },
  { command: 'history', description: 'View recorded transaction history' },
  { command: 'config', description: 'View system, RPC & safety configuration' },
  { command: 'cancel', description: 'Cancel active interaction flow' },
];

let autoPnlTimer = null;

export async function startBot(options = {}) {
  const { silent = false } = options;
  const env = getEnv();

  if (!env.telegramBotToken) {
    if (!silent) {
      console.error(picocolors.red('\n[FATAL ERROR] TELEGRAM_BOT_TOKEN is not set in environment or .env file!'));
      console.error(picocolors.yellow('Please set TELEGRAM_BOT_TOKEN=your_bot_token in your .env file to run the bot.\n'));
      process.exit(1);
    }
    return false;
  }

  if (!silent) {
    console.log(picocolors.cyan('==============================================================='));
    console.log(picocolors.bold(picocolors.magenta('        LINUNI — Robinhood Telegram LP Bot Starting        ')));
    console.log(picocolors.cyan('==============================================================='));
    console.log(picocolors.dim(`Chain ID: ${picocolors.yellow(env.chainId)} | Mode: ${env.dryRun ? picocolors.yellow('[DRY RUN / SIMULATION]') : picocolors.green('[LIVE ON-CHAIN]')}`));
    console.log(picocolors.dim(`RPC: ${env.rpcUrls[0]}`));
    if (env.telegramAllowedChats.length > 0) {
      console.log(picocolors.dim(`Security Filter: Allowed Chats = [${env.telegramAllowedChats.join(', ')}]`));
    } else {
      console.log(picocolors.dim('Security Filter: All Users/Chats Allowed (Configure TELEGRAM_ALLOWED_CHATS to restrict)'));
    }
    console.log(picocolors.cyan('---------------------------------------------------------------\n'));
  }

  const bot = new Bot(env.telegramBotToken);

  // Security Check Middleware: Restrict access to authorized chat IDs if TELEGRAM_ALLOWED_CHATS is set
  bot.use(async (ctx, next) => {
    if (env.telegramAllowedChats.length > 0) {
      const chatId = String(ctx.chat?.id || '');
      const userId = String(ctx.from?.id || '');
      const isAllowed = env.telegramAllowedChats.includes(chatId) || env.telegramAllowedChats.includes(userId);
      if (!isAllowed) {
        console.warn(`[UNAUTHORIZED ATTEMPT] User/Chat ID ${userId || chatId} tried to access bot.`);
        return ctx.reply('⛔ <b>Access Denied:</b> You are not authorized to use this bot.', { parse_mode: 'HTML' });
      }
    }
    return next();
  });

  // Set Bot Command Menu in Telegram client
  await bot.api.setMyCommands(BOT_COMMAND_MENU).catch(err => {
    console.warn(picocolors.yellow(`Could not set Telegram command menu: ${err.message}`));
  });

  // Register command routes
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('wallet', handleWalletCommand);
  bot.command('positions', handlePositionsCommand);
  bot.command('pnl', handlePnlCommand);
  bot.command('autopnl', handleAutoPnlCommand);
  bot.command('open', ctx => handleOpenCommand(ctx));
  bot.command('close', ctx => handleCloseCommand(ctx));
  bot.command('history', handleHistoryCommand);
  bot.command('config', handleConfigCommand);
  bot.command('cancel', handleCancelCommand);

  // Callback query routes (Inline button clicks)
  bot.on('callback_query:data', handleCallbackQuery);

  // Text message handler (for multi-step wizard input & direct token address paste)
  bot.on('message:text', handleTextMessage);

  // Setup 10-minute Auto PnL background interval (600,000 ms)
  if (!autoPnlTimer) {
    autoPnlTimer = setInterval(async () => {
      if (autoPnlChats.size === 0) return;
      try {
        const pnl = await getPnlSummary();
        const cardText = `⏱️ <b>[10-MINUTE AUTO PnL REPORT]</b>\n\n` + formatPnlCard(pnl);
        for (const chatId of autoPnlChats) {
          bot.api.sendMessage(chatId, cardText, { parse_mode: 'HTML' }).catch(err => {
            console.warn(`[Auto-PnL Error] Failed to send to ${chatId}: ${err.message}`);
          });
        }
      } catch (err) {
        console.warn(`[Auto-PnL Error] ${err.message}`);
      }
    }, 10 * 60 * 1000);
  }

  // Global Error Handler
  bot.catch(err => {
    console.error(picocolors.red(`[BOT ERROR] ${err.message}`), err);
  });

  if (!silent) {
    console.log(picocolors.green('🤖 Telegram Bot is active and polling for updates... Press Ctrl+C to stop.\n'));
  }
  await bot.start();
  return true;
}

// Auto-run if executed directly
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  startBot().catch(err => {
    console.error(picocolors.red(`Fatal Bot Error: ${err.message}`));
    process.exit(1);
  });
}

