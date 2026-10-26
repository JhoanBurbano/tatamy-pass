import { describe, expect, it } from 'vitest';
import {
  formatCredentialId, isValidCredentialId, luhnMod36Check, luhnMod36Validate, normalizeCredentialInput, padSeq, parseCredentialId
} from '../src/credential-id.js';

describe('Luhn mod 36', () => {
  it('genera y valida un dígito verificador', () => {
    const check = luhnMod36Check('202600123');
    expect(check).toMatch(/^[0-9A-Z]$/);
    expect(luhnMod36Validate('202600123' + check)).toBe(true);
  });

  it('detecta un carácter cambiado', () => {
    const body = '202600123';
    const check = luhnMod36Check(body);
    expect(luhnMod36Validate('202600124' + check)).toBe(false);
    expect(luhnMod36Validate('202601123' + check)).toBe(false);
  });

  it('detecta transposiciones adyacentes', () => {
    const body = '202600129';
    const check = luhnMod36Check(body);
    expect(luhnMod36Validate('202600192' + check)).toBe(false);
  });

  it('rechaza cadenas vacías o con caracteres inválidos', () => {
    expect(luhnMod36Validate('')).toBe(false);
    expect(luhnMod36Validate('AB-1')).toBe(false);
    expect(() => luhnMod36Check('ñ')).toThrow();
  });
});

describe('formatCredentialId / parseCredentialId', () => {
  it('formatea con ceros y verificador', () => {
    const id = formatCredentialId('TP-2026', 123);
    expect(id).toMatch(/^TP-2026-00123-[0-9A-Z]$/);
    expect(isValidCredentialId(id)).toBe(true);
    expect(parseCredentialId(id)).toMatchObject({ prefix: 'TP', year: '2026', seq: 123, seqPadded: '00123' });
  });

  it('todos los IDs del 1 al 2000 validan y son únicos', () => {
    const ids = new Set<string>();
    for (let i = 1; i <= 2000; i++) {
      const id = formatCredentialId('TP-2026', i);
      expect(isValidCredentialId(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(2000);
  });

  it('rechaza verificador incorrecto', () => {
    const id = formatCredentialId('TP-2026', 42);
    const bad = id.slice(0, -1) + (id.endsWith('A') ? 'B' : 'A');
    expect(parseCredentialId(bad)).toBeNull();
    expect(isValidCredentialId('TP-2026-00042')).toBe(false);
    expect(isValidCredentialId('hola')).toBe(false);
  });

  it('tolera entrada humana (minúsculas, espacios, sin guiones)', () => {
    const id = formatCredentialId('TP-2026', 7);
    const sloppy = id.toLowerCase().replace(/-/g, ' ');
    expect(normalizeCredentialInput(sloppy)).toBe(id);
    expect(isValidCredentialId(sloppy)).toBe(true);
    expect(normalizeCredentialInput('  xyz ')).toBe('XYZ');
  });

  it('valida rangos y prefijos', () => {
    expect(() => padSeq(100000)).toThrow();
    expect(() => padSeq(-1)).toThrow();
    expect(() => formatCredentialId('TATAMI-2026', 1)).toThrow();
  });
});
