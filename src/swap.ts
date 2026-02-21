// Swap-specific logic: xDEX pool queries, price calculation, swap instructions

import {
  rpcCall,
  base64DecodeToUint8Array,
  base64Encode,
  USDC_MINT,
  X1_RPC_URL,
  SwapNetwork,
  rpcUrlForNetwork,
  getLatestBlockhash,
  simulateTransaction,
  sendRawTransaction,
  confirmTransaction,
  fetchXDEXWalletTokens,
} from './rpc';

import {
  InstructionJSON,
  buildTransactionBytes,
  addComputeBudgetInstructions,
  insertSignature,
  decodeSignatureFromBase64,
  serializeToBase64,
} from './transaction';

import {SeedVault} from '@solana-mobile/seed-vault-lib';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Re-export commonly used constants for swap consumers
export {USDC_MINT, WRAPPED_XNT_MINT} from './rpc';
export {rpcCall} from './rpc';
export type {TokenMetadata} from './rpc';
export {getTokenMetadata} from './rpc';
export type {SwapNetwork} from './rpc';

// ==================== xDEX Constants ====================
export const XDEX_PROGRAM_ID = 'sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN';
const XDEX_API_URL = 'https://api.xdex.xyz/api/xendex';

// Native mint used for XNT (X1) and SOL (Solana) in API calls
export const NATIVE_MINT = 'So11111111111111111111111111111111111111111';
// The wallet-level "null mint" sentinel used in portfolio
const PORTFOLIO_NATIVE_MINT = '111111111111111111111111111111111111111111';
// xDEX wallet/tokens API returns the 32-char system program address for native XNT/SOL
const SYSTEM_PROGRAM_MINT = '11111111111111111111111111111111';

// Both X1 and Solana networks use the WRAPPED mint (So...112) in the
// xDEX quote API.
const WRAPPED_NATIVE_MINT = 'So11111111111111111111111111111111111111112';

/**
 * Mint to use in the /swap/quote API (GET).
 * Native tokens (null / all-1s / So...111 / So...112) → WRAPPED_NATIVE_MINT (So...112).
 */
export function toApiMint(mint: string | null): string {
  if (
    mint === null ||
    mint === PORTFOLIO_NATIVE_MINT ||
    mint === SYSTEM_PROGRAM_MINT ||
    mint === NATIVE_MINT ||
    mint === WRAPPED_NATIVE_MINT
  ) {
    return WRAPPED_NATIVE_MINT;
  }
  return mint;
}

/**
 * Mint to use as token_in in the /swap/prepare API (POST).
 * For native tokens used as INPUT, pass the portfolio native mint (all-1s)
 * — the prepare API recognises this and checks the correct SOL/XNT balance.
 * For non-native tokens the mint is passed through unchanged.
 */
export function toPrepareTokenInMint(mint: string | null): string {
  if (
    mint === null ||
    mint === PORTFOLIO_NATIVE_MINT ||
    mint === SYSTEM_PROGRAM_MINT ||
    mint === NATIVE_MINT ||
    mint === WRAPPED_NATIVE_MINT
  ) {
    return PORTFOLIO_NATIVE_MINT;
  }
  return mint;
}

export function isNativeMint(mint: string | null): boolean {
  return (
    mint === null ||
    mint === PORTFOLIO_NATIVE_MINT ||
    mint === SYSTEM_PROGRAM_MINT ||
    mint === NATIVE_MINT ||
    mint === WRAPPED_NATIVE_MINT
  );
}

// ==================== Types ====================

export interface PoolInfo {
  address: string;
  token_0_mint: string;
  token_1_mint: string;
  token_0_decimals: number;
  token_1_decimals: number;
  token_0_vault: string;
  token_1_vault: string;
  lp_supply: number;
  status: number;
  pool_creator: string;
}

export interface PoolPrice {
  pool_address: string;
  token_0_mint: string;
  token_1_mint: string;
  reserve_0: number;
  reserve_1: number;
  price: number;
  token_0_usd_price: number | null;
  token_1_usd_price: number | null;
}

export interface PoolInfoFromAPI {
  pool_address: string;
  token1_address: string;
  token2_address: string;
  token1_symbol: string;
  token2_symbol: string;
  token1_logo: string | null;
  token2_logo: string | null;
  amount1_without_fee: number;
  amount2_without_fee: number;
  mint0Decimals: number;
  mint1Decimals: number;
}

export interface SwapToken {
  mint: string; // portfolio mint (may be PORTFOLIO_NATIVE_MINT for natives)
  apiMint: string; // mint for /swap/quote (So...112 for natives)
  prepareApiMint: string; // mint for /swap/prepare token_in (111...111 for natives)
  symbol: string;
  name: string;
  logo: string | null;
  balance: number;
  decimals: number;
  network: 'X1' | 'Solana';
}

// ==================== xDEX Pool API ====================

