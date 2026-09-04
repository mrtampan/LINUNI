import { formatUnits, getAddress, isAddress, parseAbiItem, zeroAddress } from 'viem';
import { CONTRACTS, CONTRACTS_V4, ERC20_ABI, FACTORY_ABI, FEE_TIERS, POOL_ABI, TOKENS } from '../config/constants.js';
import { formatCompactUsd } from '../utils/formatter.js';
import { priceFromSqrtX96 } from '../utils/math.js';
import { db } from './json-db.js';
import { getPublicClient } from './rpc.js';
import { inspectPoolV4 } from './v4.js';

function withTimeout(promise, ms = 3500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('RPC query timeout')), ms)),
  ]);
}

export async function calculatePoolStats(pool, client, fromBlock) {
  let tvlUsd = 0;
  let volume24hUsd = 0;

  try {
    if (pool.version === 'V3') {
      const [bal0, bal1] = await Promise.all([
        client.readContract({ address: pool.token0.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [pool.address] }).catch(() => 0n),
        client.readContract({ address: pool.token1.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [pool.address] }).catch(() => 0n),
      ]);
      const amt0 = Number(formatUnits(bal0, pool.token0.decimals));
      const amt1 = Number(formatUnits(bal1, pool.token1.decimals));

      if (pool.token0.symbol === 'USDG') {
        tvlUsd = amt0 + amt1 * pool.priceToken0PerToken1;
      } else if (pool.token1.symbol === 'USDG') {
        tvlUsd = amt1 + amt0 * pool.priceToken1PerToken0;
      } else {
        tvlUsd = amt0 * (pool.priceToken1PerToken0 || 1) + amt1;
      }

      const v3SwapEvent = parseAbiItem('event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)');
      const logs = await withTimeout(client.getLogs({
        address: pool.address,
        event: v3SwapEvent,
        fromBlock,
        toBlock: 'latest',
      })).catch(() => []);

      for (const log of logs) {
        const raw0 = log.args.amount0 < 0n ? -log.args.amount0 : log.args.amount0;
        const raw1 = log.args.amount1 < 0n ? -log.args.amount1 : log.args.amount1;
        const a0 = Number(formatUnits(raw0, pool.token0.decimals));
        const a1 = Number(formatUnits(raw1, pool.token1.decimals));
        if (pool.token0.symbol === 'USDG') volume24hUsd += a0;
        else if (pool.token1.symbol === 'USDG') volume24hUsd += a1;
        else volume24hUsd += a0 * (pool.priceToken1PerToken0 || 1);
      }
    } else if (pool.version === 'V4') {
      const [bal0, bal1] = await Promise.all([
        client.readContract({ address: pool.token0.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [CONTRACTS_V4.POOL_MANAGER] }).catch(() => 0n),
        client.readContract({ address: pool.token1.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [CONTRACTS_V4.POOL_MANAGER] }).catch(() => 0n),
      ]);
      const amt0 = Number(formatUnits(bal0, pool.token0.decimals));
      const amt1 = Number(formatUnits(bal1, pool.token1.decimals));

      if (pool.token0.symbol === 'USDG') {
        tvlUsd = amt0 + amt1 * pool.priceToken0PerToken1;
      } else if (pool.token1.symbol === 'USDG') {
        tvlUsd = amt1 + amt0 * pool.priceToken1PerToken0;
      } else {
        tvlUsd = amt0 * (pool.priceToken1PerToken0 || 1) + amt1;
      }

      const v4SwapEvent = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)');
      const logs = await withTimeout(client.getLogs({
        address: CONTRACTS_V4.POOL_MANAGER,
        event: v4SwapEvent,
        args: { id: pool.poolId },
        fromBlock,
        toBlock: 'latest',
      })).catch(() => []);

      for (const log of logs) {
        const raw0 = log.args.amount0 < 0n ? -log.args.amount0 : BigInt(log.args.amount0);
        const raw1 = log.args.amount1 < 0n ? -log.args.amount1 : BigInt(log.args.amount1);
        const a0 = Number(formatUnits(raw0, pool.token0.decimals));
        const a1 = Number(formatUnits(raw1, pool.token1.decimals));
        if (pool.token0.symbol === 'USDG') volume24hUsd += a0;
        else if (pool.token1.symbol === 'USDG') volume24hUsd += a1;
        else volume24hUsd += a0 * (pool.priceToken1PerToken0 || 1);
      }
    }
  } catch {
    // Ignore stats errors
  }

  return {
    ...pool,
    tvlUsd,
    volume24hUsd,
    formattedTvl: formatCompactUsd(tvlUsd),
    formattedVolume24h: formatCompactUsd(volume24hUsd),
  };
}

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

  const latestBlock = await client.getBlockNumber().catch(() => 54000000n);
  const fromBlock = latestBlock > 15000n ? latestBlock - 15000n : 0n;

  // 1. Check Uniswap V3 Pools across standard fee tiers in parallel
  const v3PoolPromises = [];
  for (const quote of quoteTokens) {
    if (quote.address.toLowerCase() === targetToken.address.toLowerCase()) continue;
    for (const tier of FEE_TIERS) {
      v3PoolPromises.push(
        inspectPool(targetToken.address, quote.address, tier.fee)
          .then(poolV3 => {
            if (poolV3 && poolV3.initialized) {
              return { ...poolV3, version: 'V3', feeLabel: `${tier.label} [V3]` };
            }
            return null;
          })
          .catch(() => null)
      );
    }
  }

  const v3Results = await Promise.all(v3PoolPromises);
  for (const poolV3 of v3Results) {
    if (poolV3) pools.push(poolV3);
  }

  // 2. Discover Uniswap V4 Pools (Check standard fee tiers in parallel + Event logs fallback)
  const v4PoolPromises = [];
  for (const quote of quoteTokens) {
    if (quote.address.toLowerCase() === targetToken.address.toLowerCase()) continue;
    for (const tier of FEE_TIERS) {
      v4PoolPromises.push(
        inspectPoolV4(targetToken.address, quote.address, tier.fee, tier.tickSpacing, CONTRACTS_V4.ZERO_HOOK)
          .then(poolV4 => {
            if (poolV4 && poolV4.initialized) {
              const feePercentStr = (tier.fee / 10000).toFixed(2) + '%';
              return { ...poolV4, version: 'V4', feeLabel: `${feePercentStr} [V4]` };
            }
            return null;
          })
          .catch(() => null)
      );
    }
  }

  const v4Results = await Promise.all(v4PoolPromises);
  for (const poolV4 of v4Results) {
    if (poolV4 && !poolIdsSeen.has(poolV4.poolId)) {
      poolIdsSeen.add(poolV4.poolId);
      pools.push(poolV4);
    }
  }

  // Fallback: Query PoolManager Initialize event logs for custom V4 pools
  const initializeEvent = parseAbiItem('event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)');
  try {
    const [logs0, logs1] = await Promise.all([
      withTimeout(client.getLogs({
        address: CONTRACTS_V4.POOL_MANAGER,
        event: initializeEvent,
        args: { currency0: targetToken.address },
        fromBlock,
        toBlock: 'latest',
      }), 2000).catch(() => []),
      withTimeout(client.getLogs({
        address: CONTRACTS_V4.POOL_MANAGER,
        event: initializeEvent,
        args: { currency1: targetToken.address },
        fromBlock,
        toBlock: 'latest',
      }), 2000).catch(() => []),
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

  // 3. Enrich all discovered pools with TVL and 24h Volume statistics concurrently
  const poolsWithStats = await Promise.all(pools.map(p => calculatePoolStats(p, client, fromBlock)));

  return {
    token: targetToken,
    pools: poolsWithStats,
  };
}


