import { encodeAbiParameters, encodeFunctionData, parseAbi } from 'viem';
import { CONTRACTS, CONTRACTS_V4, ERC20_ABI, MAX_TICK, MIN_TICK, POSITION_MANAGER_ABI } from '../config/constants.js';
import { getEnv } from '../config/env.js';
import { formatPrice, formatTokenAmount, formatUsd } from '../utils/formatter.js';
import { amountsForLiquidity, liquidityForAmounts, nearestUsableTick, priceFromSqrtX96, rangeFromDropPercent, rangeFromPercent, sqrtRatioAtTick, tickAtPrice } from '../utils/math.js';
import { db } from './json-db.js';
import { getPositionDetails } from './position.js';
import { getAccount, getPublicClient, getWalletClient } from './rpc.js';
import { approveToken, checkAllowance, ensureV4Permit2Allowance } from './wallet.js';

export const V4_POSITION_MANAGER_ABI = parseAbi([
  'function modifyLiquidities(bytes unlockData, uint256 deadline) payable',
]);

const poolKeyParam = {
  type: 'tuple',
  components: [
    { type: 'address', name: 'currency0' },
    { type: 'address', name: 'currency1' },
    { type: 'uint24', name: 'fee' },
    { type: 'int24', name: 'tickSpacing' },
    { type: 'address', name: 'hooks' },
  ],
};

const mintParamTypes = [
  poolKeyParam,
  { type: 'int24', name: 'tickLower' },
  { type: 'int24', name: 'tickUpper' },
  { type: 'uint256', name: 'liquidity' },
  { type: 'uint128', name: 'amount0Max' },
  { type: 'uint128', name: 'amount1Max' },
  { type: 'address', name: 'owner' },
  { type: 'bytes', name: 'hookData' },
];

const pairParamTypes = [
  { type: 'address', name: 'currency0' },
  { type: 'address', name: 'currency1' },
];

export function prepareRangeTicks(pool, rangeChoice, customLowerPrice = null, customUpperPrice = null, dropPercent = null) {
  const currentPrice = pool.priceToken1PerToken0;
  const t0 = pool.token0;
  const t1 = pool.token1;
  const spacing = pool.tickSpacing;

  let tickLower, tickUpper;

  if (rangeChoice === 'USDG_DROP' || rangeChoice === 'DROP_PERCENT' || dropPercent !== null) {
    return rangeFromDropPercent(pool, dropPercent || 50);
  } else if (rangeChoice === 'FULL') {
    tickLower = MIN_TICK - (MIN_TICK % spacing);
    tickUpper = MAX_TICK - (MAX_TICK % spacing);
  } else if (rangeChoice === 'NARROW') {
    const range = rangeFromPercent(currentPrice, 5, t0.decimals, t1.decimals, spacing);
    tickLower = range.tickLower;
    tickUpper = range.tickUpper;
  } else if (rangeChoice === 'MEDIUM') {
    const range = rangeFromPercent(currentPrice, 10, t0.decimals, t1.decimals, spacing);
    tickLower = range.tickLower;
    tickUpper = range.tickUpper;
  } else if (rangeChoice === 'WIDE') {
    const range = rangeFromPercent(currentPrice, 20, t0.decimals, t1.decimals, spacing);
    tickLower = range.tickLower;
    tickUpper = range.tickUpper;
  } else if (rangeChoice === 'CUSTOM') {
    if (!customLowerPrice || !customUpperPrice || customLowerPrice >= customUpperPrice) {
      throw new Error('Custom lower price must be less than custom upper price');
    }
    const rawLower = tickAtPrice(customLowerPrice, t0.decimals, t1.decimals);
    const rawUpper = tickAtPrice(customUpperPrice, t0.decimals, t1.decimals);
    tickLower = nearestUsableTick(rawLower, spacing);
    tickUpper = nearestUsableTick(rawUpper, spacing);
    if (tickLower >= tickUpper) {
      tickUpper = tickLower + spacing;
    }
  } else {
    throw new Error(`Unknown range choice: ${rangeChoice}`);
  }

  const sqrtLower = sqrtRatioAtTick(tickLower);
  const sqrtUpper = sqrtRatioAtTick(tickUpper);

  const lowerPrice = priceFromSqrtX96(sqrtLower, t0.decimals, t1.decimals);
  const upperPrice = priceFromSqrtX96(sqrtUpper, t0.decimals, t1.decimals);

  return {
    tickLower,
    tickUpper,
    sqrtLower,
    sqrtUpper,
    lowerPrice,
    upperPrice,
    currentPrice,
  };
}