export async function fetchPoolFromAPI(
  token1Mint: string,
  token2Mint: string,
): Promise<PoolInfoFromAPI | null> {
  try {
    const response = await fetch(
      `${XDEX_API_URL}/pool/tokens/${token1Mint}/${token2Mint}`,
    );
    const data = await response.json();
    if (data.success && data.data) {
      const pool = data.data;
      return {
        pool_address: pool.pool_address,
        token1_address: pool.token1_address,
        token2_address: pool.token2_address,
        token1_symbol: pool.token1_symbol,
        token2_symbol: pool.token2_symbol,
        token1_logo: pool.token1_logo
          ? pool.token1_logo.startsWith('http')
            ? pool.token1_logo
            : `https://x1logos.s3.us-east-1.amazonaws.com/${pool.token1_logo}`
          : null,
        token2_logo: pool.token2_logo,
        amount1_without_fee: pool.amount1_without_fee,
        amount2_without_fee: pool.amount2_without_fee,
        mint0Decimals: pool.pool_info?.mint0Decimals || 9,
        mint1Decimals: pool.pool_info?.mint1Decimals || 6,
      };
    }
    return null;
  } catch (error) {
    console.error('Failed to fetch pool from API:', error);
    return null;
  }
}

// ==================== Pool List API ====================

export interface PoolPair {
  poolAddress: string;
  token1Mint: string;
  token1Symbol: string;
  token1Logo: string | null;
  token2Mint: string;
  token2Symbol: string;
  token2Logo: string | null;
  status: number; // 0 = active
  amount1: number; // token1 reserve (excluding fees)
  amount2: number; // token2 reserve (excluding fees)
}

export async function fetchPoolList(network: SwapNetwork): Promise<PoolPair[]> {
  try {
    const url = `${XDEX_API_URL}/pool/list?network=${encodeURIComponent(
      network,
    )}`;
    console.log('[Swap] fetchPoolList url:', url);
    const response = await fetch(url);
    const data = await response.json();
    console.log(
      '[Swap] fetchPoolList response (first 3):',
      JSON.stringify(data?.data?.slice?.(0, 3)),
    );
    if (!data.success || !Array.isArray(data.data)) {
      return [];
    }
    return (data.data as any[]).map((p: any) => ({
      poolAddress: p.pool_address,
      token1Mint: p.token1_address,
      token1Symbol: p.token1_symbol,
      token1Logo: p.token1_logo
        ? p.token1_logo.startsWith('http')
          ? p.token1_logo
          : `https://x1logos.s3.us-east-1.amazonaws.com/${p.token1_logo}`
        : null,
      token2Mint: p.token2_address,
      token2Symbol: p.token2_symbol,
      token2Logo: p.token2_logo
        ? p.token2_logo.startsWith('http')
          ? p.token2_logo
          : `https://x1logos.s3.us-east-1.amazonaws.com/${p.token2_logo}`
        : null,
      status: p.pool_info?.status ?? 0,
      amount1: p.amount1_without_fee ?? 0,
      amount2: p.amount2_without_fee ?? 0,
    }));
  } catch (error) {
    console.error('[Swap] Failed to fetch pool list:', error);
    return [];
  }
}

// ==================== Swap Token List ====================

export interface SwapTokensResult {
  tokens: SwapToken[];
  pools: PoolPair[];
}

/**
 * Build a deduplicated list of SwapTokens for a wallet on a given network.
 * We merge user's held tokens with all tokens that appear in pools, so the
 * user can swap even tokens they don't yet hold (as destination).
 * Also returns the raw pool pairs so callers can filter valid To tokens.
 */
