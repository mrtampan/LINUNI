import { MAX_TICK, MIN_TICK, Q96 } from '../config/constants.js';

export function sqrtRatioAtTick(tick) {
  if (typeof tick !== 'number' || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick outside bounds: ${tick}`);
  }
  const ratio = Math.sqrt(1.0001 ** tick);
  return BigInt(Math.floor(ratio * Number(Q96)));
}

export function priceFromSqrtX96(sqrtPriceX96, decimals0 = 18, decimals1 = 18) {
  if (!sqrtPriceX96) return 0;
  const num = Number(sqrtPriceX96);
  const price0 = (num / Number(Q96)) ** 2;
  const decimalDiff = decimals0 - decimals1;
  return price0 * 10 ** decimalDiff;
}

export function tickAtPrice(priceToken1PerToken0, decimals0 = 18, decimals1 = 18) {
  if (!Number.isFinite(priceToken1PerToken0) || priceToken1PerToken0 <= 0) {
    throw new Error('Price must be positive');
  }
  const adjustedPrice = priceToken1PerToken0 / 10 ** (decimals0 - decimals1);
  return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
}

export function nearestUsableTick(tick, spacing) {
  if (!Number.isInteger(tick) || !Number.isInteger(spacing) || spacing <= 0) {
    throw new Error('Tick and tick spacing must be positive integers');
  }
  const rounded = Math.round(tick / spacing) * spacing;
  const minLimit = MIN_TICK - (MIN_TICK % spacing);
  const maxLimit = MAX_TICK - (MAX_TICK % spacing);
  return Math.min(maxLimit, Math.max(minLimit, rounded));
}

export function floorUsableTick(tick, spacing) {
  return nearestUsableTick(Math.floor(tick / spacing) * spacing, spacing);
}

function mulDiv(a, b, d) {
  if (d === 0n) return 0n;
  return (a * b) / d;
}

export function amountsForLiquidity(sqrtCurrent, sqrtLower, sqrtUpper, liquidity) {
  if (sqrtLower >= sqrtUpper || liquidity <= 0n) {
    return { amount0: 0n, amount1: 0n };
  }

  if (sqrtCurrent <= sqrtLower) {
    const amount0 = mulDiv(mulDiv(liquidity, Q96, sqrtLower), sqrtUpper - sqrtLower, sqrtUpper);
    return { amount0, amount1: 0n };
  } else if (sqrtCurrent < sqrtUpper) {
    const amount0 = mulDiv(mulDiv(liquidity, Q96, sqrtCurrent), sqrtUpper - sqrtCurrent, sqrtUpper);
    const amount1 = mulDiv(liquidity, sqrtCurrent - sqrtLower, Q96);
    return { amount0, amount1 };
  } else {
    const amount1 = mulDiv(liquidity, sqrtUpper - sqrtLower, Q96);
    return { amount0: 0n, amount1 };
  }
}

export function liquidityForAmounts(sqrtCurrent, sqrtLower, sqrtUpper, amount0, amount1) {
  if (sqrtLower >= sqrtUpper) {
    throw new Error('Invalid tick range: lower must be less than upper');
  }

  if (sqrtCurrent <= sqrtLower) {
    if (amount0 <= 0n) return 0n;
    return (amount0 * sqrtLower * sqrtUpper) / Q96 / (sqrtUpper - sqrtLower);
  } else if (sqrtCurrent >= sqrtUpper) {
    if (amount1 <= 0n) return 0n;
    return (amount1 * Q96) / (sqrtUpper - sqrtLower);
  } else {
    const l0 = amount0 > 0n ? (amount0 * sqrtCurrent * sqrtUpper) / Q96 / (sqrtUpper - sqrtCurrent) : 0n;
    const l1 = amount1 > 0n ? (amount1 * Q96) / (sqrtCurrent - sqrtLower) : 0n;

    if (amount0 > 0n && amount1 > 0n) {
      return l0 < l1 ? l0 : l1;
    }
    return amount0 > 0n ? l0 : l1;
  }
}

export function rangeFromPercent(currentPrice, percent, decimals0, decimals1, spacing) {
  if (percent <= 0 || percent >= 100) {
    throw new Error('Percent must be between 0 and 100');
  }

  const lowerPrice = currentPrice * (1 - percent / 100);
  const upperPrice = currentPrice * (1 + percent / 100);

  const rawLowerTick = tickAtPrice(lowerPrice, decimals0, decimals1);
  const rawUpperTick = tickAtPrice(upperPrice, decimals0, decimals1);

  let tickLower = floorUsableTick(rawLowerTick, spacing);
  let tickUpper = nearestUsableTick(rawUpperTick, spacing);

  if (tickLower >= tickUpper) {
    tickUpper = tickLower + spacing;
  }

  return { tickLower, tickUpper };
}

export function parseDropPercent(input) {
  if (typeof input === 'number') {
    const absVal = Math.abs(input);
    return absVal > 0 && absVal < 100 ? absVal : null;
  }
  if (typeof input === 'string') {
    const cleaned = input.replace('%', '').trim();
    const parsed = parseFloat(cleaned);
    if (!Number.isFinite(parsed)) return null;
    const absVal = Math.abs(parsed);
    return absVal > 0 && absVal < 100 ? absVal : null;
  }
  return null;
}

export function rangeFromDropPercent(pool, dropPercent) {
  const percent = parseDropPercent(dropPercent);
  if (!percent) {
    throw new Error('Drop percentage must be a valid number between 0 and 100 (e.g. -50, -50%, or 50)');
  }

  const t0 = pool.token0;
  const t1 = pool.token1;
  const spacing = pool.tickSpacing;
  const isUsdgT0 = t0.symbol === 'USDG';
  const isUsdgT1 = t1.symbol === 'USDG';

  if (!isUsdgT0 && !isUsdgT1) {
    throw new Error('Pool must contain USDG as token0 or token1 for single-sided USDG range');
  }

  const decimals0 = t0.decimals;
  const decimals1 = t1.decimals;

  let tickLower, tickUpper;

  if (isUsdgT1) {
    const currentPriceUsdg = pool.priceToken1PerToken0;
    const lowerPriceUsdg = currentPriceUsdg * (1 - percent / 100);

    const tickCurrent = tickAtPrice(currentPriceUsdg, decimals0, decimals1);
    const rawLower = tickAtPrice(lowerPriceUsdg, decimals0, decimals1);

    tickUpper = floorUsableTick(tickCurrent, spacing);
    tickLower = floorUsableTick(rawLower, spacing);
  } else {
    const currentPriceUsdg = pool.priceToken0PerToken1;
    const lowerPriceUsdg = currentPriceUsdg * (1 - percent / 100);
    const upperPriceUsdg = currentPriceUsdg;

    const upperPrice1per0 = 1 / lowerPriceUsdg;

    const price1per0Current = 1 / currentPriceUsdg;
    const tickCurrent = tickAtPrice(price1per0Current, decimals0, decimals1);
    const rawUpper = tickAtPrice(upperPrice1per0, decimals0, decimals1);

    const ceilUsableTick = (t, s) => Math.ceil(t / s) * s;
    tickLower = ceilUsableTick(tickCurrent, spacing);
    tickUpper = ceilUsableTick(rawUpper, spacing);
  }

  if (tickLower >= tickUpper) {
    if (isUsdgT1) tickLower = tickUpper - spacing;
    else tickUpper = tickLower + spacing;
  }

  const sqrtLower = sqrtRatioAtTick(tickLower);
  const sqrtUpper = sqrtRatioAtTick(tickUpper);

  const lowerPrice = priceFromSqrtX96(sqrtLower, decimals0, decimals1);
  const upperPrice = priceFromSqrtX96(sqrtUpper, decimals0, decimals1);

  return {
    tickLower,
    tickUpper,
    sqrtLower,
    sqrtUpper,
    lowerPrice,
    upperPrice,
    currentPrice: pool.priceToken1PerToken0,
    dropPercent: percent,
    isUsdgSingleSided: true,
  };
}

