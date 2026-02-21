// Send functionality - core logic for token transfers
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SeedVault} from '@solana-mobile/seed-vault-lib';
import {PublicKey, SystemProgram} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import {
  base58Decode,
  base64Encode,
  getLatestBlockhash,
  rpcCall,
  simulateTransaction,
  sendRawTransaction,
  confirmTransaction,
  rpcUrlForNetwork,
} from './rpc';
import {
  buildTransactionBytes,
  insertSignature,
  decodeSignatureFromBase64,
  extractMessage,
  InstructionJSON,
  addComputeBudgetInstructions,
} from './transaction';
import type {PortfolioToken} from './portfolio';

// ==================== Constants ====================

const NATIVE_MINT = '111111111111111111111111111111111111111111';

// Minimum balance for rent exemption (account must keep this amount)
// This is approximately 0.00089088 SOL/XNT for a basic account
const RENT_EXEMPT_MINIMUM = 890880; // lamports

function isNativeToken(mint: string | null): boolean {
  return mint === null || mint === NATIVE_MINT;
}

// ==================== Types ====================

export interface SendHistoryRecord {
  address: string;
  network: 'X1' | 'Solana';
  lastSentAt: number;
  sendCount: number;
  tokenSymbol?: string;
}

export interface SendHistory {
  records: SendHistoryRecord[];
}

export interface SendParams {
  network: 'X1' | 'Solana';
  token: PortfolioToken;
  recipient: string;
  amount: number;
  authToken: number;
  derivationPath: string;
  wallet: string;
}

export interface SendResult {
  success: boolean;
  signature?: string;
  error?: string;
}

// ==================== Address Validation ====================

/**
 * Validate if a string is a valid Solana/X1 address (base58-encoded 32 bytes)
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!address || address.length < 32 || address.length > 44) {
    return false;
  }
  try {
    const decoded = base58Decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

// ==================== ATA (Associated Token Account) Management ====================

/**
 * Detect which token program a mint uses (SPL Token or Token-2022)
 */
async function detectTokenProgram(
  mint: string,
  rpcUrl: string,
): Promise<string> {
  try {
    const accountInfo = await rpcCall(
      'getAccountInfo',
      [mint, {encoding: 'jsonParsed'}],
      rpcUrl,
    );

    if (accountInfo?.value?.owner) {
      const owner = accountInfo.value.owner;
      console.log(`[send] Mint ${mint} owner: ${owner}`);

      // Check if it's Token-2022
      if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) {
        console.log('[send] Detected Token-2022 program');
        return TOKEN_2022_PROGRAM_ID.toBase58();
      }

      // Default to standard Token Program
      console.log('[send] Using standard Token Program');
      return TOKEN_PROGRAM_ID.toBase58();
    }

    // Fallback to standard Token Program
    return TOKEN_PROGRAM_ID.toBase58();
  } catch (error) {
    console.error('[send] Failed to detect token program:', error);
    // Fallback to standard Token Program
    return TOKEN_PROGRAM_ID.toBase58();
  }
}

/**
 * Get the ATA address for a given owner and mint, or null if it doesn't exist
 */
export async function getATA(
  owner: string,
  mint: string,
  rpcUrl: string,
): Promise<string | null> {
  try {
    const result = await rpcCall(
      'getTokenAccountsByOwner',
      [owner, {mint}, {encoding: 'jsonParsed'}],
      rpcUrl,
    );

    if (result.value && result.value.length > 0) {
      return result.value[0].pubkey;
    }
    return null;
  } catch (error) {
    console.error('[send] Failed to get ATA:', error);
    return null;
  }
}

/**
 * Build instruction to create Associated Token Account using @solana/spl-token
 * This uses the official implementation which handles all edge cases correctly
 */