export async function getSwapTokens(
  walletAddress: string,
  network: SwapNetwork,
): Promise<SwapTokensResult> {
  const netLabel: 'X1' | 'Solana' = network === 'X1 Mainnet' ? 'X1' : 'Solana';

  const [walletTokens, pools] = await Promise.all([
    fetchXDEXWalletTokens(walletAddress, network).catch(err => {
      console.error('[Swap] Failed to fetch wallet tokens:', err);
      return [];
    }),
    fetchPoolList(network).catch(err => {
      console.error('[Swap] Failed to fetch pool list:', err);
      return [];
    }),
  ]);

  const map = new Map<string, SwapToken>();

  // Add wallet tokens first (they have balance info)
  for (const t of walletTokens) {
    if (t.is_lp_token) {
      continue;
    }
    const mint = isNativeMint(t.mint) ? PORTFOLIO_NATIVE_MINT : t.mint;
    map.set(mint, {
      mint,
      apiMint: toApiMint(mint),
      prepareApiMint: toPrepareTokenInMint(mint),
      symbol: t.symbol,
      name: t.name,
      logo: t.imageUrl || null,
      balance: t.ui_amount,
      decimals: t.decimals,
      network: netLabel,
    });
  }

  // Add pool tokens that user may not hold (balance = 0).
  // Use NATIVE_MINT as the canonical key for native tokens to avoid duplicates.
  for (const pool of pools) {
    for (const [rawMint, rawSymbol, logo] of [
      [pool.token1Mint, pool.token1Symbol, pool.token1Logo],
      [pool.token2Mint, pool.token2Symbol, pool.token2Logo],
    ] as [string, string, string | null][]) {
      // Normalise: wrapped native → native key
      const mapKey = isNativeMint(rawMint) ? NATIVE_MINT : rawMint;
      const apiMint = toApiMint(rawMint);
      const prepareApiMint = toPrepareTokenInMint(rawMint);
      // Use friendly symbol for native tokens
      const symbol = isNativeMint(rawMint)
        ? netLabel === 'X1'
          ? 'XNT'
          : 'SOL'
        : rawSymbol;
      if (!map.has(mapKey)) {
        map.set(mapKey, {
          mint: mapKey,
          apiMint,
          prepareApiMint,
          symbol,
          name: symbol,
          logo,
          balance: 0,
          decimals: 9,
          network: netLabel,
        });
      }
    }
  }

  // Sort: highest balance first, then alphabetical
  const tokens = Array.from(map.values());
  tokens.sort((a, b) => {
    if (b.balance !== a.balance) {
      return b.balance - a.balance;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  // Apply cached metadata (fills missing logo/name) then persist fresh data
  const metaCache = await loadSwapMetaCache();
  const enriched = applyCachedMeta(tokens, netLabel, metaCache);
  // Fire-and-forget: write fresh metadata back to cache
  cacheTokenMeta(enriched, netLabel).catch(err =>
    console.warn('[swap] getSwapTokens: cacheTokenMeta failed', err),
  );

  return {tokens: enriched, pools};
}

// ==================== Quote API ====================

export interface SwapQuoteParams {
  network: SwapNetwork;
  tokenIn: string; // apiMint
  tokenOut: string; // apiMint
  tokenInAmount: number;
  isExactAmountIn?: boolean;
}

export interface SwapQuoteResult {
  tokenInAmount: number;
  tokenOutAmount: number;
  priceImpact: number | null;
  minAmountOut: number | null;
  raw: any;
}

export async function fetchSwapQuote(
  params: SwapQuoteParams,
): Promise<SwapQuoteResult> {
  const {
    network,
    tokenIn,
    tokenOut,
    tokenInAmount,
    isExactAmountIn = true,
  } = params;
  const url =
    `${XDEX_API_URL}/swap/quote` +
    `?network=${encodeURIComponent(network)}` +
    `&token_in=${tokenIn}` +
    `&token_out=${tokenOut}` +
    `&token_in_amount=${tokenInAmount}` +
    `&is_exact_amount_in=${isExactAmountIn}`;

  console.log('[Swap] Quote url:', url);
  const response = await fetch(url);
  const data = await response.json();
  console.log('[Swap] Quote response:', JSON.stringify(data));

  if (!response.ok || !data.success) {
    throw new Error(
      data?.message || data?.error || `Quote API error: ${response.status}`,
    );
  }

  const d = data.data ?? data;
  return {
    tokenInAmount:
      d.inputAmount ?? d.token_in_amount ?? d.tokenInAmount ?? tokenInAmount,
    tokenOutAmount:
      d.outputAmount ?? d.token_out_amount ?? d.tokenOutAmount ?? 0,
    priceImpact: d.priceImpactPct ?? d.price_impact ?? d.priceImpact ?? null,
    minAmountOut: d.minimum_amount_out ?? d.minAmountOut ?? null,
    raw: d,
  };
}

// ==================== Prepare API ====================

export interface SwapPrepareParams {
  network: SwapNetwork;
  wallet: string;
  tokenIn: string; // apiMint
  tokenOut: string; // apiMint
  tokenInAmount: number;
  isExactAmountIn?: boolean;
}

export interface SwapPrepareResult {
  // Set when API returns pre-built serialised transaction(s)
  transactionBase64: string | null;
  // Set when API returns raw instruction list (future-proofing)
  instructions: InstructionJSON[];
  blockhash: string | null;
  raw: any;
}

export async function fetchSwapPrepare(
  params: SwapPrepareParams,
): Promise<SwapPrepareResult> {
  const {
    network,
    wallet,
    tokenIn,
    tokenOut,
    tokenInAmount,
    isExactAmountIn = true,
  } = params;

  const body = {
    network,
    wallet,
    token_in: tokenIn,
    token_out: tokenOut,
    token_in_amount: tokenInAmount,
    is_exact_amount_in: isExactAmountIn,
  };

  console.log('[Swap] Prepare body:', JSON.stringify(body));

  const response = await fetch(`${XDEX_API_URL}/swap/prepare`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });

  const data = await response.json();
  console.log('[Swap] Prepare response:', JSON.stringify(data));

  if (!response.ok || !data.success) {
    throw new Error(
      data?.message || data?.error || `Prepare API error: ${response.status}`,
    );
  }

  const raw = data.data ?? data;

  // API returns a pre-built serialised transaction (most common path)
  if (raw.transaction) {
    // transaction may be a string or an array — take first element
    const txRaw = Array.isArray(raw.transaction)
      ? raw.transaction[0]
      : raw.transaction;
    const txBase64 = typeof txRaw === 'string' ? txRaw : null;
    console.log(
      '[Swap] Prepare returned serialised tx, length:',
      txBase64?.length,
      'blockhash:',
      raw.blockhash,
    );
    return {
      transactionBase64: txBase64,
      instructions: [],
      blockhash: raw.blockhash ?? null,
      raw,
    };
  }

  // Fallback: instruction list format
  let instructions: InstructionJSON[] = [];
  if (Array.isArray(raw.instructions)) {
    instructions = raw.instructions;
  } else if (Array.isArray(raw)) {
    instructions = raw;
  }

  console.log('[Swap] Prepare instructions count:', instructions.length);
  return {transactionBase64: null, instructions, blockhash: null, raw};
}

// ==================== Token Balance ====================
export async function getTokenAccountBalance(
  accountAddress: string,
): Promise<number> {
  const result = await rpcCall('getAccountInfo', [
    accountAddress,
    {encoding: 'jsonParsed'},
  ]);

  if (!result?.value?.data?.parsed?.info?.tokenAmount?.amount) {
    throw new Error(
      `Account ${accountAddress} does not exist or has no balance`,
    );
  }

  return parseInt(result.value.data.parsed.info.tokenAmount.amount, 10);
}

export async function getTokenBalance(
  walletAddress: string,
  mintAddress: string,
  rpcUrl: string = X1_RPC_URL,
): Promise<number> {
  const response = await rpcCall(
    'getTokenAccountsByOwner',
    [walletAddress, {mint: mintAddress}, {encoding: 'jsonParsed'}],
    rpcUrl,
  );

  if (response?.value && response.value.length > 0) {
    const amount = response.value[0].data?.parsed?.info?.tokenAmount?.amount;
    if (amount) {
      return parseInt(amount, 10);
    }
  }
  return 0;
}

// ==================== Pool Price ====================
export async function getPoolPrice(poolInfo: PoolInfo): Promise<PoolPrice> {
  const vault0Balance = await getTokenAccountBalance(poolInfo.token_0_vault);
  const vault1Balance = await getTokenAccountBalance(poolInfo.token_1_vault);

  const reserve0 = vault0Balance / Math.pow(10, poolInfo.token_0_decimals);
  const reserve1 = vault1Balance / Math.pow(10, poolInfo.token_1_decimals);

  const price = reserve1 > 0 ? reserve0 / reserve1 : 0;

  let token0UsdPrice: number | null = null;
  let token1UsdPrice: number | null = null;

  if (poolInfo.token_0_mint === USDC_MINT) {
    token0UsdPrice = 1;
    token1UsdPrice = price;
  } else if (poolInfo.token_1_mint === USDC_MINT) {
    token0UsdPrice = price > 0 ? 1 / price : 0;
    token1UsdPrice = 1;
  }

  return {
    pool_address: poolInfo.address,
    token_0_mint: poolInfo.token_0_mint,
    token_1_mint: poolInfo.token_1_mint,
    reserve_0: reserve0,
    reserve_1: reserve1,
    price,
    token_0_usd_price: token0UsdPrice,
    token_1_usd_price: token1UsdPrice,
  };
}

// ==================== Execute Swap ====================

export interface ExecuteSwapParams {
  network: SwapNetwork;
  wallet: string;
  tokenIn: SwapToken;
  tokenOut: SwapToken;
  tokenInAmount: number; // human-readable (e.g. 1.5 XNT)
  authToken: number;
  derivationPath: string;
}

export interface ExecuteSwapResult {
  success: boolean;
  signature?: string;
  error?: string;
}

export async function executeSwap(
  params: ExecuteSwapParams,
): Promise<ExecuteSwapResult> {
  const {
    network,
    wallet,
    tokenIn,
    tokenOut,
    tokenInAmount,
    authToken,
    derivationPath,
  } = params;

  const rpcUrl = rpcUrlForNetwork(network);

  try {
    // ── 1. Prepare: get serialised transaction from xDEX API ─────────────────
    const prepareResult = await fetchSwapPrepare({
      network,
      wallet,
      tokenIn: tokenIn.prepareApiMint,
      tokenOut: tokenOut.apiMint,
      tokenInAmount,
      isExactAmountIn: true,
    });

    if (prepareResult.transactionBase64) {
      // Most common path: API returns a ready-to-sign serialised transaction
      return await _signAndSendSerializedTx(
        prepareResult.transactionBase64,
        authToken,
        derivationPath,
        rpcUrl,
      );
    }

    if (prepareResult.instructions.length === 0) {
      throw new Error(
        'Prepare API returned neither a transaction nor instructions',
      );
    }

    // ── Fallback: instruction list path ──────────────────────────────────────
    // 2. Get blockhash
    const {blockhash} = await getLatestBlockhash(rpcUrl);

    // 3. Build & simulate initial tx to get CU
    const initialTxBytes = buildTransactionBytes({
      instructions: prepareResult.instructions,
      payer: wallet,
      recentBlockhash: blockhash,
    });
    const simResult = await simulateTransaction(
      serializeToBase64(initialTxBytes),
      rpcUrl,
    );
    console.log('[Swap] Simulation result:', JSON.stringify(simResult));
    if (simResult.err) {
      throw new Error(
        `Simulation failed: ${JSON.stringify(
          simResult.err,
        )}\n${simResult.logs.join('\n')}`,
      );
    }

    // 4. Rebuild with CU budget instructions
    const computeUnits = Math.max(
      Math.ceil((simResult.unitsConsumed || 200000) * 1.2),
      50000,
    );
    const finalInstructions = addComputeBudgetInstructions(
      prepareResult.instructions,
      computeUnits,
      1000,
    );
    const {blockhash: freshBlockhash} = await getLatestBlockhash(rpcUrl);
    const finalTxBytes = buildTransactionBytes({
      instructions: finalInstructions,
      payer: wallet,
      recentBlockhash: freshBlockhash,
    });
    const finalTxBase64 = serializeToBase64(finalTxBytes);

    // 5. Sign via Seed Vault
    console.log(
      '[Swap] Requesting signature from Seed Vault (instruction path)...',
    );
    const signingResult = await SeedVault.signTransaction(
      authToken,
      derivationPath,
      finalTxBase64,
    );
    console.log('[Swap] Signing result:', JSON.stringify(signingResult));
    if (!signingResult.signatures || signingResult.signatures.length === 0) {
      throw new Error('Seed Vault returned no signatures');
    }
    const sig = decodeSignatureFromBase64(
      signingResult.signatures[0] as string,
    );
    const signedTxBytes = insertSignature(finalTxBytes, sig, 0);
    const signedTxBase64 = serializeToBase64(signedTxBytes);

    // 6. Send & confirm
    const txSignature = await sendRawTransaction(signedTxBase64, rpcUrl);
    console.log('[Swap] Transaction sent:', txSignature);
    await confirmTransaction(txSignature, rpcUrl, 40000);
    console.log('[Swap] Transaction confirmed:', txSignature);
    return {success: true, signature: txSignature};
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Swap] executeSwap error:', msg);
    return {success: false, error: msg};
  }
}

/**
 * Sign and send a pre-serialised base64 transaction from the prepare API.
 * Flow:
 *   1. Simulate to get required CU (replaceRecentBlockhash=true)
 *   2. Sign with Seed Vault
 *   3. Insert signature into original tx bytes
 *   4. Send & confirm
 */
async function _signAndSendSerializedTx(
  txBase64: string,
  authToken: number,
  derivationPath: string,
  rpcUrl: string,
): Promise<ExecuteSwapResult> {
  console.log('[Swap] Signing pre-built serialised transaction...');

  // 1. Extract message and sign only the message
  // The pre-built tx from API has placeholder sigs (zeros). We need to sign
  // just the message portion, then insert the signature.
  const txBytes = base64DecodeToUint8Array(txBase64);
  const numSignatures = txBytes[0];
  const messageStart = 1 + numSignatures * 64;
  const messageBytes = txBytes.slice(messageStart);
  const messageBase64 = base64Encode(messageBytes);

  const msgSigningResult = await SeedVault.signTransaction(
    authToken,
    derivationPath,
    messageBase64,
  );
  if (
    !msgSigningResult.signatures ||
    msgSigningResult.signatures.length === 0
  ) {
    throw new Error('Seed Vault returned no signatures');
  }

  const sig = decodeSignatureFromBase64(
    msgSigningResult.signatures[0] as string,
  );
  const signedTxBytes = insertSignature(txBytes, sig, 0);
  const signedTxBase64 = base64Encode(signedTxBytes);

  // 4. Send
  console.log('[Swap] Sending signed transaction...');
  const txSignature = await sendRawTransaction(signedTxBase64, rpcUrl);
  console.log('[Swap] Transaction sent:', txSignature);

  // 5. Confirm
  await confirmTransaction(txSignature, rpcUrl, 40000);
  console.log('[Swap] Transaction confirmed:', txSignature);
  return {success: true, signature: txSignature};
}

// ==================== Legacy helpers (kept for compatibility) ====================
export async function getLatestBlockhashLegacy(): Promise<string> {
  const result = await rpcCall('getLatestBlockhash');
  return result.value.blockhash;
}

// ==================== Jupiter Integration ====================

const JUPITER_API_BASE = 'https://api.jup.ag';
const JUPITER_API_KEYS = [
  'e23a33e6-6268-4b3c-b80e-891a9beadd0e',
  '0e3975ba-66d0-4a32-b0b8-96911b9185b9',
];

// Wrapped SOL mint used by Jupiter for native SOL swaps
export const JUPITER_SOL_MINT = 'So11111111111111111111111111111111111111112';

async function jupiterFetch(path: string, options?: RequestInit): Promise<any> {
  for (let i = 0; i < JUPITER_API_KEYS.length; i++) {
    const key = JUPITER_API_KEYS[i];
    try {
      const res = await fetch(`${JUPITER_API_BASE}${path}`, {
        ...options,
        headers: {
          'x-api-key': key,
          'Content-Type': 'application/json',
          ...(options?.headers ?? {}),
        },
      });
      if (res.status === 429 && i < JUPITER_API_KEYS.length - 1) {
        // rate limited — try backup key
        continue;
      }
      return await res.json();
    } catch (err) {
      if (i === JUPITER_API_KEYS.length - 1) {
        throw err;
      }
    }
  }
}

// ── Default Solana token list (hardcoded, shown before user searches) ──────────

export const JUPITER_DEFAULT_SOL_TOKENS: SwapToken[] = [
  {
    mint: 'So11111111111111111111111111111111111111112',
    apiMint: 'So11111111111111111111111111111111111111112',
    prepareApiMint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Solana',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    balance: 0,
    decimals: 9,
    network: 'Solana',
  },
  {
    mint: '6f8deE148nynnSiWshA9vLydEbJGpDeKh5G4PRgjmzG7',
    apiMint: '6f8deE148nynnSiWshA9vLydEbJGpDeKh5G4PRgjmzG7',
    prepareApiMint: '6f8deE148nynnSiWshA9vLydEbJGpDeKh5G4PRgjmzG7',
    symbol: 'solXEN',
    name: 'solXEN',
    logo: 'https://solxen.io/solxen-icon.png',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
    apiMint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
    prepareApiMint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
    symbol: 'SKR',
    name: 'Seeker',
    logo: '',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    apiMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    prepareApiMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    name: 'USD Coin',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    apiMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    prepareApiMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    name: 'USDT',
    logo: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
    apiMint: 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
    prepareApiMint: 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
    symbol: 'USD1',
    name: 'World Liberty Financial USD',
    logo: '',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    apiMint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    prepareApiMint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    symbol: 'PYUSD',
    name: 'PayPal USD',
    logo: 'https://424565.fs1.hubspotusercontent-na1.net/hubfs/424565/PYUSDLOGO.png',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',
    apiMint: 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',
    prepareApiMint: 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',
    symbol: 'JupUSD',
    name: 'JupUSD',
    logo: 'https://static.jup.ag/jupUSD/icon.png',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    apiMint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    prepareApiMint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    symbol: 'JitoSOL',
    name: 'Jito Staked SOL',
    logo: 'https://storage.googleapis.com/token-metadata/JitoSOL-256.png',
    balance: 0,
    decimals: 9,
    network: 'Solana',
  },
  {
    mint: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v',
    apiMint: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v',
    prepareApiMint: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v',
    symbol: 'JupSOL',
    name: 'Jupiter Staked SOL',
    logo: 'https://static.jup.ag/jupSOL/icon.png',
    balance: 0,
    decimals: 9,
    network: 'Solana',
  },
  {
    mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    apiMint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    prepareApiMint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    symbol: 'mSOL',
    name: 'Marinade Staked SOL',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png',
    balance: 0,
    decimals: 9,
    network: 'Solana',
  },
  {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    apiMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    prepareApiMint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
    name: 'Jupiter',
    logo: 'https://static.jup.ag/jup/icon.png',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    apiMint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    prepareApiMint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    symbol: 'RAY',
    name: 'Raydium',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
    apiMint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
    prepareApiMint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    logo: 'https://gateway.pinata.cloud/ipfs/QmZ7L8yd5j36oXXydUiYFiFsRHbi3EdgC4RuFwvM7dcqge',
    balance: 0,
    decimals: 8,
    network: 'Solana',
  },
  {
    mint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    apiMint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    prepareApiMint: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/qfnqNqs3nCAHjnyCgLRDbBtq4p2MtHZxw8YjSyYhPoL/logo.png',
    balance: 0,
    decimals: 8,
    network: 'Solana',
  },
  {
    mint: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
    apiMint: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
    prepareApiMint: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
    symbol: 'ZEC',
    name: 'Zcash',
    logo: 'https://assets.coingecko.com/coins/images/486/small/circle-zcash-color.png',
    balance: 0,
    decimals: 8,
    network: 'Solana',
  },
  {
    mint: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
    apiMint: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
    prepareApiMint: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
    symbol: 'HYPE',
    name: 'Hyperliquid',
    logo: 'https://arweave.net/QBRdRop8wI4PpScSRTKyibv-fQuYBua-WOvC7tuJyJo',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
];

// ── Unified SwapToken metadata cache ─────────────────────────────────────────
//
// Stores name / symbol / logo / decimals for both X1 and Solana tokens.
// Cache key format: "{network}:{mint}"  e.g. "X1:So111..." / "Solana:EPjF..."
// Caching strategy (same for both networks):
//   1. In-memory map  – instant, lives for the app session
//   2. AsyncStorage   – persists across restarts
//   3. Network API    – called only when no cache entry exists

const SWAP_META_CACHE_KEY = 'swap_token_meta_v5';

interface CachedTokenMeta {
  name: string;
  symbol: string;
  logo: string | null;
  decimals: number;
}

// In-memory layer: { "Solana:EPjF...": { name, symbol, logo, decimals }, ... }
let swapMetaMemCache: Record<string, CachedTokenMeta> | null = null;

function metaCacheKey(network: 'X1' | 'Solana', mint: string): string {
  return `${network}:${mint}`;
}

async function loadSwapMetaCache(): Promise<Record<string, CachedTokenMeta>> {
  if (swapMetaMemCache !== null) {
    return swapMetaMemCache;
  }
  try {
    const raw = await AsyncStorage.getItem(SWAP_META_CACHE_KEY);
    swapMetaMemCache = raw ? JSON.parse(raw) : {};
  } catch {
    swapMetaMemCache = {};
  }
  return swapMetaMemCache!;
}

async function saveSwapMetaCache(
  cache: Record<string, CachedTokenMeta>,
): Promise<void> {
  swapMetaMemCache = cache;
  try {
    await AsyncStorage.setItem(SWAP_META_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn('[swap] saveSwapMetaCache failed:', err);
  }
}

/**
 * Merge cached metadata into a list of SwapTokens.
 * Only fills in fields that are missing / empty in the token.
 */
function applyCachedMeta(
  tokens: SwapToken[],
  network: 'X1' | 'Solana',
  cache: Record<string, CachedTokenMeta>,
): SwapToken[] {
  return tokens.map(t => {
    const cached = cache[metaCacheKey(network, t.mint)];
    if (!cached) {
      return t;
    }
    return {
      ...t,
      name: t.name || cached.name,
      symbol: t.symbol || cached.symbol,
      logo: t.logo || cached.logo,
      decimals: t.decimals ?? cached.decimals,
    };
  });
}

/**
 * Write a list of SwapTokens into the shared metadata cache.
 * Called after a successful network fetch.
 */
async function cacheTokenMeta(
  tokens: SwapToken[],
  network: 'X1' | 'Solana',
): Promise<void> {
  const cache = await loadSwapMetaCache();
  let changed = false;
  for (const t of tokens) {
    if (!t.name && !t.symbol && !t.logo) {
      continue; // nothing worth caching
    }
    const key = metaCacheKey(network, t.mint);
    const existing = cache[key];
    if (
      !existing ||
      existing.name !== t.name ||
      existing.symbol !== t.symbol ||
      existing.logo !== t.logo
    ) {
      cache[key] = {
        name: t.name || '',
        symbol: t.symbol || '',
        logo: t.logo ?? null,
        decimals: t.decimals,
      };
      changed = true;
    }
  }
  if (changed) {
    await saveSwapMetaCache(cache);
  }
}

// ── fetchJupiterDefaultSolTokens ──────────────────────────────────────────────

// In-memory list cache for the current session (avoid re-merging every call)
let jupiterDefaultSolTokensCache: SwapToken[] | null = null;

/**
 * Return the default Solana token list with metadata enriched from Jupiter API.
 *
 * First call: loads AsyncStorage cache → if all 17 tokens are present, returns
 * immediately.  Otherwise calls Jupiter /tokens/v2/search once for all mints,
 * saves result to cache, and returns the merged list.
 *
 * Subsequent calls (same session): instant in-memory return.
 */
export async function fetchJupiterDefaultSolTokens(): Promise<SwapToken[]> {
  // 1. In-memory hit
  if (jupiterDefaultSolTokensCache !== null) {
    return jupiterDefaultSolTokensCache;
  }

  const cache = await loadSwapMetaCache();
  const mints = JUPITER_DEFAULT_SOL_TOKENS.map(t => t.mint);

  // 2. Check if every mint is already cached
  const allCached = mints.every(m => !!cache[metaCacheKey('Solana', m)]?.name);

  if (allCached) {
    const result = applyCachedMeta(JUPITER_DEFAULT_SOL_TOKENS, 'Solana', cache);
    jupiterDefaultSolTokensCache = result;
    console.log('[swap] fetchJupiterDefaultSolTokens: all tokens from cache');
    return result;
  }

  // 3. Jupiter API – one request for all mints
  try {
    const query = mints.join(',');
    const data = await jupiterFetch(
      `/tokens/v2/search?query=${encodeURIComponent(query)}`,
    );
    if (!Array.isArray(data)) {
      console.warn('[swap] fetchJupiterDefaultSolTokens: unexpected response');
      return applyCachedMeta(JUPITER_DEFAULT_SOL_TOKENS, 'Solana', cache);
    }

    // Build mint → API metadata map
    const apiMap: Record<string, CachedTokenMeta> = {};
    for (const item of data) {
      if (item.id) {
        apiMap[item.id] = {
          name: item.name ?? '',
          symbol: item.symbol ?? '',
          logo: item.icon ?? null,
          decimals: item.decimals ?? 6,
        };
      }
    }

    // Merge API data into token list.
    // Local hardcoded name/symbol take priority so display names like
    // "Solana" / "SOL" are not overwritten by API values like "Wrapped SOL".
    // For logo: prefer local PNG fallback over API SVG (React Native Image
    // does not support SVG); only use API logo when local is absent AND
    // the API URL is not an SVG.
    const isSvgUrl = (url: string | null): boolean =>
      !!url && (url.endsWith('.svg') || url.includes('.svg?'));

    const merged = JUPITER_DEFAULT_SOL_TOKENS.map(token => {
      const api = apiMap[token.mint];
      if (!api) {
        return token;
      }
      const apiLogo = isSvgUrl(api.logo) ? null : api.logo;
      return {
        ...token,
        name: token.name || api.name,
        symbol: token.symbol || api.symbol,
        logo: token.logo || apiLogo,
        decimals: token.decimals ?? api.decimals,
      };
    });

    // Persist to unified cache
    await cacheTokenMeta(merged, 'Solana');
    jupiterDefaultSolTokensCache = merged;
    console.log(
      '[swap] fetchJupiterDefaultSolTokens: fetched from Jupiter API and cached',
    );
    return merged;
  } catch (err) {
    console.warn(
      '[swap] fetchJupiterDefaultSolTokens failed, using cache/fallback:',
      err,
    );
    return applyCachedMeta(JUPITER_DEFAULT_SOL_TOKENS, 'Solana', cache);
  }
}

// ── Jupiter interfaces ────────────────────────────────────────────────────────

export interface JupiterOrderResult {
  requestId: string;
  transaction: string | null; // base64 unsigned tx (null when no taker)
  inAmount: number;
  outAmount: number;
  inUsdValue: number | null;
  outUsdValue: number | null;
  errorCode: number | null;
  errorMessage: string | null;
}

// ── fetchJupiterOrder ─────────────────────────────────────────────────────────
/**
 * Get a Jupiter Ultra swap order (quote + optionally an unsigned transaction).
 * Pass `taker` to get a signable transaction; omit for a quote-only call.
 * `amountLamports` is in native token units (e.g. 1 SOL = 1_000_000_000).
 */
export async function fetchJupiterOrder(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  taker?: string;
}): Promise<JupiterOrderResult> {
  const {inputMint, outputMint, amountLamports, taker} = params;
  let url =
    '/ultra/v1/order' +
    `?inputMint=${inputMint}` +
    `&outputMint=${outputMint}` +
    `&amount=${amountLamports}`;
  if (taker) {
    url += `&taker=${taker}`;
  }

  const data = await jupiterFetch(url);
  return {
    requestId: data.requestId ?? '',
    transaction: data.transaction ?? null,
    inAmount: Number(data.inAmount ?? 0),
    outAmount: Number(data.outAmount ?? 0),
    inUsdValue: data.inUsdValue ?? null,
    outUsdValue: data.outUsdValue ?? null,
    errorCode: data.errorCode ?? null,
    errorMessage: data.errorMessage ?? null,
  };
}

// ── searchJupiterTokens ───────────────────────────────────────────────────────
/**
 * Search Solana tokens via Jupiter Ultra search API.
 * Returns up to 20 results matching the query (symbol / name / mint).
 */
export async function searchJupiterTokens(query: string): Promise<SwapToken[]> {
  if (!query || query.trim().length < 1) {
    return [];
  }
  try {
    const data = await jupiterFetch(
      `/ultra/v1/search?query=${encodeURIComponent(query.trim())}`,
    );
    if (!Array.isArray(data)) {
      return [];
    }
    return (data as any[]).map(t => ({
      mint: t.id,
      apiMint: t.id,
      prepareApiMint: t.id,
      symbol: t.symbol ?? t.id.slice(0, 6),
      name: t.name ?? t.symbol ?? '',
      logo: t.icon ?? null,
      balance: 0,
      decimals: t.decimals ?? 6,
      network: 'Solana' as const,
    }));
  } catch (err) {
    console.error('[Jupiter] searchJupiterTokens error:', err);
    return [];
  }
}

// ── executeJupiterSwap ────────────────────────────────────────────────────────
/**
 * Full Jupiter Ultra swap flow:
 *   1. Get order (unsigned tx + requestId)
 *   2. Extract message bytes, sign with Seed Vault
 *   3. Insert signature into tx
 *   4. POST /execute with signedTransaction + requestId
 */
export async function executeJupiterSwap(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: number;
  taker: string;
  authToken: number;
  derivationPath: string;
}): Promise<ExecuteSwapResult> {
  const {
    inputMint,
    outputMint,
    amountLamports,
    taker,
    authToken,
    derivationPath,
  } = params;

  try {
    // 1. Get unsigned transaction
    const order = await fetchJupiterOrder({
      inputMint,
      outputMint,
      amountLamports,
      taker,
    });

    if (!order.transaction) {
      const msg =
        order.errorMessage ??
        `Jupiter order failed (code ${order.errorCode ?? 'unknown'})`;
      throw new Error(msg);
    }

    // 2. Extract message bytes (same layout as xDEX legacy tx)
    //    byte 0 = compact-u16 numSignatures (1 byte for ≤ 127 signers)
    //    bytes 1 … numSigs*64 = signature placeholders (zeros)
    //    bytes numSigs*64+1 … = message
    const txBytes = base64DecodeToUint8Array(order.transaction);
    const numSigs = txBytes[0];
    const messageStart = 1 + numSigs * 64;
    const messageBytes = txBytes.slice(messageStart);
    const messageBase64 = base64Encode(messageBytes);

    // 3. Sign with Seed Vault
    console.log('[Jupiter] Requesting Seed Vault signature...');
    const sigResult = await SeedVault.signTransaction(
      authToken,
      derivationPath,
      messageBase64,
    );
    if (!sigResult.signatures || sigResult.signatures.length === 0) {
      throw new Error('Seed Vault returned no signatures');
    }
    const sig = decodeSignatureFromBase64(sigResult.signatures[0] as string);

    // 4. Insert signature at slot 0 (user signer)
    const signedTxBytes = insertSignature(txBytes, sig, 0);
    const signedTxBase64 = base64Encode(signedTxBytes);

    // 5. Submit to Jupiter /execute
    console.log('[Jupiter] Submitting to /execute...');
    const execData = await jupiterFetch('/ultra/v1/execute', {
      method: 'POST',
      body: JSON.stringify({
        signedTransaction: signedTxBase64,
        requestId: order.requestId,
      }),
    });

    console.log('[Jupiter] Execute response:', JSON.stringify(execData));

    if (execData.error && execData.code !== 0) {
      throw new Error(execData.error);
    }

    const signature: string = execData.signature ?? execData.txSignature ?? '';
    return {success: true, signature};
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[Jupiter] executeJupiterSwap error:', msg);
    return {success: false, error: msg};
  }
}
