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
// Uses local cache first, then Jupiter API for cache misses.
// Returns a map of mint -> TokenMetadata.
export async function getSolanaTokensMetadata(
  mints: string[],
): Promise<{[mint: string]: TokenMetadata}> {
  const cache = await loadCache();
  const result: {[mint: string]: TokenMetadata} = {};
  const uncachedMints: string[] = [];

  // Separate cached vs uncached
  for (const mint of mints) {
    if (cache[mint] && cache[mint].name && cache[mint].symbol) {
      result[mint] = cache[mint];
    } else {
      uncachedMints.push(mint);
    }
  }

  // Fetch uncached mints in batches of BATCH_SIZE
  if (uncachedMints.length > 0) {
    const batches: string[][] = [];
    for (let i = 0; i < uncachedMints.length; i += BATCH_SIZE) {
      batches.push(uncachedMints.slice(i, i + BATCH_SIZE));
    }

    let needsUpdate = false;
    for (let i = 0; i < batches.length; i++) {
      // Rate limit: wait between batches
      if (i > 0) {
        await sleep(RATE_LIMIT_MS);
      }

      const batchResult = await fetchJupiterBatch(batches[i]);
      for (const metadata of batchResult) {
        result[metadata.mint] = metadata;
        cache[metadata.mint] = metadata;
        needsUpdate = true;
      }

      // For mints not returned by Jupiter, store a minimal entry
      // to avoid re-querying them every time
      for (const mint of batches[i]) {
        if (!result[mint]) {
          const fallback: TokenMetadata = {
            mint,
            name: null,
            symbol: null,
            logo_uri: null,
          };
          result[mint] = fallback;
          cache[mint] = fallback;
          needsUpdate = true;
        }
      }
    }

    // Persist updated cache
    if (needsUpdate) {
      await saveCache(cache);
    }
  }

  return result;
}
