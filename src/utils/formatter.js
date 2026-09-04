import { formatUnits, parseUnits } from 'viem';

export function formatTokenAmount(amount, decimals = 18, precision = 6) {
  if (amount === undefined || amount === null) return '0';
  try {
    const formatted = formatUnits(BigInt(amount), decimals);
    const parts = formatted.split('.');
    if (parts.length === 1) return parts[0];
    const decimalPart = parts[1].slice(0, precision).replace(/0+$/, '');
    return decimalPart ? `${parts[0]}.${decimalPart}` : parts[0];
  } catch {
    return '0';
  }
}

export function parseTokenAmount(amountString, decimals = 18) {
  if (!amountString || typeof amountString !== 'string') return 0n;
  try {
    const cleanStr = amountString.trim().replace(/,/g, '');
    return parseUnits(cleanStr, decimals);
  } catch {
    throw new Error(`Invalid token amount string: "${amountString}"`);
  }
}

export function formatUsd(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
}

export function formatCompactUsd(amount) {
  if (typeof amount !== 'number' || isNaN(amount) || amount === 0) return '$0';
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

export function shortenAddress(address, chars = 4) {
  if (!address || typeof address !== 'string') return '';
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatPrice(price) {
  if (typeof price !== 'number' || isNaN(price)) return '0';
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toExponential(4);
}
