// Jupiter Tokens API V2 - Solana token metadata query + local cache
// API docs: https://dev.jup.ag/docs/tokens/v2/token-information
// Rate limit (Free): 1 RPS fixed

import AsyncStorage from '@react-native-async-storage/async-storage';
import {TokenMetadata} from './rpc';

// ==================== Constants ====================
const JUP_API_KEY = 'e23a33e6-6268-4b3c-b80e-891a9beadd0e';
const JUP_SEARCH_URL = 'https://api.jup.ag/tokens/v2/search';
const CACHE_KEY = 'jupiter_token_metadata';
const BATCH_SIZE = 100; // Jupiter API limit per query
const RATE_LIMIT_MS = 1100; // 1 RPS + 100ms buffer

// ==================== In-Memory Cache ====================
let memoryCache: {[mint: string]: TokenMetadata} | null = null;

// ==================== Persistent Cache ====================
async function loadCache(): Promise<{[mint: string]: TokenMetadata}> {
  if (memoryCache !== null) {
    return memoryCache;
  }
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      memoryCache = JSON.parse(raw);
      return memoryCache!;
    }
  } catch (error) {
    console.log('Failed to load Jupiter cache:', error);
  }
  memoryCache = {};
  return memoryCache;
}

async function saveCache(cache: {
  [mint: string]: TokenMetadata;
}): Promise<void> {
  memoryCache = cache;
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.log('Failed to save Jupiter cache:', error);
  }
}

// ==================== Jupiter API ====================
async function fetchJupiterBatch(mints: string[]): Promise<TokenMetadata[]> {
  const query = mints.join(',');
  try {
    const response = await fetch(`${JUP_SEARCH_URL}?query=${query}`, {
      headers: {
        'x-api-key': JUP_API_KEY,
      },
    });

    if (!response.ok) {
      console.log('Jupiter API error:', response.status, response.statusText);
      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      console.log('Jupiter API unexpected response:', data);
      return [];
    }

    return data.map((token: any) => ({
      mint: token.id,
      name: token.name || null,
      symbol: token.symbol || null,
      logo_uri: token.icon || null,
      usd_price: token.usdPrice ?? null,
    }));
  } catch (error) {
    console.error('Failed to fetch Jupiter tokens:', error);
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== Main Function ====================
// Fetch Solana token metadata for a list of mints.
// Always fetches fresh usd_price from Jupiter API.
// Uses cached name/symbol/logo_uri, but falls back to API values if not cached.
// Returns a map of mint -> TokenMetadata (including usd_price).
export async function getSolanaTokensMetadata(
  mints: string[],
): Promise<{[mint: string]: TokenMetadata}> {
  if (mints.length === 0) {
    return {};
  }

  const cache = await loadCache();
  const result: {[mint: string]: TokenMetadata} = {};

  // Deduplicate mints
  const uniqueMints = [...new Set(mints)];

  // Initialize result with cached metadata (without usd_price)
  // usd_price will be filled from API response
  for (const mint of uniqueMints) {
    if (cache[mint]) {
      result[mint] = {
        mint: cache[mint].mint,
        name: cache[mint].name,
        symbol: cache[mint].symbol,
        logo_uri: cache[mint].logo_uri,
        usd_price: null,
      };
    } else {
      result[mint] = {
        mint,
        name: null,
        symbol: null,
        logo_uri: null,
        usd_price: null,
      };
    }
  }

  // Fetch all mints from Jupiter API (to get fresh usd_price)
  const batches: string[][] = [];
  for (let i = 0; i < uniqueMints.length; i += BATCH_SIZE) {
    batches.push(uniqueMints.slice(i, i + BATCH_SIZE));
  }

  let needsCacheUpdate = false;
  const cacheToSave: {[mint: string]: TokenMetadata} = {...cache};

  for (let i = 0; i < batches.length; i++) {
    if (i > 0) {
      await sleep(RATE_LIMIT_MS);
    }

    const batchResult = await fetchJupiterBatch(batches[i]);

    for (const apiMetadata of batchResult) {
      const mint = apiMetadata.mint;

      // Update usd_price from API (always fresh)
      if (result[mint]) {
        result[mint].usd_price = apiMetadata.usd_price;
      }

      // Update metadata from API if not cached, or if API has better data
      const existingCache = cacheToSave[mint];
      if (!existingCache || !existingCache.name || !existingCache.symbol) {
        const metadataToCache: TokenMetadata = {
          mint: apiMetadata.mint,
          name: apiMetadata.name,
          symbol: apiMetadata.symbol,
          logo_uri: apiMetadata.logo_uri,
        };
        cacheToSave[mint] = metadataToCache;
        needsCacheUpdate = true;

        // Also update result with fresh metadata
        if (result[mint]) {
          result[mint].name = apiMetadata.name;
          result[mint].symbol = apiMetadata.symbol;
          result[mint].logo_uri = apiMetadata.logo_uri;
        }
      }
    }

    // For mints not returned by Jupiter, mark as no price available
    for (const mint of batches[i]) {
      const apiResult = batchResult.find((r: TokenMetadata) => r.mint === mint);
      if (!apiResult && result[mint]) {
        result[mint].usd_price = null;
      }

      // Store fallback for uncached mints not in API response
      if (!cacheToSave[mint]) {
        cacheToSave[mint] = {
          mint,
          name: null,
          symbol: null,
          logo_uri: null,
        };
        needsCacheUpdate = true;
      }
    }
  }

  // Persist cache (metadata only, not usd_price)
  if (needsCacheUpdate) {
    await saveCache(cacheToSave);
  }

  return result;
}