export async function quoteOpenPosition({ pool, rangeChoice, customLowerPrice, customUpperPrice, dropPercent, desiredAmount0 = 0n, desiredAmount1 = 0n }) {
  const client = getPublicClient();
  const rangeInfo = prepareRangeTicks(pool, rangeChoice, customLowerPrice, customUpperPrice, dropPercent);

  const liquidity = liquidityForAmounts(
    pool.sqrtPriceX96,
    rangeInfo.sqrtLower,
    rangeInfo.sqrtUpper,
    desiredAmount0,
    desiredAmount1
  );

  const required = amountsForLiquidity(
    pool.sqrtPriceX96,
    rangeInfo.sqrtLower,
    rangeInfo.sqrtUpper,
    liquidity
  );

  // Estimate USD values
  let val0Usd = 0;
  let val1Usd = 0;

  if (pool.token0.symbol === 'USDG') {
    val0Usd = Number(required.amount0) / 10 ** pool.token0.decimals;
    val1Usd = (Number(required.amount1) / 10 ** pool.token1.decimals) * pool.priceToken0PerToken1;
  } else if (pool.token1.symbol === 'USDG') {
    val0Usd = (Number(required.amount0) / 10 ** pool.token0.decimals) * pool.priceToken1PerToken0;
    val1Usd = Number(required.amount1) / 10 ** pool.token1.decimals;
  }

  const totalValueUsd = val0Usd + val1Usd;

  // Estimate gas cost
  const gasPrice = await client.getGasPrice().catch(() => 100000000n);
  const estimatedGasUnits = pool.version === 'V4' ? 260000n : 350000n;
  const estimatedGasFeeEth = formatTokenAmount(estimatedGasUnits * gasPrice, 18, 6);

  return {
    pool,
    rangeChoice,
    dropPercent: rangeInfo.dropPercent,
    isUsdgSingleSided: rangeInfo.isUsdgSingleSided,
    tickLower: rangeInfo.tickLower,
    tickUpper: rangeInfo.tickUpper,
    lowerPrice: rangeInfo.lowerPrice,
    upperPrice: rangeInfo.upperPrice,
    currentPrice: rangeInfo.currentPrice,
    liquidity,
    requiredAmount0: required.amount0,
    requiredAmount1: required.amount1,
    formattedAmount0: formatTokenAmount(required.amount0, pool.token0.decimals),
    formattedAmount1: formatTokenAmount(required.amount1, pool.token1.decimals),
    totalValueUsd,
    formattedTotalValueUsd: formatUsd(totalValueUsd),
    estimatedGasUnits,
    estimatedGasFeeEth,
  };
}

