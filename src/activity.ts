// Activity / Transaction History functionality
import {rpcCall, rpcUrlForNetwork} from './rpc';

// ==================== Types ====================

export interface TransactionRecord {
  signature: string;
  blockTime: number; // Unix timestamp in seconds
  fee: number; // fee in lamports
  network: 'X1' | 'Solana';
  err: boolean; // whether the transaction had an error
}

export interface DateSection {
  title: string;
  data: TransactionRecord[];
}

// ==================== Fetch Transaction History ====================

/**
 * Fetch recent transaction signatures for a wallet on a given network.
 * Uses getSignaturesForAddress RPC method.
 */
export async function fetchTransactionHistory(
  walletAddress: string,
  network: 'X1' | 'Solana',
  limit: number = 50,
): Promise<TransactionRecord[]> {
  const rpcUrl = rpcUrlForNetwork(
    network === 'X1' ? 'X1 Mainnet' : 'Solana Mainnet',
  );

  try {
    const result = await rpcCall(
      'getSignaturesForAddress',
      [walletAddress, {limit}],
      rpcUrl,
    );

    if (!Array.isArray(result)) {
      return [];
    }

    return result.map((item: any) => ({
      signature: item.signature,
      blockTime: item.blockTime ?? 0,
      fee: 0, // fee will be fetched on detail view
      network,
      err: item.err !== null,
    }));
  } catch (error) {
    console.error(
      `[activity] Failed to fetch history for ${network}:`,
      error,
    );
    return [];
  }
}

// ==================== Fetch Transaction Detail ====================

export interface TransactionDetail {
  signature: string;
  blockTime: number;
  fee: number; // in lamports
  network: 'X1' | 'Solana';
  err: boolean;
}

/**
 * Fetch detailed info for a single transaction.
 */
export async function fetchTransactionDetail(
  signature: string,
  network: 'X1' | 'Solana',
): Promise<TransactionDetail | null> {
  const rpcUrl = rpcUrlForNetwork(
    network === 'X1' ? 'X1 Mainnet' : 'Solana Mainnet',
  );

  try {
    const result = await rpcCall(
      'getTransaction',
      [signature, {encoding: 'jsonParsed', maxSupportedTransactionVersion: 0}],
      rpcUrl,
    );

    if (!result) {
      return null;
    }

    return {
      signature,
      blockTime: result.blockTime ?? 0,
      fee: result.meta?.fee ?? 0,
      network,
      err: result.meta?.err !== null && result.meta?.err !== undefined,
    };
  } catch (error) {
    console.error('[activity] Failed to fetch tx detail:', error);
    return null;
  }
}

// ==================== Date Grouping ====================

/**
 * Group transactions into date sections based on local device time.
 * Sections: "Today", "Yesterday", or date string like "Mar 10, 2026"
 */
export function groupTransactionsByDate(
  transactions: TransactionRecord[],
): DateSection[] {
  if (transactions.length === 0) {
    return [];
  }

  // Sort by blockTime descending (newest first)
  const sorted = [...transactions].sort((a, b) => b.blockTime - a.blockTime);

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

  const sectionMap = new Map<string, TransactionRecord[]>();

  for (const tx of sorted) {
    const txTime = tx.blockTime * 1000; // convert to ms
    let label: string;

    if (txTime >= todayStart) {
      label = 'Today';
    } else if (txTime >= yesterdayStart) {
      label = 'Yesterday';
    } else {
      const date = new Date(txTime);
      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ];
      label = `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }

    if (!sectionMap.has(label)) {
      sectionMap.set(label, []);
    }
    sectionMap.get(label)!.push(tx);
  }

  const sections: DateSection[] = [];
  for (const [title, data] of sectionMap) {
    sections.push({title, data});
  }

  return sections;
}

// ==================== Explorer URLs ====================

export function getExplorerUrl(
  signature: string,
  network: 'X1' | 'Solana',
): string {
  return network === 'Solana'
    ? `https://explorer.solana.com/tx/${signature}`
    : `https://explorer.mainnet.x1.xyz/tx/${signature}`;
}

// ==================== Format Helpers ====================

/**
 * Format a Unix timestamp (seconds) as a local time string.
 */
export function formatTxTime(blockTime: number): string {
  if (blockTime === 0) {
    return 'Unknown';
  }
  const date = new Date(blockTime * 1000);
  return date.toLocaleString();
}

/**
 * Format fee in lamports to human-readable string.
 */
export function formatFee(
  feeLamports: number,
  network: 'X1' | 'Solana',
): string {
  const fee = feeLamports / 1_000_000_000;
  return `${fee.toFixed(6)} ${network === 'X1' ? 'XNT' : 'SOL'}`;
}

/**
 * Format signature for display: first 8 + last 8
 */
export function formatSignature(signature: string): string {
  if (signature.length <= 20) {
    return signature;
  }
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}
