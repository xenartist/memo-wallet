/* eslint-disable no-bitwise */
// Solana transaction builder — no web3.js dependency
// Implements legacy transaction format (version 0 / legacy)

import {base58Decode, base64Encode, base64DecodeToUint8Array} from './rpc';

// ==================== Types ====================

// Instruction format returned by xDEX prepare API
export interface InstructionJSON {
  programId: string;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  // data may be base64 or hex — we detect and normalise
  data: string;
}

// ==================== Compact-U16 Encoding ====================
// Solana uses a custom compact-u16 encoding for small integers

function encodeCompactU16(value: number): Uint8Array {
  if (value < 0x80) {
    return new Uint8Array([value]);
  }
  if (value < 0x4000) {
    return new Uint8Array([(value & 0x7f) | 0x80, value >> 7]);
  }
  return new Uint8Array([
    (value & 0x7f) | 0x80,
    ((value >> 7) & 0x7f) | 0x80,
    value >> 14,
  ]);
}

// ==================== Instruction Data Decoding ====================

function decodeInstructionData(data: string): Uint8Array {
  if (!data || data.length === 0) {
    return new Uint8Array(0);
  }
  // Try base64 first (contains '+', '/', '=' or is a multiple of 4)
  const isHex = /^[0-9a-fA-F]+$/.test(data) && data.length % 2 === 0;
  if (isHex) {
    const bytes = new Uint8Array(data.length / 2);
    for (let i = 0; i < data.length; i += 2) {
      bytes[i / 2] = parseInt(data.slice(i, i + 2), 16);
    }
    return bytes;
  }
  // Assume base64
  return base64DecodeToUint8Array(data);
}

// ==================== Compute Budget Instructions ====================

const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';

// Instruction discriminators
const SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR = 2; // 0x02
const SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR = 3; // 0x03

function encodeU32LE(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ]);
}

function encodeU64LE(value: number): Uint8Array {
  // JS safe integer range is sufficient for micro-lamports
  const lo = value >>> 0;
  const hi = Math.floor(value / 0x100000000);
  return new Uint8Array([
    lo & 0xff,
    (lo >> 8) & 0xff,
    (lo >> 16) & 0xff,
    (lo >> 24) & 0xff,
    hi & 0xff,
    (hi >> 8) & 0xff,
    (hi >> 16) & 0xff,
    (hi >> 24) & 0xff,
  ]);
}

function makeSetComputeUnitLimitInstruction(units: number): InstructionJSON {
  const data = new Uint8Array(5);
  data[0] = SET_COMPUTE_UNIT_LIMIT_DISCRIMINATOR;
  const unitBytes = encodeU32LE(units);
  data.set(unitBytes, 1);
  return {
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    accounts: [],
    data: base64Encode(data),
  };
}

function makeSetComputeUnitPriceInstruction(
  microLamports: number,
): InstructionJSON {
  const data = new Uint8Array(9);
  data[0] = SET_COMPUTE_UNIT_PRICE_DISCRIMINATOR;
  const priceBytes = encodeU64LE(microLamports);
  data.set(priceBytes, 1);
  return {
    programId: COMPUTE_BUDGET_PROGRAM_ID,
    accounts: [],
    data: base64Encode(data),
  };
}

export function addComputeBudgetInstructions(
  instructions: InstructionJSON[],
  computeUnits: number,
  microLamportsPerUnit: number,
): InstructionJSON[] {
  const limitIx = makeSetComputeUnitLimitInstruction(computeUnits);
  const priceIx = makeSetComputeUnitPriceInstruction(microLamportsPerUnit);
  // Prepend CU instructions so they take effect before the swap
  return [limitIx, priceIx, ...instructions];
}

// ==================== Account Deduplication ====================

interface AccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

function buildAccountList(
  payer: string,
  instructions: InstructionJSON[],
): AccountMeta[] {
  const map = new Map<string, AccountMeta>();

  const add = (pubkey: string, isSigner: boolean, isWritable: boolean) => {
    const existing = map.get(pubkey);
    if (existing) {
      existing.isSigner = existing.isSigner || isSigner;
      existing.isWritable = existing.isWritable || isWritable;
    } else {
      map.set(pubkey, {pubkey, isSigner, isWritable});
    }
  };

  // Payer is always first, signer, writable
  add(payer, true, true);

  // Add all instruction accounts
  for (const ix of instructions) {
    for (const acc of ix.accounts) {
      add(acc.pubkey, acc.isSigner, acc.isWritable);
    }
    // Program IDs are read-only, not signers
    add(ix.programId, false, false);
  }

  // Sort: signers+writable → signers+readonly → writable → readonly
  const accounts = Array.from(map.values());
  accounts.sort((a, b) => {
    const scoreA = (a.isSigner ? 2 : 0) + (a.isWritable ? 1 : 0);
    const scoreB = (b.isSigner ? 2 : 0) + (b.isWritable ? 1 : 0);
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    // Keep payer first among equal score
    if (a.pubkey === payer) {
      return -1;
    }
    if (b.pubkey === payer) {
      return 1;
    }
    return 0;
  });

  return accounts;
}

