import { describe, expect, it } from 'vitest';
import type { Credential } from '@tatami/core';
import { fold, initials, searchCredentials, seqFromQuery } from '../src/lib/search.js';

function cred(seq: number, displayName: string, club?: string): Credential {
  return {
    id: `TP-2026-${String(seq).padStart(5, '0')}-X`, seq, eventId: 'nac2026', personId: `p${seq}`, displayName, club, roleCode: 'COMP',
    zones: ['G'], validFrom: '2026-11-20', validTo: '2026-11-22', version: 1, status: 'DELIVERED', kid: 'k1', issuedAt: '', updatedAt: ''
  };
}

const ALL = [cred(1, 'Juan Pérez'), cred(123, 'María José Gómez', 'Academia Caucana'), cred(1230, 'Andrés Muñoz'), cred(45, 'Sofía Pérez Ruiz')];

describe('búsqueda local', () => {
  it('normaliza tildes y mayúsculas', () => {
    expect(fold('María JOSÉ')).toBe('maria jose');
  });

  it('interpreta IDs cortos y secuenciales', () => {
    expect(seqFromQuery('TP-2026-00123-C')).toBe(123);
    expect(seqFromQuery('tp 2026 00123 c')).toBe(123);
    expect(seqFromQuery('00123')).toBe(123);
    expect(seqFromQuery('123')).toBe(123);
    expect(seqFromQuery('Pérez')).toBeNull();
    expect(seqFromQuery('0')).toBeNull();
  });

  it('encuentra por ID exacto primero', () => {
    const r = searchCredentials(ALL, 'TP-2026-00123-C');
    expect(r[0].seq).toBe(123);
  });

  it('encuentra por nombre sin tildes y por varias palabras', () => {
    expect(searchCredentials(ALL, 'maria gomez').map((c) => c.seq)).toEqual([123]);
    expect(searchCredentials(ALL, 'perez').map((c) => c.seq)).toEqual([1, 45]);
    expect(searchCredentials(ALL, 'Sofia Perez')[0].seq).toBe(45);
  });

  it('encuentra por club si no hay nombre que coincida', () => {
    expect(searchCredentials(ALL, 'caucana').map((c) => c.seq)).toEqual([123]);
  });

  it('respeta el límite y devuelve vacío sin consulta', () => {
    expect(searchCredentials(ALL, 'e', 2).length).toBeLessThanOrEqual(2);
    expect(searchCredentials(ALL, '   ')).toEqual([]);
  });

  it('iniciales', () => {
    expect(initials('María José Gómez')).toBe('MJ');
    expect(initials('juan')).toBe('J');
    expect(initials('')).toBe('?');
  });
});