export async function mintPosition({ pool, tickLower, tickUpper, amount0Desired, amount1Desired, slippageBps = 100 }) {
  const env = getEnv();
  const client = getPublicClient();
  const walletClient = getWalletClient();
  const account = getAccount();

  if (!account) {
    throw new Error('PRIVATE_KEY is required to mint position');
  }

  // 0. Pre-flight balance check
  const [balance0, balance1] = await Promise.all([
    amount0Desired > 0n
      ? client.readContract({ address: pool.token0.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n)
      : Promise.resolve(0n),
    amount1Desired > 0n
      ? client.readContract({ address: pool.token1.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }).catch(() => 0n)
      : Promise.resolve(0n),
  ]);

  if (amount0Desired > balance0) {
    const reqFormatted = formatTokenAmount(amount0Desired, pool.token0.decimals);
    const balFormatted = formatTokenAmount(balance0, pool.token0.decimals);
    throw new Error(`Saldo ${pool.token0.symbol} tidak mencukupi! (Dibutuhkan: ${reqFormatted} ${pool.token0.symbol}, Saldo Anda: ${balFormatted} ${pool.token0.symbol})`);
  }

  if (amount1Desired > balance1) {
    const reqFormatted = formatTokenAmount(amount1Desired, pool.token1.decimals);
    const balFormatted = formatTokenAmount(balance1, pool.token1.decimals);
    throw new Error(`Saldo ${pool.token1.symbol} tidak mencukupi! (Dibutuhkan: ${reqFormatted} ${pool.token1.symbol}, Saldo Anda: ${balFormatted} ${pool.token1.symbol})`);
  }

  const targetManager = pool.version === 'V4' ? CONTRACTS_V4.POSITION_MANAGER : CONTRACTS.POSITION_MANAGER;

  // Calculate min/max amounts with slippage
  const amount0Min = (amount0Desired * BigInt(10000 - slippageBps)) / 10000n;
  const amount1Min = (amount1Desired * BigInt(10000 - slippageBps)) / 10000n;

  // 1. Ensure Allowances for both tokens
  if (pool.version === 'V4') {
    if (amount0Desired > 0n) {
      await ensureV4Permit2Allowance(pool.token0.address, amount0Desired);
    }
    if (amount1Desired > 0n) {
      await ensureV4Permit2Allowance(pool.token1.address, amount1Desired);
    }
  } else {
    if (amount0Desired > 0n) {
      const allowance0 = await checkAllowance(pool.token0.address, account.address, targetManager);
      if (allowance0 < amount0Desired) {
        console.log(`Approving ${pool.token0.symbol} for PositionManager V3...`);
        await approveToken(pool.token0.address, targetManager);
      }
    }

    if (amount1Desired > 0n) {
      const allowance1 = await checkAllowance(pool.token1.address, account.address, targetManager);
      if (allowance1 < amount1Desired) {
        console.log(`Approving ${pool.token1.symbol} for PositionManager V3...`);
        await approveToken(pool.token1.address, targetManager);
      }
    }
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 mins

  if (pool.version === 'V4') {
    const poolKey = {
      currency0: pool.token0.address,
      currency1: pool.token1.address,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      hooks: pool.hooks || CONTRACTS_V4.ZERO_HOOK,
    };

    const sqrtLower = sqrtRatioAtTick(tickLower);
    const sqrtUpper = sqrtRatioAtTick(tickUpper);
    const liquidity = liquidityForAmounts(pool.sqrtPriceX96, sqrtLower, sqrtUpper, amount0Desired, amount1Desired);

    const amount0Max = amount0Desired > 0n ? (amount0Desired * BigInt(10000 + slippageBps)) / 10000n : 0n;
    const amount1Max = amount1Desired > 0n ? (amount1Desired * BigInt(10000 + slippageBps)) / 10000n : 0n;

    const actions = '0x020d'; // MINT_POSITION (0x02) + SETTLE_PAIR (0x0d)
    const mintParam = encodeAbiParameters(mintParamTypes, [
      poolKey,
      tickLower,
      tickUpper,
      liquidity,
      amount0Max,
      amount1Max,
      account.address,
      '0x',
    ]);
    const settleParam = encodeAbiParameters(pairParamTypes, [
      poolKey.currency0,
      poolKey.currency1,
    ]);
    const unlockData = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes[]' }],
      [actions, [mintParam, settleParam]]
    );

    if (env.dryRun) {
      console.log(`[DRY RUN] Simulating Mint V4 Position in pool ${pool.token0.symbol}/${pool.token1.symbol}...`);
      const simGas = await client.estimateGas({
        account: account.address,
        to: targetManager,
        data: encodeFunctionData({
          abi: V4_POSITION_MANAGER_ABI,
          functionName: 'modifyLiquidities',
          args: [unlockData, deadline],
        }),
      }).catch(() => 260000n);

      return {
        status: 'DRY_RUN',
        txHash: '0xdryrun_mint_v4_hash',
        estimatedGas: simGas,
        unlockData,
      };
    }

    const hash = await walletClient.writeContract({
      address: targetManager,
      abi: V4_POSITION_MANAGER_ABI,
      functionName: 'modifyLiquidities',
      args: [unlockData, deadline],
      account,
    });

    const receipt = await client.waitForTransactionReceipt({ hash });

    let newTokenId = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === targetManager.toLowerCase() && log.topics[3]) {
        try {
          newTokenId = BigInt(log.topics[3]).toString();
        } catch {
          // ignore
        }
      }
    }

    let initialDepositUsd = 0;
    try {
      const val0 = (Number(amount0Desired) / 10 ** pool.token0.decimals);
      const val1 = (Number(amount1Desired) / 10 ** pool.token1.decimals);
      if (pool.token0.symbol === 'USDG') {
        initialDepositUsd = val0 + (val1 * (pool.priceToken0PerToken1 || 1));
      } else if (pool.token1.symbol === 'USDG') {
        initialDepositUsd = (val0 * (pool.priceToken1PerToken0 || 1)) + val1;
      } else {
        initialDepositUsd = val0 * (pool.priceToken1PerToken0 || 1);
      }
    } catch {
      // fallback 0
    }

    if (newTokenId) {
      try {
        const details = await getPositionDetails(newTokenId);
        if (details) {
          db.savePosition({
            ...details,
            initialDepositUsd,
          });
        }
      } catch {
        // ignore
      }
    }

    db.saveTransaction({
      type: `MINT_POSITION_V4`,
      pool: pool.address,
      tokenId: newTokenId,
      amount0Desired: amount0Desired.toString(),
      amount1Desired: amount1Desired.toString(),
      initialDepositUsd,
      txHash: hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
    });

    return {
      status: 'SUCCESS',
      txHash: hash,
      receipt,
      tokenId: newTokenId,
    };
  }

  // V3 Minting logic
  const mintParams = {
    token0: pool.token0.address,
    token1: pool.token1.address,
    fee: pool.fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min,
    amount1Min,
    recipient: account.address,
    deadline,
  };

  if (env.dryRun) {
    console.log(`[DRY RUN] Simulating Mint V3 Position in pool ${pool.token0.symbol}/${pool.token1.symbol}...`);
    const simGas = await client.estimateGas({
      account: account.address,
      to: targetManager,
      data: encodeFunctionData({
        abi: POSITION_MANAGER_ABI,
        functionName: 'mint',
        args: [mintParams],
      }),
    }).catch(() => 350000n);

    return {
      status: 'DRY_RUN',
      txHash: '0xdryrun_mint_hash',
      estimatedGas: simGas,
      mintParams,
    };
  }

  const hash = await walletClient.writeContract({
    address: targetManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'mint',
    args: [mintParams],
    account,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });

  // Extract Token ID from receipt logs if available
  let newTokenId = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === targetManager.toLowerCase() && log.topics[3]) {
      try {
        newTokenId = BigInt(log.topics[3]).toString();
      } catch {
        // ignore
      }
    }
  }

  let initialDepositUsd = 0;
  try {
    const val0 = (Number(amount0Desired) / 10 ** pool.token0.decimals);
    const val1 = (Number(amount1Desired) / 10 ** pool.token1.decimals);
    if (pool.token0.symbol === 'USDG') {
      initialDepositUsd = val0 + (val1 * (pool.priceToken0PerToken1 || 1));
    } else if (pool.token1.symbol === 'USDG') {
      initialDepositUsd = (val0 * (pool.priceToken1PerToken0 || 1)) + val1;
    } else {
      initialDepositUsd = val0 * (pool.priceToken1PerToken0 || 1);
    }
  } catch {
    // fallback 0
  }

  if (newTokenId) {
    try {
      const details = await getPositionDetails(newTokenId);
      if (details) {
        db.savePosition({
          ...details,
          initialDepositUsd,
        });
      }
    } catch {
      // ignore
    }
  }

  db.saveTransaction({
    type: `MINT_POSITION_V3`,
    pool: pool.address,
    tokenId: newTokenId,
    amount0Desired: amount0Desired.toString(),
    amount1Desired: amount1Desired.toString(),
    initialDepositUsd,
    txHash: hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
  });

  return {
    status: 'SUCCESS',
    txHash: hash,
    receipt,
    tokenId: newTokenId,
  };
}


