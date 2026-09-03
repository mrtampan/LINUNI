import { getAddress, isAddress, padHex, parseAbi, toHex, zeroAddress } from 'viem';
import { CONTRACTS_V4, computeV4PoolId } from '../config/constants.js';
import { formatTokenAmount } from '../utils/formatter.js';
import { amountsForLiquidity, priceFromSqrtX96, sqrtRatioAtTick } from '../utils/math.js';
import { db } from './json-db.js';
import { inspectToken } from './pool.js';
import { getPublicClient } from './rpc.js';

export const V4_STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
  'function getFeeGrowthInside(bytes32 poolId, int24 tickLower, int24 tickUpper) view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128)',
  'function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)',
]);

export const V4_POSITION_MANAGER_ABI = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address owner)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)',
  'function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 positionInfo)',
  'function modifyLiquidities(bytes unlockData, uint256 deadline) payable',
]);

export async function inspectPoolV4(tokenA, tokenB, fee, tickSpacing = 60, hooks = CONTRACTS_V4.ZERO_HOOK) {
  const client = getPublicClient();
  const addrA = getAddress(tokenA);
  const addrB = getAddress(tokenB);

  const [t0, t1] = addrA.toLowerCase() < addrB.toLowerCase()
    ? await Promise.all([inspectToken(addrA), inspectToken(addrB)])
    : await Promise.all([inspectToken(addrB), inspectToken(addrA)]);

  const poolId = computeV4PoolId(t0.address, t1.address, fee, tickSpacing, hooks);

  let slot0, liquidity;
  try {
    [slot0, liquidity] = await Promise.all([
      client.readContract({
        address: CONTRACTS_V4.STATE_VIEW,
        abi: V4_STATE_VIEW_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      }),
      client.readContract({
        address: CONTRACTS_V4.STATE_VIEW,
        abi: V4_STATE_VIEW_ABI,
        functionName: 'getLiquidity',
        args: [poolId],
      }),
    ]);
  } catch {
    return null; // Pool not initialized or contract not found
  }

  const sqrtPriceX96 = slot0[0];
  const tick = Number(slot0[1]);

  if (sqrtPriceX96 === 0n) {
    return null; // Uninitialized
  }

  const priceToken1PerToken0 = priceFromSqrtX96(sqrtPriceX96, t0.decimals, t1.decimals);
  const priceToken0PerToken1 = priceToken1PerToken0 > 0 ? 1 / priceToken1PerToken0 : 0;

  const poolState = {
    version: 'V4',
    address: CONTRACTS_V4.POOL_MANAGER,
    poolId,
    fee,
    tickSpacing,
    hooks,
    token0: t0,
    token1: t1,
    sqrtPriceX96,
    tick,
    liquidity,
    priceToken1PerToken0,
    priceToken0PerToken1,
    initialized: true,
  };

  db.savePoolToCache(`v4_${t0.address}_${t1.address}_${fee}`, poolState);
  return poolState;
}

