/**
 * Token firmado del QR: `TP1.<payload b64url>.<firma Ed25519 b64url>`.
 * Firma Ed25519 con @noble/ed25519 (JS puro: corre en Node y en el navegador).
 * La clave privada solo existe donde se emite (nube/host); los scanners
 * reciben la clave pública en el snapshot de sync.
 */
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import type { Credential, QrPayload, SigningKey } from './types.js';
import { padSeq } from './credential-id.js';

// Habilita la API síncrona de noble (necesita sha512 síncrono).
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export const TOKEN_PREFIX = 'TP1';

// ---------- base64url ----------

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const te = new TextEncoder();
const td = new TextDecoder();

// ---------- claves ----------

export interface KeyPair {
  kid: string;
  privateKeyHex: string;
  publicKeyHex: string;
}

export function generateKeyPair(kid: string): KeyPair {
  const priv = randomBytes(32);
  const pub = ed.getPublicKey(priv);
  return { kid, privateKeyHex: bytesToHex(priv), publicKeyHex: bytesToHex(pub) };
}

export function publicKeyFromPrivate(privateKeyHex: string): string {
  return bytesToHex(ed.getPublicKey(hexToBytes(privateKeyHex)));
}

// ---------- payload ----------

export function buildPayload(cred: Credential, kid: string): QrPayload {
  return {
    v: 1,
    e: cred.eventId,
    c: padSeq(cred.seq),
    r: cred.roleCode,
    z: [...cred.zones],
    f: cred.validFrom,
    t: cred.validTo,
    n: cred.version,
    k: kid
  };
}

/** Serialización canónica (orden fijo de claves) para que la firma sea estable. */
export function serializePayload(p: QrPayload): string {
  const ordered: Record<string, unknown> = {
    v: p.v, e: p.e, c: p.c, r: p.r, z: p.z, f: p.f, t: p.t, n: p.n, k: p.k
  };
  if (p.exp !== undefined) ordered.exp = p.exp;
  if (p.iat !== undefined) ordered.iat = p.iat;
  return JSON.stringify(ordered);
}

// ---------- firmar ----------

export function signPayload(payload: QrPayload, privateKeyHex: string): string {
  const payloadBytes = te.encode(serializePayload(payload));
  const sig = ed.sign(payloadBytes, hexToBytes(privateKeyHex));
  return `${TOKEN_PREFIX}.${b64urlEncode(payloadBytes)}.${b64urlEncode(sig)}`;
}

/** Token físico (impreso): sin expiración, vive lo que dura la credencial. */
export function signCredentialToken(cred: Credential, key: KeyPair): string {
  return signPayload(buildPayload(cred, key.kid), key.privateKeyHex);
}

/**
 * Token digital rotativo: igual que el físico pero con `iat`/`exp`.
 * Ventana por defecto 60 s. Un pantallazo caduca en un minuto.
 */
export function signRotatingToken(
  cred: Credential,
  key: KeyPair,
  nowMs: number,
  windowSeconds = 60
): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: QrPayload = { ...buildPayload(cred, key.kid), iat, exp: iat + windowSeconds };
  return signPayload(payload, key.privateKeyHex);
}

// ---------- verificar ----------

export type TokenVerification =
  | { ok: true; payload: QrPayload; raw: string }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'UNKNOWN_KEY'; raw: string };

function isPayload(x: unknown): x is QrPayload {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  return (
    p.v === 1 &&
    typeof p.e === 'string' &&
    typeof p.c === 'string' &&
    typeof p.r === 'string' &&
    Array.isArray(p.z) &&
    typeof p.f === 'string' &&
    typeof p.t === 'string' &&
    typeof p.n === 'number' &&
    typeof p.k === 'string' &&
    (p.exp === undefined || typeof p.exp === 'number') &&
    (p.iat === undefined || typeof p.iat === 'number')
  );
}

/** Decodifica sin verificar la firma (útil para mostrar info antes de validar). */
export function decodeToken(raw: string): QrPayload | null {
  const parts = raw.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  try {
    const json = JSON.parse(td.decode(b64urlDecode(parts[1])));
    return isPayload(json) ? json : null;
  } catch {
    return null;
  }
}

/**
 * Verifica formato + firma contra las claves públicas conocidas (por `kid`).
 * No evalúa reglas (vigencia, zona, etc.): eso es `evaluateScan`.
 */
export function verifyToken(raw: string, keys: SigningKey[]): TokenVerification {
  const trimmed = raw.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { ok: false, reason: 'MALFORMED', raw: trimmed };
  }
  let payloadBytes: Uint8Array;
  let sig: Uint8Array;
  let payload: QrPayload;
  try {
    payloadBytes = b64urlDecode(parts[1]);
    sig = b64urlDecode(parts[2]);
    const json = JSON.parse(td.decode(payloadBytes));
    if (!isPayload(json)) return { ok: false, reason: 'MALFORMED', raw: trimmed };
    payload = json;
  } catch {
    return { ok: false, reason: 'MALFORMED', raw: trimmed };
  }
  const key = keys.find((k) => k.kid === payload.k);
  if (!key) return { ok: false, reason: 'UNKNOWN_KEY', raw: trimmed };
  if (sig.length !== 64) return { ok: false, reason: 'BAD_SIGNATURE', raw: trimmed };
  let valid = false;
  try {
    valid = ed.verify(sig, payloadBytes, hexToBytes(key.publicKeyHex));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'BAD_SIGNATURE', raw: trimmed };
  return { ok: true, payload, raw: trimmed };
}

/** Estado de un token rotativo frente al reloj local. */
export function checkRotatingWindow(
  payload: QrPayload,
  nowMs: number,
  toleranceSeconds = 300
): 'STATIC' | 'VALID' | 'EXPIRED' {
  if (payload.exp === undefined) return 'STATIC';
  const now = Math.floor(nowMs / 1000);
  if (now > payload.exp + toleranceSeconds) return 'EXPIRED';
  if (payload.iat !== undefined && payload.iat > now + toleranceSeconds) return 'EXPIRED';
  return 'VALID';
}
