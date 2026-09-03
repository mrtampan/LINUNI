import { encodeAbiParameters, getAddress, keccak256, zeroAddress } from 'viem';

/**
 * Constants & Configuration for Robinhood Chain Uniswap V3 & V4
 */

export const RH_CHAIN_ID = 4663;
export const RH_CHAIN_NAME = 'Robinhood Chain';
export const RH_DEFAULT_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const RH_EXPLORER_URL = 'https://robinhoodchain.blockscout.com';

// Official Uniswap V3 Deployments on Robinhood Chain
export const CONTRACTS = {
  FACTORY: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
  POSITION_MANAGER: '0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3',
  SWAP_ROUTER: '0xCaf681a66D020601342297493863E78C959E5cb2',
  QUOTER: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
  MULTICALL3: '0xcA11bde05977b3631167028862bE2a173976CA11',
};

// Official Uniswap V4 Deployments on Robinhood Chain (Chain ID 4663)
export const CONTRACTS_V4 = {
  POOL_MANAGER: '0x8366a39cc670b4001a1121b8f6a443a643e40951',
  POSITION_MANAGER: '0x58daec3116aae6d93017baaea7749052e8a04fa7',
  STATE_VIEW: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
  UNIVERSAL_ROUTER: '0x8876789976decbfcbbbe364623c63652db8c0904',
  QUOTER: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  PERMIT2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  ZERO_HOOK: zeroAddress,
};


export function computeV4PoolId(currencyA, currencyB, fee, tickSpacing, hooks = CONTRACTS_V4.ZERO_HOOK) {
  const addrA = getAddress(currencyA);
  const addrB = getAddress(currencyB);
  const [currency0, currency1] = addrA.toLowerCase() < addrB.toLowerCase() ? [addrA, addrB] : [addrB, addrA];

  const encoded = encodeAbiParameters(
    [
      { type: 'address', name: 'currency0' },
      { type: 'address', name: 'currency1' },
      { type: 'uint24', name: 'fee' },
      { type: 'int24', name: 'tickSpacing' },
      { type: 'address', name: 'hooks' },
    ],
    [currency0, currency1, fee, tickSpacing, hooks]
  );
  return keccak256(encoded);
}


// Default Supported Core Assets on Robinhood Chain
export const TOKENS = {
  WETH: {
    address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    isNative: false,
  },
  ETH: {
    address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    isNative: true,
  },
  USDG: {
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    symbol: 'USDG',
    name: 'Robinhood USDG',
    decimals: 6,
    isNative: false,
  },
};

// Supported Fee Tiers in Basis Points (0.01%, 0.05%, 0.25%, 0.3%, 1.0%)
export const FEE_TIERS = [
  { fee: 100, tickSpacing: 1, label: '0.01%' },
  { fee: 500, tickSpacing: 10, label: '0.05%' },
  { fee: 2500, tickSpacing: 50, label: '0.25%' },
  { fee: 3000, tickSpacing: 60, label: '0.30%' },
  { fee: 10000, tickSpacing: 200, label: '1.00%' },
];

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const Q96 = 2n ** 96n;
export const UINT128_MAX = (1n << 128n) - 1n;
export const UINT256_MAX = (1n << 256n) - 1n;

// ABIs
export const ERC20_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address', name: 'account' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address', name: 'owner' }, { type: 'address', name: 'spender' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'spender' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }] },
];

export const FACTORY_ABI = [
  { type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'feeAmountTickSpacing', stateMutability: 'view', inputs: [{ type: 'uint24' }], outputs: [{ type: 'int24' }] },
];

