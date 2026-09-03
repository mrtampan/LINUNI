import { createPublicClient, createWalletClient, http, fallback } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { RH_CHAIN_ID, RH_CHAIN_NAME, CONTRACTS } from '../config/constants.js';
import { getEnv } from '../config/env.js';

export function getRobinhoodChainDef() {
  const env = getEnv();
  return {
    id: env.chainId || RH_CHAIN_ID,
    name: RH_CHAIN_NAME,
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: env.rpcUrls },
      public: { http: env.rpcUrls },
    },
    contracts: {
      multicall3: {
        address: CONTRACTS.MULTICALL3,
      },
    },
  };
}

let publicClientInstance = null;

export function getPublicClient() {
  if (publicClientInstance) return publicClientInstance;

  const chain = getRobinhoodChainDef();
  const env = getEnv();

  const transports = env.rpcUrls.map(url => http(url, { timeout: 10_000, retryCount: 2 }));
  const transport = transports.length > 1 ? fallback(transports) : transports[0];

  publicClientInstance = createPublicClient({
    chain,
    transport,
    batch: {
      multicall: true,
    },
  });

  return publicClientInstance;
}

export function getWalletClient() {
  const env = getEnv();
  if (!env.privateKey) {
    throw new Error('PRIVATE_KEY is not set in environment variables. Execution required private key.');
  }

  const account = privateKeyToAccount(env.privateKey);
  const chain = getRobinhoodChainDef();

  const transports = env.rpcUrls.map(url => http(url, { timeout: 15_000, retryCount: 1 }));
  const transport = transports.length > 1 ? fallback(transports) : transports[0];

  return createWalletClient({
    account,
    chain,
    transport,
  });
}

export function getAccount() {
  const env = getEnv();
  if (!env.privateKey) return null;
  return privateKeyToAccount(env.privateKey);
}
