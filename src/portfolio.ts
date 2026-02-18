// Portfolio asset discovery logic
// Discovers all tokens held by a wallet on X1 and Solana chains

import {fetchXDEXWalletTokens} from './rpc';

// ==================== Types ====================
export interface PortfolioToken {
  symbol: string;
  name: string;
  balance: string;
  mint: string | null;
  network: 'X1' | 'Solana';
  icon_uri: string | null;
  decimals: number;
  rawBalance: number;
  volume_usd: number;
}

// ==================== Constants ====================
const NATIVE_MINT = '111111111111111111111111111111111111111111';

function isNativeToken(mint: string | null): boolean {
  return mint === null || mint === NATIVE_MINT;
}

// ==================== Helper Functions ====================
function xdexTokenToPortfolioToken(
  xdexToken: {
    mint: string;
    ui_amount: number;
    decimals: number;
    symbol: string;
    name: string;
    imageUrl: string;
    volume_usd: number;
  },
  network: 'X1' | 'Solana',
): PortfolioToken {
  const balanceNum = xdexToken.ui_amount;
  return {
    symbol: xdexToken.symbol,
    name: xdexToken.name,
    balance: balanceNum.toFixed(Math.min(xdexToken.decimals, 4)),
    mint: xdexToken.mint,
    network,
    icon_uri: xdexToken.imageUrl,
    decimals: xdexToken.decimals,
    rawBalance: balanceNum,
    volume_usd: xdexToken.volume_usd,
  };
}

// ==================== Main Fetch Function ====================
export async function fetchAllTokens(
  publicKey: string,
): Promise<PortfolioToken[]> {
  const tokens: PortfolioToken[] = [];

  const [x1TokensRaw, solTokensRaw] = await Promise.all([
    fetchXDEXWalletTokens(publicKey, 'X1 Mainnet').catch(err => {
      console.error('Failed to fetch X1 tokens from xDEX:', err);
      return [];
    }),
    fetchXDEXWalletTokens(publicKey, 'Solana Mainnet').catch(err => {
      console.error('Failed to fetch Solana tokens from xDEX:', err);
      return [];
    }),
  ]);

  // Filter out LP tokens
  const x1Tokens = x1TokensRaw.filter(t => !t.is_lp_token);
  const solTokens = solTokensRaw.filter(t => !t.is_lp_token);

  // Convert X1 tokens
  for (const token of x1Tokens) {
    tokens.push(xdexTokenToPortfolioToken(token, 'X1'));
  }

  // Convert Solana tokens
  for (const token of solTokens) {
    tokens.push(xdexTokenToPortfolioToken(token, 'Solana'));
  }

  // Sort: native tokens first, then by balance descending
  tokens.sort((a, b) => {
    const aNative = isNativeToken(a.mint);
    const bNative = isNativeToken(b.mint);

    // Native tokens always first
    if (aNative && !bNative) {
      return -1;
    }
    if (!aNative && bNative) {
      return 1;
    }
    // Among native tokens, XNT first (X1 network first)
    if (aNative && bNative) {
      return a.network === 'X1' ? -1 : 1;
    }
    // SPL tokens sorted by balance descending
    return b.rawBalance - a.rawBalance;
  });

  return tokens;
}
