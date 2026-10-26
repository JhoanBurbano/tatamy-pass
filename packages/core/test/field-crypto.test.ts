import { createCipheriv, createHmac, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FIELD_ENC_PREFIX, decryptField, deriveFieldKey, documentHmac, encryptField, isEncryptedField, newFieldSalt, normalizeDocument, sameHex
} from '../src/field-crypto.js';

const salt = '00112233445566778899aabbccddeeff';
const key = deriveFieldKey('passphrase-del-evento', salt);

describe('field-crypto', () => {
  it('cifra y descifra; cada cifrado es distinto (IV aleatorio) y lleva el prefijo', () => {
    const a = encryptField(key, '1061700123');
    const b = encryptField(key, '1061700123');
    expect(a).not.toBe(b);
    expect(isEncryptedField(a)).toBe(true);
    expect(a.startsWith(FIELD_ENC_PREFIX)).toBe(true);
    expect(a.split(':').length).toBe(5);
    expect(decryptField(key, a)).toBe('1061700123');
    expect(decryptField(key, b)).toBe('1061700123');
    expect(decryptField(key, encryptField(key, ''))).toBe('');
    expect(decryptField(key, encryptField(key, 'Ñandú · 2012-05-01'))).toBe('Ñandú · 2012-05-01');
  });

  it('un valor en claro se devuelve tal cual; null/undefined → undefined', () => {
    expect(decryptField(key, '2012-05-01')).toBe('2012-05-01');
    expect(decryptField(key, null)).toBeUndefined();
    expect(decryptField(key, undefined)).toBeUndefined();
    expect(isEncryptedField('2012-05-01')).toBe(false);
    expect(isEncryptedField(null)).toBe(false);
  });

  it('otra passphrase, otro salt o un byte cambiado no descifran', () => {
    const enc = encryptField(key, 'secreto');
    expect(() => decryptField(deriveFieldKey('otra', salt), enc)).toThrow();
    expect(() => decryptField(deriveFieldKey('passphrase-del-evento', newFieldSalt()), enc)).toThrow();
    const parts = enc.split(':');
    parts[4] = (parts[4][0] === '0' ? '1' : '0') + parts[4].slice(1);
    expect(() => decryptField(key, parts.join(':'))).toThrow();
    expect(() => decryptField(key, 'enc:v1:malformado')).toThrow(/formato/);
  });

  it('la derivación es determinista y el salt nuevo es aleatorio de 16 bytes', () => {
    const again = deriveFieldKey('passphrase-del-evento', salt);
    expect(again.aes).toEqual(key.aes);
    expect(again.hmac).toEqual(key.hmac);
    expect(key.aes.length).toBe(32);
    expect(key.hmac.length).toBe(32);
    const s1 = newFieldSalt(), s2 = newFieldSalt();
    expect(s1).toMatch(/^[0-9a-f]{32}$/);
    expect(s1).not.toBe(s2);
  });

  it('HMAC del documento: determinista, normalizado y depende de la clave', () => {
    const h = documentHmac(key, '1.061.700-123');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(documentHmac(key, ' 1061700123 ')).toBe(h);
    expect(documentHmac(key, '1061700124')).not.toBe(h);
    expect(documentHmac(deriveFieldKey('otra', salt), '1061700123')).not.toBe(h);
    expect(normalizeDocument('ab 1.2-3')).toBe('AB123');
    expect(sameHex(h, h)).toBe(true);
    expect(sameHex(h, h.slice(0, -1) + '0')).toBe(h.endsWith('0'));
    expect(sameHex('ab', 'abc')).toBe(false);
  });

  it('es compatible byte a byte con node:crypto (bases cifradas antes de este módulo siguen legibles)', () => {
    const material = scryptSync('passphrase-del-evento', Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    expect(Buffer.from(key.aes).toString('hex')).toBe(material.subarray(0, 32).toString('hex'));
    expect(Buffer.from(key.hmac).toString('hex')).toBe(material.subarray(32, 64).toString('hex'));
    // cifrado hecho con node:crypto en el formato enc:v1
    const iv = Buffer.from('0102030405060708090a0b0c', 'hex');
    const c = createCipheriv('aes-256-gcm', material.subarray(0, 32), iv);
    const ct = Buffer.concat([c.update('1061700123', 'utf8'), c.final()]);
    const legacy = `${FIELD_ENC_PREFIX}${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
    expect(decryptField(key, legacy)).toBe('1061700123');
    // y el HMAC coincide
    expect(documentHmac(key, '1061700123')).toBe(createHmac('sha256', material.subarray(32, 64)).update('1061700123').digest('hex'));
  });
});
