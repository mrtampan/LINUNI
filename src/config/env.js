import dotenv from 'dotenv';
import path from 'path';
import { getAddress, isAddress } from 'viem';
import { RH_CHAIN_ID, RH_DEFAULT_RPC } from './constants.js';

dotenv.config();

export function getEnv() {
  const chainId = parseInt(process.env.RH_CHAIN_ID || String(RH_CHAIN_ID), 10);
  
  const rpcUrl = process.env.RH_RPC_URL?.trim() || RH_DEFAULT_RPC;
  const alchemyRpc = process.env.ALCHEMY_RPC_URL?.trim() || null;
  const quicknodeRpc = process.env.QUICKNODE_RPC_URL?.trim() || null;

  // Prioritize fast third-party RPCs (Alchemy/QuickNode) or explicitly configured custom RPCs over default public RPC
  const customRpcs = [alchemyRpc, quicknodeRpc].filter(Boolean);
  const rpcUrls = Array.from(new Set([...customRpcs, rpcUrl, RH_DEFAULT_RPC])).filter(Boolean);

  let privateKey = process.env.PRIVATE_KEY?.trim() || null;
  if (privateKey && !privateKey.startsWith('0x')) {
    privateKey = `0x${privateKey}`;
  }

  let walletAddress = process.env.WALLET_ADDRESS?.trim() || null;
  if (walletAddress && isAddress(walletAddress)) {
    walletAddress = getAddress(walletAddress);
  }

  const dataDir = process.env.DATA_DIR?.trim() || './data';
  const dryRun = process.env.DRY_RUN !== 'false'; // Default to true unless explicitly false
  const executionEnabled = process.env.EXECUTION_ENABLED !== 'false';
  const maxGasCostUsd = parseFloat(process.env.MAX_GAS_COST_USD || '2.00');
  const defaultSlippageBps = parseInt(process.env.DEFAULT_SLIPPAGE_BPS || '100', 10); // 1.0% default

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const telegramAllowedChats = process.env.TELEGRAM_ALLOWED_CHATS
    ? process.env.TELEGRAM_ALLOWED_CHATS.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  return {
    chainId,
    rpcUrls,
    privateKey,
    walletAddress,
    dataDir: path.resolve(dataDir),
    dryRun,
    executionEnabled,
    maxGasCostUsd,
    defaultSlippageBps,
    telegramBotToken,
    telegramAllowedChats,
  };
}
