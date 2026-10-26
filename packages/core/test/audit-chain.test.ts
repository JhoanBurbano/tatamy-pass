import { describe, expect, it } from 'vitest';
import { appendAudit, canonicalJson, computeAuditHash, GENESIS_HASH, sha256Hex, verifyChain } from '../src/audit-chain.js';
import type { AuditRecord } from '../src/types.js';

function chain(n: number): AuditRecord[] {
  const out: AuditRecord[] = [];
  let prev: AuditRecord | null = null;
  for (let i = 1; i <= n; i++) {
    prev = appendAudit(prev, { at: `2026-11-20T10:00:0${i % 10}.000Z`, actor: 'admin', action: 'TEST', payload: { i, nested: { b: 1, a: [1, 2] } } });
    out.push(prev);
  }
  return out;
}

describe('audit chain', () => {
  it('canonicalJson ordena claves y omite undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: 2 } })).toBe('{"a":{"c":2},"b":1}');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('encadena y verifica', () => {
    const c = chain(5);
    expect(c[0].prevHash).toBe(GENESIS_HASH);
    expect(c[1].prevHash).toBe(c[0].hash);
    expect(verifyChain(c)).toEqual({ ok: true, length: 5 });
    expect(verifyChain([])).toEqual({ ok: true, length: 0 });
    // el orden de entrada no importa
    expect(verifyChain([...c].reverse())).toEqual({ ok: true, length: 5 });
  });

  it('detecta un registro alterado', () => {
    const c = chain(5);
    c[2] = { ...c[2], payload: { i: 99 } };
    expect(verifyChain(c)).toEqual({ ok: false, brokenAt: 3, reason: 'HASH_MISMATCH' });
  });

  it('detecta un registro alterado con hash recalculado (rompe el siguiente)', () => {
    const c = chain(5);
    const tampered = { ...c[2], payload: { i: 99 } };
    c[2] = { ...tampered, hash: computeAuditHash(tampered) };
    expect(verifyChain(c)).toEqual({ ok: false, brokenAt: 4, reason: 'PREV_MISMATCH' });
  });

  it('detecta un registro borrado', () => {
    const c = chain(5);
    c.splice(1, 1);
    expect(verifyChain(c)).toEqual({ ok: false, brokenAt: 3, reason: 'SEQ_GAP' });
  });
});