// ==================== Transaction Serialization ====================

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

export interface BuildTransactionParams {
  instructions: InstructionJSON[];
  payer: string;
  recentBlockhash: string;
}

/**
 * Build an unsigned legacy Solana transaction.
 * Returns the raw bytes with placeholder zero signatures.
 */
export function buildTransactionBytes(
  params: BuildTransactionParams,
): Uint8Array {
  const {instructions, payer, recentBlockhash} = params;
  const accounts = buildAccountList(payer, instructions);

  // Count header fields
  let numRequiredSignatures = 0;
  let numReadonlySignedAccounts = 0;
  let numReadonlyUnsignedAccounts = 0;

  for (const acc of accounts) {
    if (acc.isSigner) {
      numRequiredSignatures++;
      if (!acc.isWritable) {
        numReadonlySignedAccounts++;
      }
    } else {
      if (!acc.isWritable) {
        numReadonlyUnsignedAccounts++;
      }
    }
  }

  const accountIndex = new Map<string, number>();
  accounts.forEach((acc, i) => accountIndex.set(acc.pubkey, i));

  // --- Message header (3 bytes) ---
  const header = new Uint8Array([
    numRequiredSignatures,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
  ]);

  // --- Account address table ---
  const addrCount = encodeCompactU16(accounts.length);
  const addrBytes = concat(...accounts.map(acc => base58Decode(acc.pubkey)));

  // --- Recent blockhash (32 bytes) ---
  const blockhashBytes = base58Decode(recentBlockhash);

  // --- Instructions ---
  const ixCount = encodeCompactU16(instructions.length);
  const ixParts: Uint8Array[] = [];

  for (const ix of instructions) {
    const programIdx = accountIndex.get(ix.programId);
    if (programIdx === undefined) {
      throw new Error(`Program ${ix.programId} not found in account list`);
    }

    const ixAccounts = ix.accounts.map(acc => {
      const idx = accountIndex.get(acc.pubkey);
      if (idx === undefined) {
        throw new Error(`Account ${acc.pubkey} not found in account list`);
      }
      return idx;
    });

    const ixData = decodeInstructionData(ix.data);

    const ixBytes = concat(
      new Uint8Array([programIdx]),
      encodeCompactU16(ixAccounts.length),
      new Uint8Array(ixAccounts),
      encodeCompactU16(ixData.length),
      ixData,
    );
    ixParts.push(ixBytes);
  }

  const message = concat(
    header,
    addrCount,
    addrBytes,
    blockhashBytes,
    ixCount,
    ...ixParts,
  );

  // --- Signature placeholder (numRequiredSignatures × 64 zero bytes) ---
  const sigCount = encodeCompactU16(numRequiredSignatures);
  const sigBytes = new Uint8Array(numRequiredSignatures * 64); // zeros = unsigned

  return concat(sigCount, sigBytes, message);
}

/**
 * Insert a real 64-byte signature at position `signerIndex` (0-based).
 * The transaction bytes must have been produced by buildTransactionBytes().
 */
export function insertSignature(
  txBytes: Uint8Array,
  signature: Uint8Array,
  signerIndex: number = 0,
): Uint8Array {
  if (signature.length !== 64) {
    throw new Error(`Signature must be 64 bytes, got ${signature.length}`);
  }
  const result = new Uint8Array(txBytes);
  // Compact-u16 for numSigs is always 1 byte for ≤ 127 signers
  const sigOffset = 1 + signerIndex * 64;
  result.set(signature, sigOffset);
  return result;
}

/**
 * Decode a base64 signature from Seed Vault signing result.
 * Seed Vault returns base64-encoded signatures.
 */
export function decodeSignatureFromBase64(base64Sig: string): Uint8Array {
  return base64DecodeToUint8Array(base64Sig);
}

export function serializeToBase64(txBytes: Uint8Array): string {
  return base64Encode(txBytes);
}

export function deserializeFromBase64(base64: string): Uint8Array {
  return base64DecodeToUint8Array(base64);
}
