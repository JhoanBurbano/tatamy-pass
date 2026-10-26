import { describe, expect, it } from 'vitest';
import {
  b64urlDecode, b64urlEncode, checkRotatingWindow, decodeToken, generateKeyPair, publicKeyFromPrivate,
  signCredentialToken, signPayload, signRotatingToken, verifyToken, buildPayload
} from '../src/qr-token.js';
import { CONFIG, DAY1_9AM, KEY, OTHER_KEY, makeCredential } from './fixtures.js';

const KEYS = CONFIG.signingKeys;

describe('base64url', () => {
  it('ida y vuelta', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes);
    expect(b64urlEncode(bytes)).not.toMatch(/[+/=]/);
  });
});

describe('claves', () => {
  it('genera pares distintos y deriva la pública', () => {
    const a = generateKeyPair('a');
    const b = generateKeyPair('b');
    expect(a.privateKeyHex).not.toBe(b.privateKeyHex);
    expect(publicKeyFromPrivate(a.privateKeyHex)).toBe(a.publicKeyHex);
    expect(a.publicKeyHex).toHaveLength(64);
  });
});

describe('token físico', () => {
  const cred = makeCredential(123, 'COMP');

  it('firma y verifica', () => {
    const token = signCredentialToken(cred, KEY);
    expect(token.startsWith('TP1.')).toBe(true);
    const v = verifyToken(token, KEYS);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload).toMatchObject({ v: 1, e: 'nac2026', c: '00123', r: 'COMP', n: 1, k: 'k1' });
      expect(v.payload.z).toEqual(['G', 'W', 'T', 'P']);
      expect(v.payload.exp).toBeUndefined();
    }
  });

  it('decodeToken lee el payload sin verificar', () => {
    const token = signCredentialToken(cred, KEY);
    expect(decodeToken(token)?.c).toBe('00123');
    expect(decodeToken('nada')).toBeNull();
    expect(decodeToken('TP1.' + b64urlEncode(new TextEncoder().encode('{"v":2}')) + '.x')).toBeNull();
  });

  it('rechaza firma alterada', () => {
    const token = signCredentialToken(cred, KEY);
    const [p, b, s] = token.split('.');
    const altered = s[0] === 'A' ? 'B' + s.slice(1) : 'A' + s.slice(1);
    const v = verifyToken(`${p}.${b}.${altered}`, KEYS);
    expect(v).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rechaza payload alterado (cambiar el rol)', () => {
    const token = signCredentialToken(cred, KEY);
    const [p, , s] = token.split('.');
    const tampered = buildPayload({ ...cred, roleCode: 'STAFF' }, 'k1');
    const b = b64urlEncode(new TextEncoder().encode(JSON.stringify(tampered)));
    expect(verifyToken(`${p}.${b}.${s}`, KEYS)).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rechaza firma de otra clave', () => {
    const token = signCredentialToken(cred, { ...OTHER_KEY, kid: 'k1' });
    expect(verifyToken(token, KEYS)).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rechaza kid desconocido', () => {
    const token = signCredentialToken(cred, OTHER_KEY);
    expect(verifyToken(token, KEYS)).toMatchObject({ ok: false, reason: 'UNKNOWN_KEY' });
  });

  it('rechaza formatos malformados', () => {
    expect(verifyToken('', KEYS)).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect(verifyToken('https://example.com/qr', KEYS)).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect(verifyToken('TP1.abc', KEYS)).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect(verifyToken('TP2.a.b', KEYS)).toMatchObject({ ok: false, reason: 'MALFORMED' });
    expect(verifyToken('TP1.!!!.b', KEYS)).toMatchObject({ ok: false, reason: 'MALFORMED' });
    const badJson = b64urlEncode(new TextEncoder().encode('{"v":1,"e":"x"}'));
    expect(verifyToken(`TP1.${badJson}.c`, KEYS)).toMatchObject({ ok: false, reason: 'MALFORMED' });
    const okPayload = b64urlEncode(new TextEncoder().encode(JSON.stringify(buildPayload(cred, 'k1'))));
    expect(verifyToken(`TP1.${okPayload}.cccc`, KEYS)).toMatchObject({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('la firma es estable para el mismo payload', () => {
    const a = signPayload(buildPayload(cred, 'k1'), KEY.privateKeyHex);
    const b = signPayload(buildPayload(cred, 'k1'), KEY.privateKeyHex);
    expect(a).toBe(b);
  });
});

describe('token digital rotativo', () => {
  const cred = makeCredential(5, 'GEN');

  it('incluye iat/exp con ventana de 60 s', () => {
    const token = signRotatingToken(cred, KEY, DAY1_9AM);
    const v = verifyToken(token, KEYS);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payload.iat).toBe(Math.floor(DAY1_9AM / 1000));
    expect(v.payload.exp).toBe(Math.floor(DAY1_9AM / 1000) + 60);
    expect(checkRotatingWindow(v.payload, DAY1_9AM)).toBe('VALID');
    expect(checkRotatingWindow(v.payload, DAY1_9AM + 30_000)).toBe('VALID');
  });

  it('tolera ±5 min de deriva y caduca después', () => {
    const token = signRotatingToken(cred, KEY, DAY1_9AM);
    const v = verifyToken(token, KEYS);
    if (!v.ok) throw new Error('no verificó');
    expect(checkRotatingWindow(v.payload, DAY1_9AM + 60_000 + 299_000)).toBe('VALID');
    expect(checkRotatingWindow(v.payload, DAY1_9AM + 60_000 + 301_000)).toBe('EXPIRED');
    // reloj del scanner atrasado: token "del futuro" > 5 min
    expect(checkRotatingWindow(v.payload, DAY1_9AM - 301_000)).toBe('EXPIRED');
    expect(checkRotatingWindow(v.payload, DAY1_9AM - 200_000)).toBe('VALID');
  });

  it('un token físico es STATIC', () => {
    const v = verifyToken(signCredentialToken(cred, KEY), KEYS);
    if (!v.ok) throw new Error();
    expect(checkRotatingWindow(v.payload, DAY1_9AM)).toBe('STATIC');
  });

  it('dos tokens de minutos distintos son distintos', () => {
    expect(signRotatingToken(cred, KEY, DAY1_9AM)).not.toBe(signRotatingToken(cred, KEY, DAY1_9AM + 60_000));
  });
});
