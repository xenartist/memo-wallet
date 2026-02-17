// Portfolio asset discovery logic
// Discovers all tokens held by a wallet on X1 and Solana chains

import {
  rpcCall,
  getTokenMetadata,
  X1_RPC_URL,
  SOLANA_RPC_URL,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  TokenMetadata,
  WRAPPED_SOL_MINT,
} from './rpc';
import {getSolanaTokensMetadata} from './jupiter';

// ==================== Types ====================
export interface PortfolioToken {
  symbol: string;
  name: string;
  balance: string;
  mint: string | null; // null for native tokens (XNT, SOL)
  network: 'X1' | 'Solana';
  icon_uri: string | null;
  decimals: number;
  rawBalance: number;
  usdPrice: number | null;
  usdValue: number | null;
}

interface ParsedTokenAccount {
  mint: string;
  balance: number;
  decimals: number;
}

// ==================== Constants ====================
const XNT_ICON_URI = 'https://app.xdex.xyz/assets/images/tokens/x1.webp';

// ==================== Token Account Parsing ====================
function parseTokenAccountsFromRpc(rpcResult: any): ParsedTokenAccount[] {
  const accounts: ParsedTokenAccount[] = [];
  if (!rpcResult?.value || !Array.isArray(rpcResult.value)) {
    return accounts;
  }

  for (const item of rpcResult.value) {
    const parsed = item?.account?.data?.parsed;
    if (parsed?.info?.tokenAmount) {
      const tokenAmount = parsed.info.tokenAmount;
      const amount = parseInt(tokenAmount.amount, 10);
      if (amount > 0) {
        accounts.push({
          mint: parsed.info.mint,
          balance: amount,
          decimals: tokenAmount.decimals || 0,
        });
      }
    }
  }

  return accounts;
}

// ==================== Metadata Cache ====================
// In-memory cache for X1 token metadata during a single fetch cycle
const x1MetadataCache: {[mint: string]: TokenMetadata} = {};

async function getCachedX1TokenMetadata(mint: string): Promise<TokenMetadata> {
  if (x1MetadataCache[mint]) {
    return x1MetadataCache[mint];
  }
  const metadata = await getTokenMetadata(mint, X1_RPC_URL);
  x1MetadataCache[mint] = metadata;
  return metadata;
}

// ==================== Build Token From Account ====================
async function buildX1PortfolioToken(
  account: ParsedTokenAccount,
): Promise<PortfolioToken> {
  const metadata = await getCachedX1TokenMetadata(account.mint);
  const balanceNum = account.balance / Math.pow(10, account.decimals);

  return {
    symbol: metadata.symbol || account.mint.slice(0, 6),
    name: metadata.name || account.mint.slice(0, 8) + '...',
    balance: balanceNum.toFixed(Math.min(account.decimals, 4)),
    mint: account.mint,
    network: 'X1',
    icon_uri: metadata.logo_uri,
    decimals: account.decimals,
    rawBalance: balanceNum,
    usdPrice: null,
    usdValue: null,
  };
}

function buildSolanaPortfolioToken(
  account: ParsedTokenAccount,
  metadata: TokenMetadata,
): PortfolioToken {
  const balanceNum = account.balance / Math.pow(10, account.decimals);
  const usdPrice = metadata.usd_price ?? null;
  const usdValue = usdPrice !== null ? balanceNum * usdPrice : null;

  return {
    symbol: metadata.symbol || account.mint.slice(0, 6),
    name: metadata.name || account.mint.slice(0, 8) + '...',
    balance: balanceNum.toFixed(Math.min(account.decimals, 4)),
    mint: account.mint,
    network: 'Solana',
    icon_uri: metadata.logo_uri,
    decimals: account.decimals,
    rawBalance: balanceNum,
    usdPrice,
    usdValue,
  };
}

