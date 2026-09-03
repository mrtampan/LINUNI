import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbiItem, zeroAddress } from 'viem';
import { CONTRACTS, CONTRACTS_V4, POSITION_MANAGER_ABI, V4_POSITION_MANAGER_ABI, UINT128_MAX } from '../config/constants.js';
import { getEnv } from '../config/env.js';
import { formatTokenAmount } from '../utils/formatter.js';
import { amountsForLiquidity, priceFromSqrtX96, sqrtRatioAtTick } from '../utils/math.js';
import { db } from './json-db.js';
import { inspectPool, inspectToken } from './pool.js';
import { getAccount, getPublicClient, getWalletClient } from './rpc.js';
import { getPositionDetailsV4 } from './v4.js';

export async function getPositionDetails(tokenId) {
  const client = getPublicClient();
  const id = BigInt(tokenId);

  // Check if recorded as V4 position in DB
  const dbRecord = db.getPositionByTokenId(tokenId);
  if (dbRecord && dbRecord.version === 'V4') {
    return getPositionDetailsV4(tokenId);
  }

  try {
    const [owner, rawPos] = await Promise.all([
      client.readContract({ address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: 'ownerOf', args: [id] }),
      client.readContract({ address: CONTRACTS.POSITION_MANAGER, abi: POSITION_MANAGER_ABI, functionName: 'positions', args: [id] }),
    ]);

    const token0Address = rawPos[2];
    const token1Address = rawPos[3];
    const fee = Number(rawPos[4]);
    const tickLower = Number(rawPos[5]);
    const tickUpper = Number(rawPos[6]);
    const liquidity = rawPos[7];
    let tokensOwed0 = rawPos[10];
    let tokensOwed1 = rawPos[11];

    const [t0, t1, poolState] = await Promise.all([
      inspectToken(token0Address),
      inspectToken(token1Address),
      inspectPool(token0Address, token1Address, fee),
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

    // Simulate collect call via eth_call to get 100% accurate uncollected fees
    try {
      const simResult = await client.simulateContract({
        address: CONTRACTS.POSITION_MANAGER,
        abi: POSITION_MANAGER_ABI,
        functionName: 'collect',
        args: [{
          tokenId: id,
          recipient: owner,
          amount0Max: UINT128_MAX,
          amount1Max: UINT128_MAX,
        }],
        account: owner,
      });
      if (simResult && simResult.result) {
        tokensOwed0 = simResult.result[0];
        tokensOwed1 = simResult.result[1];
      }
    } catch {
      // Fall back to positions struct tokensOwed if simulation fails
    }

    const details = {
      version: 'V3',
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
  } catch {
    // If V3 lookup fails, try V4 position lookup
    return getPositionDetailsV4(tokenId);
  }
}

export const SPAM_TOKENS = new Set(['FORK', 'SNOP']);
export const SPAM_POSITION_IDS = new Set(['58820', '155042']);

export function isSpamPosition(pos) {
  if (!pos || !pos.tokenId) return true;
  if (SPAM_POSITION_IDS.has(pos.tokenId.toString())) return true;
  const t0 = pos.token0?.symbol?.toUpperCase();
  const t1 = pos.token1?.symbol?.toUpperCase();
  if (SPAM_TOKENS.has(t0) || SPAM_TOKENS.has(t1)) return true;
  return false;
}

export async function getUserPositions(ownerAddress) {
  const client = getPublicClient();
  const target = getAddress(ownerAddress);

  const positionIds = new Set();

  // 1. Fetch V3 position NFT IDs via tokenOfOwnerByIndex
  try {
    const balanceV3 = await client.readContract({
      address: CONTRACTS.POSITION_MANAGER,
      abi: POSITION_MANAGER_ABI,
      functionName: 'balanceOf',
      args: [target],
    });

    if (balanceV3 > 0n) {
      const indexPromises = Array.from({ length: Number(balanceV3) }, (_, i) =>
        client.readContract({
          address: CONTRACTS.POSITION_MANAGER,
          abi: POSITION_MANAGER_ABI,
          functionName: 'tokenOfOwnerByIndex',
          args: [target, BigInt(i)],
        }).catch(() => null)
      );
      const fetchedIds = await Promise.all(indexPromises);
      for (const tokenId of fetchedIds) {
        if (tokenId !== null) positionIds.add(tokenId.toString());
      }
    }
  } catch {
    // ignore
  }

  // 2. Fetch V4 position NFT IDs via Transfer event logs
  const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed id)');
  try {
    const v4TransferLogs = await client.getLogs({
      address: CONTRACTS_V4.POSITION_MANAGER,
      event: transferEvent,
      args: { to: target },
      fromBlock: 0n,
      toBlock: 'latest',
    }).catch(() => []);

    for (const log of v4TransferLogs) {
      if (log.args && log.args.id !== undefined) {
        positionIds.add(log.args.id.toString());
      }
    }
  } catch {
    // ignore
  }

  // 3. Combine with positions saved in local JSON DB
  const localPositions = db.getPositions();
  for (const pos of localPositions) {
    if (pos.owner && pos.owner.toLowerCase() === target.toLowerCase()) {
      positionIds.add(pos.tokenId.toString());
    }
  }

  // 4. Fetch position details in parallel and filter out spam/phishing positions
  const detailPromises = Array.from(positionIds).map(idStr =>
    getPositionDetails(idStr).catch(err => {
      console.warn(`Could not load details for position #${idStr}: ${err.message}`);
      return null;
    })
  );

  const results = await Promise.all(detailPromises);
  const legitimate = results.filter(Boolean).filter(p => !isSpamPosition(p));
  return legitimate;
}


export async function closePosition100(tokenId) {
  const env = getEnv();
  const client = getPublicClient();
  const walletClient = getWalletClient();
  const account = getAccount();

  if (!account) {
    throw new Error('PRIVATE_KEY is required to close position');
  }

  const details = await getPositionDetails(tokenId);
  const id = BigInt(tokenId);
  const liquidity = details.liquidityRaw;

  if (liquidity === 0n) {
    throw new Error(`Position #${tokenId} has 0 liquidity (already closed)`);
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 minutes

  if (details.version === 'V4') {
    const targetManager = CONTRACTS_V4.POSITION_MANAGER;
    // Action 0x01: DECREASE_LIQUIDITY, Action 0x11: TAKE_PAIR
    const actions = '0x0111';
    const decreaseParam = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
      [id, liquidity, 0n, 0n, '0x']
    );
    const takeParam = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
      [details.token0.address, details.token1.address, account.address]
    );
    const unlockData = encodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes[]' }],
      [actions, [decreaseParam, takeParam]]
    );

    if (env.dryRun) {
      console.log(`[DRY RUN] Simulating 100% Close V4 Position #${tokenId}...`);
      const simGas = await client.estimateGas({
        account: account.address,
        to: targetManager,
        data: encodeFunctionData({
          abi: V4_POSITION_MANAGER_ABI,
          functionName: 'modifyLiquidities',
          args: [unlockData, deadline],
        }),
      }).catch(() => 250000n);

      return {
        status: 'DRY_RUN',
        txHash: '0xdryrun_close_position_hash',
        estimatedGas: simGas,
        details,
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

    db.updatePosition(tokenId, {
      liquidity: '0',
      liquidityRaw: 0n,
      closedAt: new Date().toISOString(),
      closeTxHash: hash,
    });

    db.saveTransaction({
      type: 'CLOSE_POSITION_100_V4',
      tokenId: tokenId.toString(),
      txHash: hash,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
    });

    return {
      status: 'SUCCESS',
      txHash: hash,
      receipt,
      details,
    };
  }

  // V3 Position Manager
  const targetManager = CONTRACTS.POSITION_MANAGER;

  // Multicall: decreaseLiquidity (100%) + collect (all tokens & fees)
  const decreaseCallData = encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: 'decreaseLiquidity',
    args: [{
      tokenId: id,
      liquidity,
      amount0Min: 0n,
      amount1Min: 0n,
      deadline,
    }],
  });

  const collectCallData = encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: 'collect',
    args: [{
      tokenId: id,
      recipient: account.address,
      amount0Max: UINT128_MAX,
      amount1Max: UINT128_MAX,
    }],
  });

  const multicallData = [decreaseCallData, collectCallData];

  if (env.dryRun) {
    console.log(`[DRY RUN] Simulating 100% Close V3 Position #${tokenId}...`);
    const simGas = await client.estimateGas({
      account: account.address,
      to: targetManager,
      data: encodeFunctionData({
        abi: POSITION_MANAGER_ABI,
        functionName: 'multicall',
        args: [multicallData],
      }),
    }).catch(() => 250000n);

    return {
      status: 'DRY_RUN',
      txHash: '0xdryrun_close_position_hash',
      estimatedGas: simGas,
      details,
    };
  }

  const hash = await walletClient.writeContract({
    address: targetManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'multicall',
    args: [multicallData],
    account,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });

  db.updatePosition(tokenId, {
    liquidity: '0',
    liquidityRaw: 0n,
    closedAt: new Date().toISOString(),
    closeTxHash: hash,
  });

  db.saveTransaction({
    type: 'CLOSE_POSITION_100_V3',
    tokenId: tokenId.toString(),
    txHash: hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
  });

  return {
    status: 'SUCCESS',
    txHash: hash,
    receipt,
    details,
  };
}

