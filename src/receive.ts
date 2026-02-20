// Receive functionality - core logic for viewing wallet address and receive history
import {rpcCall, rpcUrlForNetwork, SwapNetwork} from './rpc';
import {formatTimeAgo} from './send';

// ==================== Types ====================

export interface ReceiveHistoryRecord {
  signature: string;
  from: string;
  timestamp: number;
  token: string;
  amount: number;
  network: 'X1' | 'Solana';
  decimals: number;
}

interface SignatureInfo {
  signature: string;
  slot: number;
  err: null | object;
  memo: null | string;
  blockTime: number | null;
}

interface ParsedInstruction {
  parsed: {
    type: string;
    info: {
      source?: string;
      destination?: string;
      authority?: string;
      amount?: string;
      mint?: string;
      lamports?: number;
    };
  };
  program: string;
  programId: string;
}

// ==================== Receive History ====================

/**
 * Fetch receive history for a wallet across both X1 and Solana networks
 * Returns the most recent incoming transactions merged from both chains
 */
export async function fetchReceiveHistory(
  wallet: string,
  limit: number = 10,
): Promise<ReceiveHistoryRecord[]> {
  try {
    // Fetch from both networks in parallel
    const [x1Records, solRecords] = await Promise.all([
      fetchNetworkReceiveHistory(wallet, 'X1', limit),
      fetchNetworkReceiveHistory(wallet, 'Solana', limit),
    ]);

    // Merge and sort by timestamp (most recent first)
    const allRecords = [...x1Records, ...solRecords].sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    // Return top N records
    return allRecords.slice(0, limit);
  } catch (error) {
    console.error('[Receive] Failed to fetch receive history:', error);
    return [];
  }
}

/**
 * Fetch receive history for a specific network
 */
async function fetchNetworkReceiveHistory(
  wallet: string,
  network: 'X1' | 'Solana',
  limit: number,
): Promise<ReceiveHistoryRecord[]> {
  const networkName: SwapNetwork =
    network === 'X1' ? 'X1 Mainnet' : 'Solana Mainnet';
  const rpcUrl = rpcUrlForNetwork(networkName);
  const records: ReceiveHistoryRecord[] = [];

  try {
    // Step 1: Get recent signatures for this address
    const signaturesResponse = await rpcCall(
      'getSignaturesForAddress',
      [wallet, {limit, commitment: 'confirmed'}],
      rpcUrl,
    );

    if (!signaturesResponse || !Array.isArray(signaturesResponse)) {
      return [];
    }

    const signatures: SignatureInfo[] = signaturesResponse;

    // Step 2: Fetch transaction details for each signature
    for (const sig of signatures) {
      if (sig.err !== null) {
        continue; // Skip failed transactions
      }

      try {
        const txResponse = await rpcCall(
          'getTransaction',
          [
            sig.signature,
            {
              encoding: 'jsonParsed',
              maxSupportedTransactionVersion: 0,
            },
          ],
          rpcUrl,
        );

        if (!txResponse || !txResponse.transaction) {
          continue;
        }

        const tx = txResponse.transaction;
        const message = tx.message;
        const accountKeys = message.accountKeys.map((key: any) =>
          typeof key === 'string' ? key : key.pubkey,
        );

        // Parse instructions to find incoming transfers
        const instructions = message.instructions || [];

        for (const ix of instructions) {
          const parsed = ix as ParsedInstruction;

          // Native SOL/XNT transfer
          if (
            parsed.program === 'system' &&
            parsed.parsed?.type === 'transfer' &&
            parsed.parsed.info.destination === wallet
          ) {
            const amount = parsed.parsed.info.lamports || 0;
            const from = parsed.parsed.info.source || 'Unknown';

            records.push({
              signature: sig.signature,
              from,
              timestamp: sig.blockTime || Date.now() / 1000,
              token: network === 'X1' ? 'XNT' : 'SOL',
              amount: amount / 1e9, // Convert lamports to token units
              network,
              decimals: 9,
            });
            break; // Only count once per transaction
          }

          // SPL Token transfer (Token Program or Token-2022)
          if (
            (parsed.program === 'spl-token' ||
              parsed.programId ===
                'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') &&
            parsed.parsed?.type === 'transfer'
          ) {
            const destination = parsed.parsed.info.destination;

            // Check if this wallet owns the destination account
            const ownerIndex = accountKeys.indexOf(wallet);
            if (ownerIndex === -1) {
              continue;
            }

            // Fetch destination account info to verify ownership
            try {
              const destAccountInfo = await rpcCall(
                'getAccountInfo',
                [destination, {encoding: 'jsonParsed'}],
                rpcUrl,
              );

              if (
                destAccountInfo?.value?.data?.parsed?.info?.owner === wallet
              ) {
                const amount = parsed.parsed.info.amount || '0';
                const mint = parsed.parsed.info.mint || 'Unknown';
                const from = parsed.parsed.info.authority || 'Unknown';

                // Fetch mint info to get decimals and symbol
                const mintInfo = await rpcCall(
                  'getAccountInfo',
                  [mint, {encoding: 'jsonParsed'}],
                  rpcUrl,
                );

                const decimals =
                  mintInfo?.value?.data?.parsed?.info?.decimals || 0;
                const tokenAmount =
                  parseInt(amount, 10) / Math.pow(10, decimals);

                // Try to get token symbol (simplified - just show first 4 chars of mint)
                const tokenSymbol = `${mint.slice(0, 4)}...${mint.slice(-4)}`;

                records.push({
                  signature: sig.signature,
                  from,
                  timestamp: sig.blockTime || Date.now() / 1000,
                  token: tokenSymbol,
                  amount: tokenAmount,
                  network,
                  decimals,
                });
                break;
              }
            } catch (err) {
              console.error('[Receive] Failed to verify token account:', err);
            }
          }
        }
      } catch (error) {
        console.error(
          `[Receive] Failed to parse transaction ${sig.signature}:`,
          error,
        );
      }
    }

    return records;
  } catch (error) {
    console.error(`[Receive] Failed to fetch ${network} history:`, error);
    return [];
  }
}

/**
 * Format receive history record for display
 */
export function formatReceiveRecord(record: ReceiveHistoryRecord): string {
  const time = formatTimeAgo(record.timestamp);
  const amount = record.amount.toFixed(Math.min(record.decimals, 6));
  const fromAddress = formatAddress(record.from);
  return `+${amount} ${record.token} • ${time} • from ${fromAddress}`;
}

/**
 * Format address to shortened version
 */
function formatAddress(address: string): string {
  if (address.length <= 16) {
    return address;
  }
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Generate Solana Pay URI with optional amount and token
 * Format: solana:ADDRESS?amount=X&spl-token=MINT
 */
export function generateSolanaPayURI(
  address: string,
  amount?: number,
  tokenMint?: string,
): string {
  let uri = `solana:${address}`;
  const params: string[] = [];

  if (amount && amount > 0) {
    params.push(`amount=${amount}`);
  }

  if (tokenMint) {
    params.push(`spl-token=${tokenMint}`);
  }

  if (params.length > 0) {
    uri += '?' + params.join('&');
  }

  return uri;
}
