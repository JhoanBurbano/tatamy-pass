/**
 * Log de auditoría encadenado por hash (§10). Cada registro incluye el hash
 * del anterior; alterar o borrar uno rompe la cadena a partir de ahí.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { AuditRecord } from './types.js';

export const GENESIS_HASH = '0'.repeat(64);

const te = new TextEncoder();

/** JSON con claves ordenadas (canónico) para hashes estables. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => {
      if (o[k] !== undefined) acc[k] = sortKeys(o[k]);
      return acc;
    }, {});
  }
  return v;
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(te.encode(text)));
}

export function computeAuditHash(r: Omit<AuditRecord, 'hash'>): string {
  return sha256Hex(canonicalJson({ seq: r.seq, at: r.at, actor: r.actor, action: r.action, payload: r.payload, prevHash: r.prevHash }));
}

/** Crea el siguiente registro encadenado al anterior (o génesis). */
export function appendAudit(
  prev: AuditRecord | null,
  entry: { at: string; actor: string; action: string; payload: unknown }
): AuditRecord {
  const base = {
    seq: (prev?.seq ?? 0) + 1,
    at: entry.at,
    actor: entry.actor,
    action: entry.action,
    payload: entry.payload,
    prevHash: prev?.hash ?? GENESIS_HASH
  };
  return { ...base, hash: computeAuditHash(base) };
}

export type ChainVerification =
  | { ok: true; length: number }
  | { ok: false; brokenAt: number; reason: 'HASH_MISMATCH' | 'PREV_MISMATCH' | 'SEQ_GAP' };

/** Verifica la cadena completa en orden de `seq`. */
export function verifyChain(records: AuditRecord[]): ChainVerification {
  const sorted = [...records].sort((a, b) => a.seq - b.seq);
  let prevHash = GENESIS_HASH;
  let prevSeq = 0;
  for (const r of sorted) {
    if (r.seq !== prevSeq + 1) return { ok: false, brokenAt: r.seq, reason: 'SEQ_GAP' };
    if (r.prevHash !== prevHash) return { ok: false, brokenAt: r.seq, reason: 'PREV_MISMATCH' };
    if (computeAuditHash(r) !== r.hash) return { ok: false, brokenAt: r.seq, reason: 'HASH_MISMATCH' };
    prevHash = r.hash;
    prevSeq = r.seq;
  }
  return { ok: true, length: sorted.length };
}