export async function getOnChainInitialDeposit(pos) {
  const client = getPublicClient();
  const tokenId = BigInt(pos.tokenId);
  const t0 = pos.token0;
  const t1 = pos.token1;

  let initialAmt0 = 0n;
  let initialAmt1 = 0n;

  if (pos.version === 'V3') {
    const increaseLiquidityEvent = parseAbiItem(
      'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
    );

    try {
      const logs = await client.getLogs({
        address: CONTRACTS.POSITION_MANAGER,
        event: increaseLiquidityEvent,
        args: { tokenId },
        fromBlock: 0n,
        toBlock: 'latest',
      });

      if (logs && logs.length > 0) {
        initialAmt0 = logs[0].args.amount0;
        initialAmt1 = logs[0].args.amount1;
      }
    } catch (err) {
      console.warn(`[OnChainDeposit] V3 log fetch error for #${pos.tokenId}:`, err.message);
    }
  } else if (pos.version === 'V4') {
    const transferEvent = parseAbiItem(
      'event Transfer(address indexed from, address indexed to, uint256 indexed id)'
    );

    try {
      const logs = await client.getLogs({
        address: CONTRACTS_V4.POSITION_MANAGER,
        event: transferEvent,
        args: {
          from: '0x0000000000000000000000000000000000000000',
          id: tokenId,
        },
        fromBlock: 0n,
        toBlock: 'latest',
      });

      if (logs && logs.length > 0) {
        const creationTxHash = logs[0].transactionHash;
        const receipt = await client.getTransactionReceipt({ hash: creationTxHash });

        const erc20TransferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        for (const log of receipt.logs) {
          if (log.topics[0] === erc20TransferTopic && log.topics.length >= 3) {
            const tokenAddr = log.address.toLowerCase();
            const logDataHex = log.data && log.data !== '0x' ? log.data : '0x0';
            const value = BigInt(logDataHex);

            if (tokenAddr === t0.address.toLowerCase()) {
              initialAmt0 += value;
            } else if (tokenAddr === t1.address.toLowerCase()) {
              initialAmt1 += value;
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[OnChainDeposit] V4 log fetch error for #${pos.tokenId}:`, err.message);
    }
  }

  const formatted0 = Number(initialAmt0) / (10 ** t0.decimals);
  const formatted1 = Number(initialAmt1) / (10 ** t1.decimals);

  let p0Usd = 0;
  let p1Usd = 0;
  if (t0.symbol === 'USDG') {
    p0Usd = 1;
    p1Usd = pos.currentPrice > 0 ? 1 / pos.currentPrice : 0;
  } else if (t1.symbol === 'USDG') {
    p1Usd = 1;
    p0Usd = pos.currentPrice;
  } else {
    p0Usd = pos.currentPrice;
    p1Usd = 1;
  }

  const initialDepositUsd = (formatted0 * p0Usd) + (formatted1 * p1Usd);

  return {
    initialAmt0,
    initialAmt1,
    formatted0,
    formatted1,
    initialDepositUsd,
  };
}


