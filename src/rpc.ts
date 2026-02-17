// Shared RPC utilities and constants

// ==================== RPC Endpoints ====================
export const X1_RPC_URL = 'https://rpc.mainnet.x1.xyz';
export const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

// ==================== Mint Addresses ====================
export const USDC_MINT = 'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq';
export const NATIVE_XNT_MINT = 'So11111111111111111111111111111111111111111';
export const WRAPPED_XNT_MINT = 'So11111111111111111111111111111111111111112';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

// ==================== Program Addresses ====================
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SYSTEM_PROGRAM = 'SysvarRent1obzu9uEd98Aw22yqPVwPYLd8m2t1LuEL';
export const METADATA_PROGRAM_ID =
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

// ==================== Types ====================
export interface TokenMetadata {
  mint: string;
  name: string | null;
  symbol: string | null;
  logo_uri: string | null;
  usd_price?: number | null;
}

// ==================== Known Token Metadata ====================
export const KNOWN_TOKEN_METADATA: {[mint: string]: TokenMetadata} = {
  B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq: {
    mint: 'B69chRzqzDCmdB5WYB8NRu5Yv5ZA95ABiZcdzCgGm9Tq',
    name: 'USDC.X',
    symbol: 'USDC.X',
    logo_uri: null,
  },
  So11111111111111111111111111111111111111111: {
    mint: 'So11111111111111111111111111111111111111111',
    name: 'XNT',
    symbol: 'XNT',
    logo_uri: null,
  },
  So11111111111111111111111111111111111111112: {
    mint: 'So11111111111111111111111111111111111111112',
    name: 'Wrapped XNT',
    symbol: 'WXNT',
    logo_uri: null,
  },
};

// ==================== RPC Call ====================
export const rpcCall = async (
  method: string,
  params: any[] = [],
  rpcUrl: string = X1_RPC_URL,
): Promise<any> => {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.result;
};

// ==================== Encoding Utilities ====================
export function base64Decode(base64String: string): number[] {
  const binaryString = atob(base64String);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return Array.from(bytes);
}

export function ed25519pubkeyToBase58(bytes: number[]): string {
  const base58Chars =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }
  if (num === BigInt(0)) {
    return '';
  }
  let result = '';
  while (num > 0) {
    const remainder = Number(num % BigInt(58));
    result = base58Chars[remainder] + result;
    num = num / BigInt(58);
  }
  for (const byte of bytes) {
    if (byte === 0) {
      result = '1' + result;
    } else {
      break;
    }
  }
  return result;
}

export function readPubkey(data: number[], offset: number): string {
  const pubkeyBytes = data.slice(offset, offset + 32);
  return ed25519pubkeyToBase58(pubkeyBytes);
}

export function readU64(data: number[], offset: number): number {
  const bytes = data.slice(offset, offset + 8);
  let result = 0;
  for (let i = 0; i < 8; i++) {
    result += bytes[i] * Math.pow(256, i);
  }
  return result;
}

// ==================== xDEX API ====================
export interface XDEXToken {
  mint: string;
  amount: number;
  decimals: number;
  ui_amount: number;
  symbol: string;
  name: string;
  imageUrl: string;
  is_lp_token: boolean;
}

interface XDEXApiResponse {
  success: boolean;
  data: {
    wallet: string;
    network: string;
    tokens: XDEXToken[];
  };
}

export type XDENetwork = 'X1 Mainnet' | 'Solana Mainnet';

const XDEX_API_BASE = 'https://api.xdex.xyz/api/xendex/wallet/tokens';

export async function fetchXDEXWalletTokens(
  walletAddress: string,
  network: XDENetwork,
): Promise<XDEXToken[]> {
  const url = `${XDEX_API_BASE}?wallet_address=${walletAddress}&network=${encodeURIComponent(
    network,
  )}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`xDEX API error: ${response.status}`);
  }

  const data: XDEXApiResponse = await response.json();
  if (!data.success) {
    throw new Error('xDEX API returned unsuccessful response');
  }

  return data.data.tokens;
}

// ==================== Token Metadata ====================
export async function getTokenMetadata(
  mintAddress: string,
  rpcUrl: string = X1_RPC_URL,
): Promise<TokenMetadata> {
  const knownToken = KNOWN_TOKEN_METADATA[mintAddress];

  let name: string | null = knownToken?.name || null;
  let symbol: string | null = knownToken?.symbol || null;
  let logoUri: string | null = knownToken?.logo_uri || null;

  try {
    const result = await rpcCall(
      'getAccountInfo',
      [mintAddress, {encoding: 'jsonParsed'}],
      rpcUrl,
    );

    const parsed = result?.value?.data?.parsed;
    if (parsed?.type === 'mint') {
      const info = parsed.info;
      const extensions = info.extensions || [];

      for (const ext of extensions) {
        if (ext.extension === 'tokenMetadata' && ext.state) {
          if (!name) {
            name = ext.state.name || null;
          }
          if (!symbol) {
            symbol = ext.state.symbol || null;
          }
          const uri = ext.state.uri || null;
          if (uri && !logoUri) {
            try {
              const metaResponse = await fetch(uri);
              const metadata = await metaResponse.json();
              logoUri = metadata.image || null;
            } catch {
              console.log('Failed to fetch metadata URI:', uri);
            }
          }
          break;
        }
      }
    }
  } catch (error) {
    console.log('Failed to get token metadata:', error);
  }

  return {mint: mintAddress, name, symbol, logo_uri: logoUri};
}
