import { getAddress, parseAbi } from 'viem';
import { CONTRACTS, CONTRACTS_V4, ERC20_ABI, TOKENS, UINT256_MAX } from '../config/constants.js';
import { getEnv } from '../config/env.js';
import { formatTokenAmount } from '../utils/formatter.js';
import { db } from './json-db.js';
import { getAccount, getPublicClient, getWalletClient } from './rpc.js';

const PERMIT2_ABI = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

export async function getWalletDetails(overrideAddress) {
  const env = getEnv();
  const client = getPublicClient();
  const account = getAccount();

  let targetAddress = overrideAddress || env.walletAddress || account?.address;
  if (!targetAddress) {
    throw new Error('No wallet address configured. Set WALLET_ADDRESS or PRIVATE_KEY in .env');
  }

  targetAddress = getAddress(targetAddress);

  const [ethBalance, wethBalance, usdgBalance, wethNpmAllowance, usdgNpmAllowance, wethSwapAllowance, usdgSwapAllowance] = await Promise.all([
    client.getBalance({ address: targetAddress }).catch((err) => {
      console.warn('[wallet] Error fetching ETH balance:', err.message || err);
      return 0n;
    }),
    client.readContract({ address: TOKENS.WETH.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [targetAddress] }).catch((err) => {
      console.warn('[wallet] Error fetching WETH balance:', err.message || err);
      return 0n;
    }),
    client.readContract({ address: TOKENS.USDG.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [targetAddress] }).catch((err) => {
      console.warn('[wallet] Error fetching USDG balance:', err.message || err);
      return 0n;
    }),
    client.readContract({ address: TOKENS.WETH.address, abi: ERC20_ABI, functionName: 'allowance', args: [targetAddress, CONTRACTS.POSITION_MANAGER] }).catch(() => 0n),
    client.readContract({ address: TOKENS.USDG.address, abi: ERC20_ABI, functionName: 'allowance', args: [targetAddress, CONTRACTS.POSITION_MANAGER] }).catch(() => 0n),
    client.readContract({ address: TOKENS.WETH.address, abi: ERC20_ABI, functionName: 'allowance', args: [targetAddress, CONTRACTS.SWAP_ROUTER] }).catch(() => 0n),
    client.readContract({ address: TOKENS.USDG.address, abi: ERC20_ABI, functionName: 'allowance', args: [targetAddress, CONTRACTS.SWAP_ROUTER] }).catch(() => 0n),
  ]);

  return {
    address: targetAddress,
    hasPrivateKey: !!env.privateKey,
    eth: {
      raw: ethBalance,
      formatted: formatTokenAmount(ethBalance, 18),
      symbol: 'ETH',
    },
    weth: {
      raw: wethBalance,
      formatted: formatTokenAmount(wethBalance, 18),
      symbol: 'WETH',
      npmAllowance: wethNpmAllowance,
      swapAllowance: wethSwapAllowance,
    },
    usdg: {
      raw: usdgBalance,
      formatted: formatTokenAmount(usdgBalance, 6),
      symbol: 'USDG',
      npmAllowance: usdgNpmAllowance,
      swapAllowance: usdgSwapAllowance,
    },
  };
}

export async function checkAllowance(tokenAddress, ownerAddress, spenderAddress) {
  const client = getPublicClient();
  return await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [ownerAddress, spenderAddress],
  });
}

export async function approveToken(tokenAddress, spenderAddress, amount = UINT256_MAX) {
  const env = getEnv();
  const client = getPublicClient();
  const walletClient = getWalletClient();
  const account = getAccount();

  if (!account) {
    throw new Error('PRIVATE_KEY is required to sign approve transaction');
  }

  if (env.dryRun) {
    console.log(`[DRY RUN] Simulating Approval for token ${tokenAddress} spender ${spenderAddress}...`);
    const simGas = await client.estimateGas({
      account: account.address,
      to: tokenAddress,
      data: client.encodeFunctionData ? client.encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [spenderAddress, amount] }) : '0x',
    }).catch(() => 50000n);
    return { status: 'DRY_RUN', txHash: '0xdryrun_approval_hash', estimatedGas: simGas };
  }

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddress, amount],
    account,
  });

  const receipt = await client.waitForTransactionReceipt({ hash });

  db.saveTransaction({
    type: 'APPROVE',
    tokenAddress,
    spenderAddress,
    amount: amount.toString(),
    txHash: hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
  });

  return { status: 'SUCCESS', txHash: hash, receipt };
}

export async function ensureV4Permit2Allowance(tokenAddress, requiredAmount) {
  const env = getEnv();
  const client = getPublicClient();
  const walletClient = getWalletClient();
  const account = getAccount();

  if (!account) return;
  const now = Math.floor(Date.now() / 1000);

  // 1. Check ERC20 allowance to PERMIT2
  const erc20Allowance = await client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, CONTRACTS_V4.PERMIT2],
  });

  if (erc20Allowance < requiredAmount) {
    console.log(`Approving ERC20 token for Permit2...`);
    if (env.dryRun) {
      console.log(`[DRY RUN] Would approve ERC20 token ${tokenAddress} for Permit2`);
    } else {
      const tx = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS_V4.PERMIT2, UINT256_MAX],
        account,
      });
      await client.waitForTransactionReceipt({ hash: tx });
    }
  }

  // 2. Check Permit2 allowance to POSITION_MANAGER
  const permitData = await client.readContract({
    address: CONTRACTS_V4.PERMIT2,
    abi: PERMIT2_ABI,
    functionName: 'allowance',
    args: [account.address, tokenAddress, CONTRACTS_V4.POSITION_MANAGER],
  });

  const [amountAllowed, expiration] = permitData;
  if (BigInt(amountAllowed) < requiredAmount || expiration <= now) {
    console.log(`Approving Permit2 allowance for PositionManager...`);
    const maxUint160 = (1n << 160n) - 1n;
    const farFutureExpiration = 2147483647; // max uint48 timestamp
    if (env.dryRun) {
      console.log(`[DRY RUN] Would approve Permit2 allowance for token ${tokenAddress} to PositionManager`);
    } else {
      const tx = await walletClient.writeContract({
        address: CONTRACTS_V4.PERMIT2,
        abi: PERMIT2_ABI,
        functionName: 'approve',
        args: [tokenAddress, CONTRACTS_V4.POSITION_MANAGER, maxUint160, farFutureExpiration],
        account,
      });
      await client.waitForTransactionReceipt({ hash: tx });
    }
  }
}

