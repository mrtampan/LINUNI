import { getAddress, isAddress, parseAbiItem, zeroAddress } from 'viem';
import { CONTRACTS, CONTRACTS_V4, ERC20_ABI, FACTORY_ABI, FEE_TIERS, POOL_ABI, TOKENS } from '../config/constants.js';
import { priceFromSqrtX96 } from '../utils/math.js';
import { db } from './json-db.js';
import { getPublicClient } from './rpc.js';
import { inspectPoolV4 } from './v4.js';

export async function inspectToken(tokenAddress) {
  if (!tokenAddress || !isAddress(tokenAddress)) {
    throw new Error(`Invalid token address: ${tokenAddress}`);
  }
  const cleanAddr = getAddress(tokenAddress);
  const client = getPublicClient();

  if (cleanAddr.toLowerCase() === zeroAddress.toLowerCase()) {
    return {
      address: zeroAddress,
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18,
      isNative: true,
    };
  }

  // Pre-configured tokens
  if (cleanAddr.toLowerCase() === TOKENS.WETH.address.toLowerCase()) return TOKENS.WETH;
  if (cleanAddr.toLowerCase() === TOKENS.USDG.address.toLowerCase()) return TOKENS.USDG;

  try {
    const [symbol, name, decimals] = await Promise.all([
      client.readContract({ address: cleanAddr, abi: ERC20_ABI, functionName: 'symbol' }),
      client.readContract({ address: cleanAddr, abi: ERC20_ABI, functionName: 'name' }),
      client.readContract({ address: cleanAddr, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);

    return {
      address: cleanAddr,
      symbol,
      name,
      decimals: Number(decimals),
      isNative: false,
    };
  } catch (error) {
    throw new Error(`Failed to inspect ERC20 token at ${cleanAddr}: ${error.message}`);
  }
}

export async function inspectPool(tokenA, tokenB, fee) {
  const client = getPublicClient();
  const addrA = getAddress(tokenA);
  const addrB = getAddress(tokenB);

  const poolAddress = await client.readContract({
    address: CONTRACTS.FACTORY,
    abi: FACTORY_ABI,
    functionName: 'getPool',
    args: [addrA, addrB, fee],
  });

  if (!poolAddress || poolAddress === zeroAddress) {
    return null; // Pool does not exist for this fee tier
  }

  const [slot0, liquidity, token0Address, token1Address, tickSpacing] = await Promise.all([
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'slot0' }),
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'liquidity' }),
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'token0' }),
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'token1' }),
    client.readContract({ address: poolAddress, abi: POOL_ABI, functionName: 'tickSpacing' }),
  ]);

  const [t0, t1] = await Promise.all([
    inspectToken(token0Address),
    inspectToken(token1Address),
  ]);

  const sqrtPriceX96 = slot0[0];
  const tick = Number(slot0[1]);
  const priceToken1PerToken0 = priceFromSqrtX96(sqrtPriceX96, t0.decimals, t1.decimals);
  const priceToken0PerToken1 = priceToken1PerToken0 > 0 ? 1 / priceToken1PerToken0 : 0;

  const poolState = {
    version: 'V3',
    address: poolAddress,
    factory: CONTRACTS.FACTORY,
    fee,
    tickSpacing: Number(tickSpacing),
    token0: t0,
    token1: t1,
    sqrtPriceX96,
    tick,
    liquidity,
    priceToken1PerToken0,
    priceToken0PerToken1,
    initialized: sqrtPriceX96 > 0n,
  };

  db.savePoolToCache(`${addrA}_${addrB}_${fee}`, poolState);
  return poolState;
}

export async function discoverPoolsForToken(tokenInput) {
  let targetToken;
  try {
    targetToken = await inspectToken(tokenInput);
  } catch (err) {
    throw new Error(`Token invalid: ${err.message}`);
  }

  const client = getPublicClient();
  const quoteTokens = [TOKENS.WETH, TOKENS.USDG];
  const pools = [];
  const poolIdsSeen = new Set();

  // 1. Check Uniswap V3 Pools across standard fee tiers
  for (const quote of quoteTokens) {
    if (quote.address.toLowerCase() === targetToken.address.toLowerCase()) continue;

    for (const tier of FEE_TIERS) {
      try {
        const poolV3 = await inspectPool(targetToken.address, quote.address, tier.fee);
        if (poolV3 && poolV3.initialized) {
          pools.push({
            ...poolV3,
            version: 'V3',
            feeLabel: `${tier.label} [V3]`,
          });
        }
      } catch {
        // Ignore uninitialized V3 pools
      }
    }
  }

  // 2. Discover Uniswap V4 Pools by querying PoolManager Initialize event logs
  const initializeEvent = parseAbiItem('event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)');

  try {
    const latestBlock = await client.getBlockNumber().catch(() => 53000000n);
    const fromBlock = latestBlock > 300000n ? latestBlock - 300000n : 0n;

    const [logs0, logs1] = await Promise.all([
      client.getLogs({
        address: CONTRACTS_V4.POOL_MANAGER,
        event: initializeEvent,
        args: { currency0: targetToken.address },
        fromBlock,
        toBlock: 'latest',
      }).catch(() => []),
      client.getLogs({
        address: CONTRACTS_V4.POOL_MANAGER,
        event: initializeEvent,
        args: { currency1: targetToken.address },
        fromBlock,
        toBlock: 'latest',
      }).catch(() => []),
    ]);

    const v4Logs = [...logs0, ...logs1];
    for (const log of v4Logs) {
      const pId = log.args.id;
      if (poolIdsSeen.has(pId)) continue;
      poolIdsSeen.add(pId);

      const currency0 = log.args.currency0;
      const currency1 = log.args.currency1;
      const fee = Number(log.args.fee);
      const tickSpacing = Number(log.args.tickSpacing);
      const hooks = log.args.hooks || CONTRACTS_V4.ZERO_HOOK;

      try {
        const poolV4 = await inspectPoolV4(currency0, currency1, fee, tickSpacing, hooks);
        if (poolV4 && poolV4.initialized) {
          const feePercentStr = (fee / 10000).toFixed(2) + '%';
          pools.push({
            ...poolV4,
            version: 'V4',
            feeLabel: `${feePercentStr} [V4]`,
          });
        }
      } catch {
        // ignore errors
      }
    }
  } catch {
    // Fall back if getLogs fails
  }


  return {
    token: targetToken,
    pools,
  };
}


