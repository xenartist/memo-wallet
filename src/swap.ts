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
  return {tokens, pools};
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
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg',
    balance: 0,
    decimals: 6,
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
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    apiMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    prepareApiMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    logo: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
    balance: 0,
    decimals: 5,
    network: 'Solana',
  },
  {
    mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    apiMint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    prepareApiMint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    symbol: 'WIF',
    name: 'dogwifhat',
    logo: 'https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    apiMint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    prepareApiMint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    symbol: 'PYTH',
    name: 'Pyth Network',
    logo: 'https://pyth.network/token.svg',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    apiMint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    prepareApiMint: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
    symbol: 'JTO',
    name: 'Jito',
    logo: 'https://metadata.jito.network/token/jto/image',
    balance: 0,
    decimals: 9,
    network: 'Solana',
  },
  {
    mint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
    apiMint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
    prepareApiMint: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
    symbol: 'ORCA',
    name: 'Orca',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png',
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
    mint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    apiMint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    prepareApiMint: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    symbol: 'mSOL',
    name: 'Marinade staked SOL',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png',
    balance: 0,
    decimals: 9,
    network: 'Solana',
  },
  {
    mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
    apiMint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
    prepareApiMint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
    symbol: 'bSOL',
    name: 'BlazeStake Staked SOL',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1/logo.png',
    balance: 0,
    decimals: 9,
    network: 'Solana',
  },
  {
    mint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
    apiMint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
    prepareApiMint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
    symbol: 'WEN',
    name: 'Wen',
    logo: 'https://shdw-drive.genesysgo.net/GwJapVHVvfM4Mw4sU8tn7HnZj9y5REe3jabCnjZpSLKD/wen_logo.png',
    balance: 0,
    decimals: 5,
    network: 'Solana',
  },
  {
    mint: 'MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u',
    apiMint: 'MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u',
    prepareApiMint: 'MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u',
    symbol: 'MEME',
    name: 'Memecoin',
    logo: 'https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    apiMint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    prepareApiMint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    symbol: 'POPCAT',
    name: 'Popcat',
    logo: 'https://bafkreiag3xst6zv73palwznkgmf73cjmrd6egsmydpjajdm5mpynmzfspy.ipfs.nftstorage.link',
    balance: 0,
    decimals: 9,
    network: 'Solana',
  },
  {
    mint: 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7',
    apiMint: 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7',
    prepareApiMint: 'nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7',
    symbol: 'NOS',
    name: 'Nosana',
    logo: 'https://nosana.io/img/NOS_token.png',
    balance: 0,
    decimals: 6,
    network: 'Solana',
  },
  {
    mint: 'SHDWyBxihqiCj6YekG2GUr7wqKLeLAMK1gHZck9pL6y',
    apiMint: 'SHDWyBxihqiCj6YekG2GUr7wqKLeLAMK1gHZck9pL6y',
    prepareApiMint: 'SHDWyBxihqiCj6YekG2GUr7wqKLeLAMK1gHZck9pL6y',
    symbol: 'SHDW',
    name: 'Shadow Token',
    logo: 'https://shdw-drive.genesysgo.net/FyvJxCR8P7NQJS7DApFbWfRgpDLq4bCjHNQ9cGJWr5xN/shadow-drive-logo.png',
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
];

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
