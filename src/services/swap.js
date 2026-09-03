import { encodeFunctionData, getAddress } from 'viem';
import { CONTRACTS, CONTRACTS_V4, ERC20_ABI, SWAP_ROUTER_ABI, TOKENS } from '../config/constants.js';
import { getEnv } from '../config/env.js';
import { formatTokenAmount } from '../utils/formatter.js';
import { db } from './json-db.js';
import { inspectPool, inspectToken } from './pool.js';
import { getAccount, getPublicClient, getWalletClient } from './rpc.js';
import { inspectPoolV4 } from './v4.js';
import { approveToken, checkAllowance } from './wallet.js';

export async function quoteSwapToUsdg(tokenInAddress, amountIn) {
  if (amountIn <= 0n) return { amountOut: 0n, fee: 3000 };

  const tokenIn = await inspectToken(tokenInAddress);
  const usdg = TOKENS.USDG;

  if (tokenIn.address.toLowerCase() === usdg.address.toLowerCase()) {
    return { amountOut: amountIn, fee: 0, tokenIn, tokenOut: usdg };
  }

  // Try to inspect pool across fee tiers (500, 3000, 10000) for both V3 and V4
  const feeTiers = [500, 3000, 10000];
  let bestPool = null;

  for (const fee of feeTiers) {
    try {
      const poolV3 = await inspectPool(tokenIn.address, usdg.address, fee);
      if (poolV3 && poolV3.initialized && poolV3.liquidity > 0n) {
        if (!bestPool || poolV3.liquidity > bestPool.liquidity) {
          bestPool = poolV3;
        }
      }
    } catch {
      // Ignore uninitialized fee tiers
    }

    try {
      const poolV4 = await inspectPoolV4(tokenIn.address, usdg.address, fee);
      if (poolV4 && poolV4.initialized && poolV4.liquidity > 0n) {
        if (!bestPool || poolV4.liquidity > bestPool.liquidity) {
          bestPool = poolV4;
        }
      }
    } catch {
      // Ignore uninitialized V4 fee tiers
    }
  }

  if (!bestPool) {
    throw new Error(`No liquid pool found to swap ${tokenIn.symbol} -> USDG`);
  }

  // Calculate estimated output from pool price
  let estimatedPrice;
  if (bestPool.token0.address.toLowerCase() === tokenIn.address.toLowerCase()) {
    estimatedPrice = bestPool.priceToken1PerToken0; // USDG per TokenIn
  } else {
    estimatedPrice = bestPool.priceToken0PerToken1; // USDG per TokenIn
  }

  const rawAmountIn = Number(amountIn) / 10 ** tokenIn.decimals;
  const estimatedUsdgOutNumber = rawAmountIn * estimatedPrice;
  const amountOut = BigInt(Math.floor(estimatedUsdgOutNumber * 10 ** usdg.decimals));

  return {
    amountOut,
    fee: bestPool.fee,
    tokenIn,
    tokenOut: usdg,
    pool: bestPool,
  };
}


export async function swapToUsdg({ tokenInAddress, amountIn, slippageBps = 100 }) {
  const env = getEnv();
  const client = getPublicClient();
  const walletClient = getWalletClient();
  const account = getAccount();

  if (!account) {
    throw new Error('PRIVATE_KEY is required to execute swap');
  }

  const tokenIn = getAddress(tokenInAddress);
  const usdg = TOKENS.USDG.address;

  if (tokenIn.toLowerCase() === usdg.toLowerCase()) {
    return { status: 'NO_SWAP_NEEDED', message: 'Token is already USDG' };
  }

  const quote = await quoteSwapToUsdg(tokenIn, amountIn);
  const minUsdgOut = (quote.amountOut * BigInt(10000 - slippageBps)) / 10000n;

  // 1. Check Allowance for SwapRouter
  const allowance = await checkAllowance(tokenIn, account.address, CONTRACTS.SWAP_ROUTER);
  if (allowance < amountIn) {
    console.log(`Approving ${quote.tokenIn.symbol} for SwapRouter02...`);
    await approveToken(tokenIn, CONTRACTS.SWAP_ROUTER);
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 mins

  const params = {
    tokenIn,
    tokenOut: usdg,
    fee: quote.fee,
    recipient: account.address,
    amountIn,
    amountOutMinimum: minUsdgOut,
    sqrtPriceLimitX96: 0n,
  };

  if (env.dryRun) {
    console.log(`[DRY RUN] Simulating Swap ${formatTokenAmount(amountIn, quote.tokenIn.decimals)} ${quote.tokenIn.symbol} -> USDG...`);
    const simGas = await client.estimateGas({
      account: account.address,
      to: CONTRACTS.SWAP_ROUTER,
      data: encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [params],
      }),
    }).catch(() => 150000n);

    return {
      status: 'DRY_RUN',
      txHash: '0xdryrun_swap_hash',
      estimatedGas: simGas,
      expectedUsdgOut: quote.amountOut,
      minUsdgOut,
    };
  }

  const hash = await walletClient.writeContract({
    address: CONTRACTS.SWAP_ROUTER,
    abi: SWAP_ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [params],
    account,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });

  db.saveTransaction({
    type: 'SWAP_TO_USDG',
    tokenIn,
    amountIn: amountIn.toString(),
    expectedUsdgOut: quote.amountOut.toString(),
    txHash: hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
  });

  return {
    status: 'SUCCESS',
    txHash: hash,
    receipt,
    expectedUsdgOut: quote.amountOut,
    formattedUsdgOut: formatTokenAmount(quote.amountOut, TOKENS.USDG.decimals),
  };
}