export async function getPositionDetailsV4(tokenId) {
  const client = getPublicClient();
  const id = BigInt(tokenId);

  let owner = zeroAddress;
  let poolKey, positionInfoRaw, liquidity;

  try {
    const [ownerRes, infoRes, liqRes] = await Promise.all([
      client.readContract({ address: CONTRACTS_V4.POSITION_MANAGER, abi: V4_POSITION_MANAGER_ABI, functionName: 'ownerOf', args: [id] }),
      client.readContract({ address: CONTRACTS_V4.POSITION_MANAGER, abi: V4_POSITION_MANAGER_ABI, functionName: 'getPoolAndPositionInfo', args: [id] }),
      client.readContract({ address: CONTRACTS_V4.POSITION_MANAGER, abi: V4_POSITION_MANAGER_ABI, functionName: 'getPositionLiquidity', args: [id] }),
    ]);
    owner = ownerRes;
    poolKey = infoRes[0];
    positionInfoRaw = infoRes[1];
    liquidity = liqRes;
  } catch (err) {
    throw new Error(`Failed to fetch V4 position #${tokenId}: ${err.message}`);
  }

  const signed24 = (x) => {
    const n = Number(BigInt(x) & 0xffffffn);
    return n & 0x800000 ? n - 0x1000000 : n;
  };

  const tickLower = signed24(positionInfoRaw >> 8n);
  const tickUpper = signed24(positionInfoRaw >> 32n);
  const fee = Number(poolKey.fee);
  const tickSpacing = Number(poolKey.tickSpacing);

  const [t0, t1, poolState] = await Promise.all([
    inspectToken(poolKey.currency0),
    inspectToken(poolKey.currency1),
    inspectPoolV4(poolKey.currency0, poolKey.currency1, fee, tickSpacing, poolKey.hooks),
  ]);

  const sqrtLower = sqrtRatioAtTick(tickLower);
  const sqrtUpper = sqrtRatioAtTick(tickUpper);

  const activeAmounts = poolState && poolState.initialized
    ? amountsForLiquidity(poolState.sqrtPriceX96, sqrtLower, sqrtUpper, liquidity)
    : { amount0: 0n, amount1: 0n };

  const inRange = poolState && poolState.initialized
    ? poolState.tick >= tickLower && poolState.tick < tickUpper
    : false;

  const lowerPrice = priceFromSqrtX96(sqrtLower, t0.decimals, t1.decimals);
  const upperPrice = priceFromSqrtX96(sqrtUpper, t0.decimals, t1.decimals);
  const currentPrice = poolState ? poolState.priceToken1PerToken0 : 0;

  let tokensOwed0 = 0n;
  let tokensOwed1 = 0n;

  if (poolState && poolState.poolId) {
    try {
      const salt = padHex(toHex(id), { size: 32 });
      const [growthCurrent, posInfo] = await Promise.all([
        client.readContract({
          address: CONTRACTS_V4.STATE_VIEW,
          abi: V4_STATE_VIEW_ABI,
          functionName: 'getFeeGrowthInside',
          args: [poolState.poolId, tickLower, tickUpper],
        }),
        client.readContract({
          address: CONTRACTS_V4.STATE_VIEW,
          abi: V4_STATE_VIEW_ABI,
          functionName: 'getPositionInfo',
          args: [poolState.poolId, CONTRACTS_V4.POSITION_MANAGER, tickLower, tickUpper, salt],
        }),
      ]);

      const Q128 = 2n ** 128n;
      const Q256 = 2n ** 256n;

      const current0 = growthCurrent[0];
      const current1 = growthCurrent[1];

      const posLiquidity = posInfo[0];
      const last0 = posInfo[1];
      const last1 = posInfo[2];

      if (posLiquidity > 0n) {
        const delta0 = current0 >= last0 ? current0 - last0 : Q256 + current0 - last0;
        const delta1 = current1 >= last1 ? current1 - last1 : Q256 + current1 - last1;

        tokensOwed0 = (posLiquidity * delta0) / Q128;
        tokensOwed1 = (posLiquidity * delta1) / Q128;
      }
    } catch {
      // Ignore fallback if fee query fails
    }
  }

  const details = {
    version: 'V4',
    tokenId: id.toString(),
    owner,
    fee,
    feePercent: (fee / 10000).toFixed(2) + '%',
    tickLower,
    tickUpper,
    liquidity: liquidity.toString(),
    liquidityRaw: liquidity,
    inRange,
    token0: t0,
    token1: t1,
    lowerPrice,
    upperPrice,
    currentPrice,
    activeAmounts: {
      amount0: activeAmounts.amount0,
      amount1: activeAmounts.amount1,
      formatted0: formatTokenAmount(activeAmounts.amount0, t0.decimals),
      formatted1: formatTokenAmount(activeAmounts.amount1, t1.decimals),
    },
    uncollectedFees: {
      tokensOwed0,
      tokensOwed1,
      formatted0: formatTokenAmount(tokensOwed0, t0.decimals),
      formatted1: formatTokenAmount(tokensOwed1, t1.decimals),
    },
    pool: poolState,
  };

  db.savePosition(details);
  return details;
}