export function buildCreateATAInstruction(params: {
  payer: string;
  owner: string;
  mint: string;
  ataAddress: string;
  tokenProgramId: string;
}): InstructionJSON {
  const {payer, owner, mint, ataAddress, tokenProgramId} = params;

  try {
    // Use official @solana/spl-token instruction builder
    const instruction = createAssociatedTokenAccountIdempotentInstruction(
      new PublicKey(payer),
      new PublicKey(ataAddress),
      new PublicKey(owner),
      new PublicKey(mint),
      new PublicKey(tokenProgramId),
    );

    console.log('[send] Creating ATA with token program:', tokenProgramId);

    // Convert to our InstructionJSON format
    const instructionJSON = {
      programId: instruction.programId.toBase58(),
      accounts: instruction.keys.map(k => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: base64Encode(instruction.data),
    };

    console.log(
      '[send] Create ATA instruction:',
      JSON.stringify(
        {
          programId: instructionJSON.programId,
          accountCount: instructionJSON.accounts.length,
          accounts: instructionJSON.accounts.map((a, i) => ({
            index: i,
            pubkey: a.pubkey,
            isSigner: a.isSigner,
            isWritable: a.isWritable,
          })),
        },
        null,
        2,
      ),
    );

    return instructionJSON;
  } catch (error) {
    console.error('[send] Failed to build create ATA instruction:', error);
    throw new Error(
      `Failed to build ATA instruction: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ==================== Transfer Instructions ====================

/**
 * Create a native token transfer instruction (XNT/SOL) using web3.js
 */
export function createNativeTransferInstruction(params: {
  from: string;
  to: string;
  lamports: number;
}): InstructionJSON {
  const {from, to, lamports} = params;

  try {
    // Use official web3.js SystemProgram.transfer
    const instruction = SystemProgram.transfer({
      fromPubkey: new PublicKey(from),
      toPubkey: new PublicKey(to),
      lamports: BigInt(lamports),
    });

    console.log('[send] Creating native transfer:', {
      from,
      to,
      lamports,
    });

    // Convert to our InstructionJSON format
    return {
      programId: instruction.programId.toBase58(),
      accounts: instruction.keys.map(k => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: base64Encode(instruction.data),
    };
  } catch (error) {
    console.error('[send] Failed to build native transfer instruction:', error);
    throw new Error(
      `Failed to build transfer instruction: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Create an SPL/Token-2022 transfer instruction
 */
export function createSPLTransferInstruction(params: {
  source: string;
  destination: string;
  owner: string;
  amount: number;
  tokenProgramId: string;
}): InstructionJSON {
  const {source, destination, owner, amount, tokenProgramId} = params;

  // Token Program Transfer instruction
  // Instruction layout: [u8 instruction_index, u64 amount]
  const data = new Uint8Array(9);
  data[0] = 3; // Transfer instruction discriminator

  // Encode amount as little-endian u64
  const amountBytes = new Uint8Array(8);
  let value = amount;
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-bitwise
    amountBytes[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  data.set(amountBytes, 1);

  console.log('[send] Creating SPL transfer with program:', tokenProgramId);

  return {
    programId: tokenProgramId,
    accounts: [
      {pubkey: source, isSigner: false, isWritable: true},
      {pubkey: destination, isSigner: false, isWritable: true},
      {pubkey: owner, isSigner: true, isWritable: false},
    ],
    data: base64Encode(data),
  };
}

// ==================== Fee Estimation ====================

export interface FeeEstimate {
  baseFee: number; // lamports
  priorityFee: number; // lamports
  ataCreationFee: number; // lamports (if ATA needs to be created)
  totalFee: number; // lamports
}

/**
 * Estimate transaction fee
 */
export async function estimateSendFee(params: {
  instructions: InstructionJSON[];
  payer: string;
  rpcUrl: string;
  needsCreateATA?: boolean;
}): Promise<FeeEstimate> {
  const {instructions, payer, rpcUrl, needsCreateATA = false} = params;

  try {
    const blockhash = await getLatestBlockhash(rpcUrl);
    const txBytes = buildTransactionBytes({
      instructions,
      payer,
      recentBlockhash: blockhash.blockhash,
    });

    const simResult = await simulateTransaction(base64Encode(txBytes), rpcUrl);

    if (simResult.err) {
      console.warn('[send] Simulation error:', simResult.err);
    }

    const computeUnits = simResult.unitsConsumed || 200000;
    const baseFee = 5000; // 5000 lamports base fee
    const priorityFee = Math.floor(computeUnits * 0.001); // 1 micro-lamport per CU
    const ataCreationFee = needsCreateATA ? 2039280 : 0; // ~0.002 SOL

    return {
      baseFee,
      priorityFee,
      ataCreationFee,
      totalFee: baseFee + priorityFee + ataCreationFee,
    };
  } catch (error) {
    console.error('[send] Fee estimation failed:', error);
    // Return conservative estimate
    return {
      baseFee: 5000,
      priorityFee: 200000,
      ataCreationFee: needsCreateATA ? 2039280 : 0,
      totalFee: 5000 + 200000 + (needsCreateATA ? 2039280 : 0),
    };
  }
}

// ==================== Fee Display Estimation ====================

/**
 * Estimate the fee for display in the confirmation dialog.
 * Builds the same instructions as executeSend but only simulates (no signing).
 * Returns fee in token units (XNT or SOL).
 */
export async function estimateSendFeeForDisplay(params: {
  network: 'X1' | 'Solana';
  token: PortfolioToken;
  recipient: string;
  amount: number;
  wallet: string;
}): Promise<number> {
  const {network, token, recipient, amount, wallet} = params;

  const FALLBACK_FEE = network === 'X1' ? 0.001 : 0.0001;

  try {
    const rpcUrl = rpcUrlForNetwork(
      network === 'X1' ? 'X1 Mainnet' : 'Solana Mainnet',
    );

    const amountLamports = Math.round(amount * Math.pow(10, token.decimals));
    if (amountLamports <= 0) {
      return FALLBACK_FEE;
    }

    const instructions: InstructionJSON[] = [];

    if (isNativeToken(token.mint)) {
      instructions.push(
        createNativeTransferInstruction({
          from: wallet,
          to: recipient,
          lamports: amountLamports,
        }),
      );
    } else {
      const senderATA = await getATA(wallet, token.mint!, rpcUrl);
      if (!senderATA) {
        return FALLBACK_FEE;
      }
      const tokenProgramId = await detectTokenProgram(token.mint!, rpcUrl);
      let recipientATA = await getATA(recipient, token.mint!, rpcUrl);

      if (!recipientATA) {
        try {
          const ownerPubkey = new PublicKey(recipient);
          const mintPubkey = new PublicKey(token.mint!);
          const programIdPubkey = new PublicKey(tokenProgramId);
          const ata = await getAssociatedTokenAddress(
            mintPubkey,
            ownerPubkey,
            false,
            programIdPubkey,
          );
          recipientATA = ata.toBase58();
          instructions.push(
            buildCreateATAInstruction({
              payer: wallet,
              owner: recipient,
              mint: token.mint!,
              ataAddress: recipientATA,
              tokenProgramId,
            }),
          );
        } catch {
          return FALLBACK_FEE;
        }
      }

      instructions.push(
        createSPLTransferInstruction({
          source: senderATA,
          destination: recipientATA,
          owner: wallet,
          amount: amountLamports,
          tokenProgramId,
        }),
      );
    }

    const blockhash = await getLatestBlockhash(rpcUrl);
    const simInstructions = addComputeBudgetInstructions(
      instructions,
      1400000,
      1000,
    );
    const simulateTxBytes = buildTransactionBytes({
      instructions: simInstructions,
      payer: wallet,
      recentBlockhash: blockhash.blockhash,
    });

    const simResult = await simulateTransaction(
      base64Encode(simulateTxBytes),
      rpcUrl,
    );

    const simulatedCU = simResult.unitsConsumed || 200000;
    // baseFee: 5000 lamports; priorityFee: CU * 1000 micro-lamports / 1,000,000
    const totalLamports = 5000 + Math.ceil((simulatedCU * 1000) / 1_000_000);
    return totalLamports / Math.pow(10, 9); // convert lamports to XNT/SOL
  } catch (error) {
    console.warn('[send] Fee estimation failed, using fallback:', error);
    return FALLBACK_FEE;
  }
}

// ==================== Execute Send ====================

/**
 * Execute a token transfer
 */
export async function executeSend(params: SendParams): Promise<SendResult> {
  const {network, token, recipient, amount, authToken, derivationPath, wallet} =
    params;

  try {
    // Validate recipient address
    if (!isValidSolanaAddress(recipient)) {
      return {success: false, error: 'Invalid recipient address format'};
    }

    // Convert amount to lamports/raw units
    const amountLamports = Math.round(amount * Math.pow(10, token.decimals));

    if (amountLamports <= 0) {
      return {success: false, error: 'Amount must be greater than 0'};
    }

    const rpcUrl = rpcUrlForNetwork(
      network === 'X1' ? 'X1 Mainnet' : 'Solana Mainnet',
    );

    const instructions: InstructionJSON[] = [];

    // Native token transfer (XNT/SOL)
    if (isNativeToken(token.mint)) {
      // Check if sender will have enough balance after transfer + fee
      // Account must keep rent-exempt minimum (890880 lamports)
      const currentBalance = Math.round(
        parseFloat(token.rawBalance.toString()) * Math.pow(10, token.decimals),
      );
      const estimatedFee = 5000 + 300; // Base fee + compute budget fee
      const totalDeduction = amountLamports + estimatedFee;
      const remainingBalance = currentBalance - totalDeduction;

      if (remainingBalance < RENT_EXEMPT_MINIMUM) {
        const maxSendable = currentBalance - RENT_EXEMPT_MINIMUM - estimatedFee;
        const maxSendableTokens = maxSendable / Math.pow(10, token.decimals);
        return {
          success: false,
          error: `Insufficient balance. You must keep at least ${
            RENT_EXEMPT_MINIMUM / Math.pow(10, token.decimals)
          } ${
            token.symbol
          } for rent exemption. Maximum sendable: ${maxSendableTokens.toFixed(
            token.decimals,
          )} ${token.symbol}`,
        };
      }

      // Check if recipient account exists
      let actualTransferAmount = amountLamports;
      try {
        const accountInfo = await rpcCall(
          'getAccountInfo',
          [recipient],
          rpcUrl,
        );

        if (!accountInfo || accountInfo.value === null) {
          // Recipient account does not exist
          // Add rent-exempt minimum to the transfer amount
          actualTransferAmount = amountLamports + RENT_EXEMPT_MINIMUM;

          // Check if sender has enough balance for user amount + rent + fee
          const totalNeeded = actualTransferAmount + estimatedFee;
          if (currentBalance < totalNeeded + RENT_EXEMPT_MINIMUM) {
            const rentInTokens =
              RENT_EXEMPT_MINIMUM / Math.pow(10, token.decimals);
            return {
              success: false,
              error: `Recipient account does not exist. You need an additional ${rentInTokens} ${
                token.symbol
              } to create the account (total: ${(
                totalNeeded / Math.pow(10, token.decimals)
              ).toFixed(token.decimals)} ${token.symbol}).`,
            };
          }
        }
      } catch (error) {
        console.warn('[send] Failed to check recipient account:', error);
        // Continue anyway - RPC will handle the error
      }

      instructions.push(
        createNativeTransferInstruction({
          from: wallet,
          to: recipient,
          lamports: actualTransferAmount,
        }),
      );
    }
    // SPL token transfer
    else {
      // Get sender's token account
      const senderATA = await getATA(wallet, token.mint!, rpcUrl);
      if (!senderATA) {
        console.error('[send] Sender ATA not found for mint:', token.mint);
        return {
          success: false,
          error:
            'Token account not found. Please ensure you have this token in your wallet.',
        };
      }

      // Detect which token program this mint uses
      const tokenProgramId = await detectTokenProgram(token.mint!, rpcUrl);

      // Check if recipient has ATA, if not, derive and create it
      let recipientATA = await getATA(recipient, token.mint!, rpcUrl);

      if (!recipientATA) {
        console.log('[send] Recipient ATA not found, deriving address...');
        console.log('[send] Owner:', recipient);
        console.log('[send] Mint:', token.mint);
        console.log('[send] Token Program:', tokenProgramId);

        try {
          // Derive the ATA address using the correct token program
          const ownerPubkey = new PublicKey(recipient);
          const mintPubkey = new PublicKey(token.mint!);
          const programIdPubkey = new PublicKey(tokenProgramId);

          const ata = await getAssociatedTokenAddress(
            mintPubkey,
            ownerPubkey,
            false, // allowOwnerOffCurve
            programIdPubkey,
          );

          recipientATA = ata.toBase58();
          console.log('[send] Derived recipient ATA:', recipientATA);

          // Add instruction to create the ATA (idempotent)
          const createATAIx = buildCreateATAInstruction({
            payer: wallet,
            owner: recipient,
            mint: token.mint!,
            ataAddress: recipientATA,
            tokenProgramId,
          });

          instructions.push(createATAIx);
        } catch (error) {
          console.error('[send] Failed to derive ATA address:', error);
          return {
            success: false,
            error: `Failed to create recipient token account: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      }

      instructions.push(
        createSPLTransferInstruction({
          source: senderATA,
          destination: recipientATA,
          owner: wallet,
          amount: amountLamports,
          tokenProgramId,
        }),
      );
    }

    // Step 1: Build transaction with a high compute budget for simulation
    // We use a high initial limit to ensure simulation succeeds
    console.log(
      '[send] Total instructions before simulation:',
      instructions.length,
    );
    instructions.forEach((ix, i) => {
      console.log(`[send] Instruction ${i}:`, {
        programId: ix.programId,
        accountCount: ix.accounts.length,
      });
    });

    const blockhash = await getLatestBlockhash(rpcUrl);

    // Add compute budget instructions for simulation (with high limit)
    const simInstructions = addComputeBudgetInstructions(
      instructions,
      1400000, // High limit for simulation
      1000,
    );

    const simulateTxBytes = buildTransactionBytes({
      instructions: simInstructions,
      payer: wallet,
      recentBlockhash: blockhash.blockhash,
    });

    // Step 2: Simulate to get actual CU consumption (including CB instructions)
    console.log('[send] Simulating transaction to estimate compute units...');
    const simResult = await simulateTransaction(
      base64Encode(simulateTxBytes),
      rpcUrl,
    );

    // Check for simulation errors
    if (simResult.err) {
      console.error('[send] Simulation failed:', simResult.err);
      const errorMsg =
        typeof simResult.err === 'string'
          ? simResult.err
          : JSON.stringify(simResult.err);
      return {
        success: false,
        error: `Transaction simulation failed: ${errorMsg}`,
      };
    }

    // Step 3: Use simulated CU with 10% buffer for safety
    const simulatedCU = simResult.unitsConsumed || 200000;
    const computeUnits = Math.ceil(simulatedCU * 1.1); // Add 10% buffer
    console.log(
      `[send] Simulated CU: ${simulatedCU}, Using CU limit: ${computeUnits}`,
    );

    // Step 4: Rebuild transaction with optimized compute budget
    const allInstructions = addComputeBudgetInstructions(
      instructions,
      computeUnits,
      1000, // Micro-lamports per unit
    );

    const txBytes = buildTransactionBytes({
      instructions: allInstructions,
      payer: wallet,
      recentBlockhash: blockhash.blockhash,
    });

    // Extract message for signing (Seed Vault signs the message, not the full tx)
    const message = extractMessage(txBytes);

    // Sign transaction with Seed Vault
    const signResult = await SeedVault.signTransaction(
      authToken,
      derivationPath,
      base64Encode(message),
    );

    if (!signResult.signatures || signResult.signatures.length === 0) {
      return {success: false, error: 'Seed Vault did not return signature'};
    }

    const signature = decodeSignatureFromBase64(
      signResult.signatures[0] as string,
    );
    const signedTxBytes = insertSignature(txBytes, signature, 0);
    const signedTxBase64 = base64Encode(signedTxBytes);

    // Send transaction
    console.log('[send] Sending optimized transaction...');
    const txSignature = await sendRawTransaction(signedTxBase64, rpcUrl);

    // Confirm transaction
    await confirmTransaction(txSignature, rpcUrl, 30000);

    return {success: true, signature: txSignature};
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[send] Send failed:', error);
    return {success: false, error: errorMessage};
  }
}

// ==================== History Management ====================

const SEND_HISTORY_KEY = 'SEND_HISTORY';

/**
 * Smart scoring algorithm for sorting history records
 */
function calculateScore(record: SendHistoryRecord, now: number): number {
  const daysSinceLastSent = (now - record.lastSentAt) / (1000 * 60 * 60 * 24);

  // Time decay: high weight within 7 days, then gradual decline
  const timeScore = Math.max(0, 100 - daysSinceLastSent * 10);

  // Frequency score: more sends = higher weight (capped at 100)
  const frequencyScore = Math.min(record.sendCount * 20, 100);

  // Combined score: 60% time, 40% frequency
  return timeScore * 0.6 + frequencyScore * 0.4;
}

/**
 * Sort history records using smart algorithm
 */
export function sortHistoryRecords(
  records: SendHistoryRecord[],
): SendHistoryRecord[] {
  const now = Date.now();
  return records.sort((a, b) => {
    const scoreA = calculateScore(a, now);
    const scoreB = calculateScore(b, now);
    return scoreB - scoreA;
  });
}

/**
 * Load send history from storage
 */
export async function loadSendHistory(): Promise<SendHistory> {
  try {
    const data = await AsyncStorage.getItem(SEND_HISTORY_KEY);
    if (!data) {
      return {records: []};
    }
    return JSON.parse(data);
  } catch (error) {
    console.error('[send] Failed to load history:', error);
    return {records: []};
  }
}

/**
 * Save send history to storage
 */
async function saveSendHistory(history: SendHistory): Promise<void> {
  try {
    await AsyncStorage.setItem(SEND_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('[send] Failed to save history:', error);
  }
}

/**
 * Add a new send record to history
 */
export async function addSendHistory(
  address: string,
  network: 'X1' | 'Solana',
  tokenSymbol: string,
): Promise<void> {
  const history = await loadSendHistory();

  const existingIndex = history.records.findIndex(
    r => r.address === address && r.network === network,
  );

  if (existingIndex >= 0) {
    // Update existing record
    history.records[existingIndex].lastSentAt = Date.now();
    history.records[existingIndex].sendCount += 1;
    history.records[existingIndex].tokenSymbol = tokenSymbol;
  } else {
    // Add new record
    history.records.push({
      address,
      network,
      lastSentAt: Date.now(),
      sendCount: 1,
      tokenSymbol,
    });
  }

  // Smart sort
  history.records = sortHistoryRecords(history.records);

  // Keep only top 10
  history.records = history.records.slice(0, 10);

  await saveSendHistory(history);
}

/**
 * Format timestamp as human-readable relative time
 */
export function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) {
    return `${months}mo ago`;
  }
  if (weeks > 0) {
    return `${weeks}w ago`;
  }
  if (days > 0) {
    return `${days}d ago`;
  }
  if (hours > 0) {
    return `${hours}h ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return 'Just now';
}
