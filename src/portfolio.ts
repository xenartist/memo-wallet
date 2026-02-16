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
} from './rpc';

// ==================== Types ====================
export interface PortfolioToken {
  symbol: string;
  name: string;
  balance: string;
  mint: string | null; // null for native tokens (XNT, SOL)
  network: 'X1' | 'Solana';
  icon_uri: string | null;
  decimals: number;
  rawBalance: number; // for sorting
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
// Cache metadata during a single fetch cycle to avoid duplicate RPC calls
const metadataCache: {[key: string]: TokenMetadata} = {};

async function getCachedTokenMetadata(
  mint: string,
  rpcUrl: string,
): Promise<TokenMetadata> {
  const cacheKey = `${mint}:${rpcUrl}`;
  if (metadataCache[cacheKey]) {
    return metadataCache[cacheKey];
  }
  const metadata = await getTokenMetadata(mint, rpcUrl);
  metadataCache[cacheKey] = metadata;
  return metadata;
}

// ==================== Build Token From Account ====================
async function buildPortfolioToken(
  account: ParsedTokenAccount,
  network: 'X1' | 'Solana',
  rpcUrl: string,
): Promise<PortfolioToken> {
  const metadata = await getCachedTokenMetadata(account.mint, rpcUrl);
  const balanceNum = account.balance / Math.pow(10, account.decimals);

  return {
    symbol: metadata.symbol || account.mint.slice(0, 6),
    name: metadata.name || account.mint.slice(0, 8) + '...',
    balance: balanceNum.toFixed(Math.min(account.decimals, 4)),
    mint: account.mint,
    network,
    icon_uri: metadata.logo_uri,
    decimals: account.decimals,
    rawBalance: balanceNum,
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

  // 5. Fetch metadata and build PortfolioToken for all discovered SPL tokens
  const splTokenPromises: Promise<PortfolioToken>[] = [];

  for (const account of x1TokenAccounts) {
    splTokenPromises.push(buildPortfolioToken(account, 'X1', X1_RPC_URL));
  }
  for (const account of solTokenAccounts) {
    splTokenPromises.push(
      buildPortfolioToken(account, 'Solana', SOLANA_RPC_URL),
    );
  }

  const splTokens = await Promise.all(splTokenPromises);
  tokens.push(...splTokens);

  // 6. Sort: native tokens first (XNT, SOL), then by rawBalance descending
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
    // SPL tokens sorted by balance descending
    return b.rawBalance - a.rawBalance;
  });

  return tokens;
}
