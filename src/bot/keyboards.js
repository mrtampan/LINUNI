import { InlineKeyboard } from 'grammy';

export function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text('👛 Wallet', 'menu:wallet')
    .text('📊 Positions', 'menu:positions')
    .text('📈 PnL Audit', 'menu:pnl')
    .row()
    .text('🚀 Open Position', 'menu:open')
    .text('🔒 Close Position', 'menu:close')
    .row()
    .text('⏱️ Auto PnL (10m)', 'menu:autopnl')
    .text('📜 History', 'menu:history')
    .text('⚙️ Config', 'menu:config');
}

export function walletApprovalKeyboard(hasPrivateKey) {
  const kb = new InlineKeyboard();
  if (hasPrivateKey) {
    kb.text('⚡ Approve WETH (NPM)', 'approve:WETH_NPM')
      .text('⚡ Approve USDG (NPM)', 'approve:USDG_NPM')
      .row()
      .text('⚡ Approve WETH (Swap)', 'approve:WETH_SWAP')
      .text('⚡ Approve USDG (Swap)', 'approve:USDG_SWAP')
      .row();
  }
  kb.text('🔄 Refresh Wallet', 'menu:wallet')
    .text('🏠 Main Menu', 'menu:main');
  return kb;
}

export function poolSelectionKeyboard(pools) {
  const kb = new InlineKeyboard();
  pools.forEach((p, idx) => {
    const tvlStr = p.formattedTvl || '$0';
    const volStr = p.formattedVolume24h || '$0';
    kb.text(
      `🏊 ${p.token0.symbol}/${p.token1.symbol} (${p.feeLabel}) | TVL: ${tvlStr} | Vol: ${volStr}`,
      `pool:${idx}`
    ).row();
  });
  kb.text('❌ Cancel', 'action:cancel');
  return kb;
}

export function rangeSelectionKeyboard() {
  return new InlineKeyboard()
    .text('Narrow (±5%)', 'range:NARROW')
    .text('Medium (±10%)', 'range:MEDIUM')
    .row()
    .text('Wide (±20%)', 'range:WIDE')
    .text('Full Range (0 to ∞)', 'range:FULL')
    .row()
    .text('Custom Range (Input Min/Max)', 'range:CUSTOM')
    .row()
    .text('❌ Cancel', 'action:cancel');
}

export function tokenSpecifyKeyboard(symbol0, symbol1) {
  return new InlineKeyboard()
    .text(`Specify ${symbol0} Amount`, 'token_amt:TOKEN0')
    .text(`Specify ${symbol1} Amount`, 'token_amt:TOKEN1')
    .row()
    .text('❌ Cancel', 'action:cancel');
}

export function confirmMintKeyboard() {
  return new InlineKeyboard()
    .text('✅ Mint Position On-Chain', 'mint:confirm')
    .text('❌ Cancel', 'action:cancel');
}

export function positionListKeyboard(activePositions) {
  const kb = new InlineKeyboard();
  activePositions.forEach(p => {
    kb.text(
      `🔒 Close 100% NFT #${p.tokenId} (${p.token0.symbol}/${p.token1.symbol})`,
      `close_pos:${p.tokenId}`
    ).row();
  });
  kb.text('🔄 Refresh Positions', 'menu:positions')
    .text('🏠 Main Menu', 'menu:main');
  return kb;
}

export function closeOptionsKeyboard(tokenId) {
  return new InlineKeyboard()
    .text('Option A: Withdraw Direct (Keep ETH & USDG)', `close_opt:A:${tokenId}`)
    .row()
    .text('Option B: Auto-Swap non-USDG to USDG', `close_opt:B:${tokenId}`)
    .row()
    .text('❌ Cancel', 'action:cancel');
}

export function confirmCloseKeyboard(tokenId, closeOption) {
  return new InlineKeyboard()
    .text(`⚠️ Confirm Close 100% NFT #${tokenId}`, `confirm_close:${closeOption}:${tokenId}`)
    .row()
    .text('❌ Cancel', 'action:cancel');
}

export function cancelKeyboard() {
  return new InlineKeyboard().text('❌ Cancel', 'action:cancel');
}
