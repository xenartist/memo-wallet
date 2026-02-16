// Swap-specific logic: xDEX pool queries, price calculation, swap instructions

import {
  rpcCall,
  base64Decode,
  readPubkey,
  readU64,
  USDC_MINT,
  WRAPPED_XNT_MINT,
  X1_RPC_URL,
} from './rpc';

// Re-export commonly used constants for swap consumers
export {USDC_MINT, WRAPPED_XNT_MINT} from './rpc';
export {rpcCall} from './rpc';
export type {TokenMetadata} from './rpc';
export {getTokenMetadata} from './rpc';

// ==================== xDEX Constants ====================
export const XDEX_PROGRAM_ID = 'sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN';

const XDEX_API_URL = 'https://api.xdex.xyz/api/xendex';

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

// ==================== xDEX API ====================
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

// ==================== Pool Parsing ====================
function parsePoolState(address: string, data: number[]): PoolInfo | null {
  if (data.length < 400) {
    return null;
  }

  const poolCreator = readPubkey(data, 40);
  const token0Vault = readPubkey(data, 72);
  const token1Vault = readPubkey(data, 104);
  const token0Mint = readPubkey(data, 168);
  const token1Mint = readPubkey(data, 200);
  const status = data[329] ?? 0;
  const token0Decimals = data[331] ?? 9;
  const token1Decimals = data[332] ?? 9;
  const lpSupply = data.length >= 341 ? readU64(data, 333) : 0;

  return {
    address,
    token_0_mint: token0Mint,
    token_1_mint: token1Mint,
    token_0_decimals: token0Decimals,
    token_1_decimals: token1Decimals,
    token_0_vault: token0Vault,
    token_1_vault: token1Vault,
    lp_supply: lpSupply,
    status,
    pool_creator: poolCreator,
  };
}

export async function getAllPools(): Promise<PoolInfo[]> {
  const result = await rpcCall('getProgramAccounts', [
    XDEX_PROGRAM_ID,
    {encoding: 'base64'},
  ]);

  const pools: PoolInfo[] = [];

  if (Array.isArray(result)) {
    for (const account of result) {
      const pubkey = account.pubkey;
      const dataArray = account.account?.data;
      if (dataArray && dataArray[0]) {
        const decoded = base64Decode(dataArray[0]);
        try {
          const poolInfo = parsePoolState(pubkey, decoded);
          if (poolInfo) {
            pools.push(poolInfo);
          }
        } catch (e) {
          console.log('Failed to parse pool:', pubkey, e);
        }
      }
    }
  }

  return pools;
}

export async function findPoolsForPair(
  tokenA: string,
  tokenB: string,
): Promise<PoolInfo[]> {
  const allPools = await getAllPools();

  return allPools.filter(
    pool =>
      (pool.token_0_mint === tokenA && pool.token_1_mint === tokenB) ||
      (pool.token_0_mint === tokenB && pool.token_1_mint === tokenA),
  );
}

export async function findXNTPools(): Promise<PoolInfo[]> {
  const xntMint = WRAPPED_XNT_MINT;
  return findPoolsForPair(xntMint, USDC_MINT);
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

// ==================== Swap Instructions ====================
export function getSwapInstructionData(
  amountInLamports: number,
  minimumAmountOut: number,
): number[] {
  const discriminator = [143, 190, 90, 218, 196, 30, 51, 222];

  const amountInBytes = [];
  let temp = amountInLamports;
  for (let i = 0; i < 8; i++) {
    amountInBytes.push(temp % 256);
    temp = Math.floor(temp / 256);
  }

  const minAmountOutBytes = [];
  temp = minimumAmountOut;
  for (let i = 0; i < 8; i++) {
    minAmountOutBytes.push(temp % 256);
    temp = Math.floor(temp / 256);
  }

  return [...discriminator, ...amountInBytes, ...minAmountOutBytes];
}

export async function getLatestBlockhash(): Promise<string> {
  const result = await rpcCall('getLatestBlockhash');
  return result.value.blockhash;
}

export async function simulateTransaction(
  transactionBase64: string,
): Promise<any> {
  return rpcCall('simulateTransaction', [
    transactionBase64,
    {encoding: 'base64'},
  ]);
}

export function calculateMinimumOutput(
  amountInLamports: number,
  inputDecimals: number,
  outputDecimals: number,
  poolPrice: PoolPrice,
  inputMint: string,
  slippagePercent: number,
): number {
  const amountInTokens = amountInLamports / Math.pow(10, inputDecimals);

  let estimatedOutputTokens: number;
  if (inputMint === poolPrice.token_0_mint) {
    estimatedOutputTokens = amountInTokens * poolPrice.price;
  } else {
    estimatedOutputTokens = amountInTokens / poolPrice.price;
  }

  const minimumOutput = estimatedOutputTokens * (1 - slippagePercent / 100);
  return Math.floor(minimumOutput * Math.pow(10, outputDecimals));
}