// ==================== Main Fetch Function ====================
export async function fetchAllTokens(
  publicKey: string,
): Promise<PortfolioToken[]> {
  const tokens: PortfolioToken[] = [];

  // Parallel fetch: 6 RPC calls across 2 chains
  const [
    x1NativeResult,
    x1TokenProgramResult,
    x1Token2022Result,
    solNativeResult,
    solTokenProgramResult,
    solToken2022Result,
  ] = await Promise.all([
    // X1 chain: native XNT balance
    rpcCall('getBalance', [publicKey], X1_RPC_URL).catch(err => {
      console.error('Failed to fetch X1 native balance:', err);
      return {value: 0};
    }),
    // X1 chain: TOKEN_PROGRAM SPL tokens
    rpcCall(
      'getTokenAccountsByOwner',
      [publicKey, {programId: TOKEN_PROGRAM}, {encoding: 'jsonParsed'}],
      X1_RPC_URL,
    ).catch(err => {
      console.error('Failed to fetch X1 TOKEN_PROGRAM tokens:', err);
      return {value: []};
    }),
    // X1 chain: TOKEN_2022_PROGRAM SPL tokens
    rpcCall(
      'getTokenAccountsByOwner',
      [publicKey, {programId: TOKEN_2022_PROGRAM}, {encoding: 'jsonParsed'}],
      X1_RPC_URL,
    ).catch(err => {
      console.error('Failed to fetch X1 TOKEN_2022 tokens:', err);
      return {value: []};
    }),
    // Solana chain: native SOL balance
    rpcCall('getBalance', [publicKey], SOLANA_RPC_URL).catch(err => {
      console.error('Failed to fetch SOL native balance:', err);
      return {value: 0};
    }),
    // Solana chain: TOKEN_PROGRAM SPL tokens
    rpcCall(
      'getTokenAccountsByOwner',
      [publicKey, {programId: TOKEN_PROGRAM}, {encoding: 'jsonParsed'}],
      SOLANA_RPC_URL,
    ).catch(err => {
      console.error('Failed to fetch Solana TOKEN_PROGRAM tokens:', err);
      return {value: []};
    }),
    // Solana chain: TOKEN_2022_PROGRAM SPL tokens
    rpcCall(
      'getTokenAccountsByOwner',
      [publicKey, {programId: TOKEN_2022_PROGRAM}, {encoding: 'jsonParsed'}],
      SOLANA_RPC_URL,
    ).catch(err => {
      console.error('Failed to fetch Solana TOKEN_2022 tokens:', err);
      return {value: []};
    }),
  ]);

  // 1. Native XNT (X1)
  const xntBalance = (x1NativeResult.value || 0) / 1e9;
  tokens.push({
    symbol: 'XNT',
    name: 'XNT',
    balance: xntBalance.toFixed(4),
    mint: null,
    network: 'X1',
    icon_uri: XNT_ICON_URI,
    decimals: 9,
    rawBalance: xntBalance,
    usdPrice: null,
    usdValue: null,
  });

  // 2. Native SOL (Solana)
  const solBalance = (solNativeResult.value || 0) / 1e9;
  tokens.push({
    symbol: 'SOL',
    name: 'Solana',
    balance: solBalance.toFixed(4),
    mint: null,
    network: 'Solana',
    icon_uri: null, // uses local image in App.tsx
    decimals: 9,
    rawBalance: solBalance,
    usdPrice: null,
    usdValue: null,
  });

  // 3. Parse X1 SPL tokens (TOKEN_PROGRAM + TOKEN_2022)
  const x1TokenAccounts = [
    ...parseTokenAccountsFromRpc(x1TokenProgramResult),
    ...parseTokenAccountsFromRpc(x1Token2022Result),
  ];

  // 4. Parse Solana SPL tokens (TOKEN_PROGRAM + TOKEN_2022)
  const solTokenAccounts = [
    ...parseTokenAccountsFromRpc(solTokenProgramResult),
    ...parseTokenAccountsFromRpc(solToken2022Result),
  ];

  // 5. Fetch metadata for X1 SPL tokens (Token-2022 extensions)
  const x1TokenPromises: Promise<PortfolioToken>[] = [];
  for (const account of x1TokenAccounts) {
    x1TokenPromises.push(buildX1PortfolioToken(account));
  }
  const x1Tokens = await Promise.all(x1TokenPromises);
  tokens.push(...x1Tokens);

  // 6. Fetch metadata for Solana SPL tokens (Jupiter API, batched)
  // Always query Wrapped SOL mint to get SOL price for native SOL
  const solMints = [WRAPPED_SOL_MINT, ...solTokenAccounts.map(a => a.mint)];
  const solMetadataMap = await getSolanaTokensMetadata(solMints);

  // Native SOL: use Wrapped SOL price
  const solUsdPrice = solMetadataMap[WRAPPED_SOL_MINT]?.usd_price ?? null;
  const solUsdValue = solUsdPrice !== null ? solBalance * solUsdPrice : null;

  // Update native SOL token with price
  const nativeSolToken = tokens.find(
    t => t.symbol === 'SOL' && t.mint === null,
  );
  if (nativeSolToken) {
    nativeSolToken.usdPrice = solUsdPrice;
    nativeSolToken.usdValue = solUsdValue;
  }

  // Build Solana SPL tokens
  for (const account of solTokenAccounts) {
    const metadata = solMetadataMap[account.mint] || {
      mint: account.mint,
      name: null,
      symbol: null,
      logo_uri: null,
    };
    tokens.push(buildSolanaPortfolioToken(account, metadata));
  }

  // 7. Sort: native tokens first (XNT, SOL), then by usdValue descending
  tokens.sort((a, b) => {
    // Native tokens always first
    if (a.mint === null && b.mint !== null) {
      return -1;
    }
    if (a.mint !== null && b.mint === null) {
      return 1;
    }
    // Among native tokens, XNT first
    if (a.mint === null && b.mint === null) {
      return a.symbol === 'XNT' ? -1 : 1;
    }
    // SPL tokens sorted by usdValue descending (null = 0)
    const aVal = a.usdValue ?? 0;
    const bVal = b.usdValue ?? 0;
    if (bVal !== aVal) {
      return bVal - aVal;
    }
    // Fallback to rawBalance if usdValue equal
    return b.rawBalance - a.rawBalance;
  });

  return tokens;
}