export const POOL_ABI = [
  { type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'fee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] },
  { type: 'function', name: 'tickSpacing', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  { type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [
    { type: 'uint160', name: 'sqrtPriceX96' },
    { type: 'int24', name: 'tick' },
    { type: 'uint16', name: 'observationIndex' },
    { type: 'uint16', name: 'observationCardinality' },
    { type: 'uint16', name: 'observationCardinalityNext' },
    { type: 'uint8', name: 'feeProtocol' },
    { type: 'bool', name: 'unlocked' }
  ]},
];

export const POSITION_MANAGER_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address', name: 'owner' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ type: 'address', name: 'owner' }, { type: 'uint256', name: 'index' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'tokenId' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'tokenId' }], outputs: [
    { type: 'uint96', name: 'nonce' },
    { type: 'address', name: 'operator' },
    { type: 'address', name: 'token0' },
    { type: 'address', name: 'token1' },
    { type: 'uint24', name: 'fee' },
    { type: 'int24', name: 'tickLower' },
    { type: 'int24', name: 'tickUpper' },
    { type: 'uint128', name: 'liquidity' },
    { type: 'uint256', name: 'feeGrowthInside0LastX128' },
    { type: 'uint256', name: 'feeGrowthInside1LastX128' },
    { type: 'uint128', name: 'tokensOwed0' },
    { type: 'uint128', name: 'tokensOwed1' }
  ]},
  { type: 'function', name: 'mint', stateMutability: 'payable', inputs: [{
    type: 'tuple', name: 'params', components: [
      { type: 'address', name: 'token0' },
      { type: 'address', name: 'token1' },
      { type: 'uint24', name: 'fee' },
      { type: 'int24', name: 'tickLower' },
      { type: 'int24', name: 'tickUpper' },
      { type: 'uint256', name: 'amount0Desired' },
      { type: 'uint256', name: 'amount1Desired' },
      { type: 'uint256', name: 'amount0Min' },
      { type: 'uint256', name: 'amount1Min' },
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'deadline' }
    ]
  }], outputs: [
    { type: 'uint256', name: 'tokenId' },
    { type: 'uint128', name: 'liquidity' },
    { type: 'uint256', name: 'amount0' },
    { type: 'uint256', name: 'amount1' }
  ]},
  { type: 'function', name: 'increaseLiquidity', stateMutability: 'payable', inputs: [{
    type: 'tuple', name: 'params', components: [
      { type: 'uint256', name: 'tokenId' },
      { type: 'uint256', name: 'amount0Desired' },
      { type: 'uint256', name: 'amount1Desired' },
      { type: 'uint256', name: 'amount0Min' },
      { type: 'uint256', name: 'amount1Min' },
      { type: 'uint256', name: 'deadline' }
    ]
  }], outputs: [
    { type: 'uint128', name: 'liquidity' },
    { type: 'uint256', name: 'amount0' },
    { type: 'uint256', name: 'amount1' }
  ]},
  { type: 'function', name: 'decreaseLiquidity', stateMutability: 'payable', inputs: [{
    type: 'tuple', name: 'params', components: [
      { type: 'uint256', name: 'tokenId' },
      { type: 'uint128', name: 'liquidity' },
      { type: 'uint256', name: 'amount0Min' },
      { type: 'uint256', name: 'amount1Min' },
      { type: 'uint256', name: 'deadline' }
    ]
  }], outputs: [
    { type: 'uint256', name: 'amount0' },
    { type: 'uint256', name: 'amount1' }
  ]},
  { type: 'function', name: 'collect', stateMutability: 'payable', inputs: [{
    type: 'tuple', name: 'params', components: [
      { type: 'uint256', name: 'tokenId' },
      { type: 'address', name: 'recipient' },
      { type: 'uint128', name: 'amount0Max' },
      { type: 'uint128', name: 'amount1Max' }
    ]
  }], outputs: [
    { type: 'uint256', name: 'amount0' },
    { type: 'uint256', name: 'amount1' }
  ]},
  { type: 'function', name: 'burn', stateMutability: 'payable', inputs: [{ type: 'uint256', name: 'tokenId' }], outputs: [] },
  { type: 'function', name: 'multicall', stateMutability: 'payable', inputs: [{ type: 'bytes[]', name: 'data' }], outputs: [{ type: 'bytes[]', name: 'results' }] }
];

export const SWAP_ROUTER_ABI = [
  { type: 'function', name: 'exactInputSingle', stateMutability: 'payable', inputs: [{
    type: 'tuple', name: 'params', components: [
      { type: 'address', name: 'tokenIn' },
      { type: 'address', name: 'tokenOut' },
      { type: 'uint24', name: 'fee' },
      { type: 'address', name: 'recipient' },
      { type: 'uint256', name: 'amountIn' },
      { type: 'uint256', name: 'amountOutMinimum' },
      { type: 'uint160', name: 'sqrtPriceLimitX96' }
    ]
  }], outputs: [{ type: 'uint256', name: 'amountOut' }] },
  { type: 'function', name: 'multicall', stateMutability: 'payable', inputs: [{ type: 'bytes[]', name: 'data' }], outputs: [{ type: 'bytes[]', name: 'results' }] }
];

export const V4_POOL_MANAGER_ABI = [
  {
    type: 'function',
    name: 'getSlot0',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32', name: 'id' }],
    outputs: [
      { type: 'uint160', name: 'sqrtPriceX96' },
      { type: 'int24', name: 'tick' },
      { type: 'uint16', name: 'protocolFee' },
      { type: 'uint24', name: 'lpFee' }
    ]
  },
  {
    type: 'function',
    name: 'getLiquidity',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32', name: 'id' }],
    outputs: [{ type: 'uint128', name: 'liquidity' }]
  },
];

export const V4_POSITION_MANAGER_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address', name: 'owner' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ type: 'address', name: 'owner' }, { type: 'uint256', name: 'index' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'tokenId' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getPositionLiquidity', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'tokenId' }], outputs: [{ type: 'uint128' }] },
  { type: 'function', name: 'getPoolAndPositionInfo', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'tokenId' }], outputs: [
    { type: 'tuple', name: 'poolKey', components: [
      { type: 'address', name: 'currency0' },
      { type: 'address', name: 'currency1' },
      { type: 'uint24', name: 'fee' },
      { type: 'int24', name: 'tickSpacing' },
      { type: 'address', name: 'hooks' }
    ]},
    { type: 'tuple', name: 'positionInfo', components: [
      { type: 'int24', name: 'tickLower' },
      { type: 'int24', name: 'tickUpper' }
    ]}
  ]},
  { type: 'function', name: 'positions', stateMutability: 'view', inputs: [{ type: 'uint256', name: 'tokenId' }], outputs: [
    { type: 'address', name: 'currency0' },
    { type: 'address', name: 'currency1' },
    { type: 'uint24', name: 'fee' },
    { type: 'int24', name: 'tickLower' },
    { type: 'int24', name: 'tickUpper' },
    { type: 'uint128', name: 'liquidity' }
  ]},
  { type: 'function', name: 'modifyLiquidities', stateMutability: 'payable', inputs: [{ type: 'bytes', name: 'unlockData' }, { type: 'uint256', name: 'deadline' }], outputs: [] }
];

