/**
 * Cifrado en reposo de campos sensibles (§10 de 00-DECISIONES): documento de
 * identidad, fecha de nacimiento y documento del acudiente.
 *
 * - AES-256-GCM por campo, IV aleatorio de 12 bytes, etiqueta de 16 bytes.
 * - Clave derivada con scrypt (N=16384, r=8, p=1, 64 bytes) de una passphrase
 *   (`TP_KEY_PASSPHRASE` en el host) + un salt aleatorio **por evento**. Los
 *   primeros 32 bytes cifran; los otros 32 son la clave HMAC para poder buscar
 *   por documento sin descifrar nada.
 * - Formato en columna: `enc:v1:<iv hex>:<tag hex>:<ciphertext hex>`. Lo que
 *   no empieza por `enc:` se trata como texto en claro (fila anterior a la
 *   migración) y lo cifra el host al arrancar.
 *
 * JS puro (@noble/ciphers + @noble/hashes): corre en Node y en el navegador y
 * da el mismo resultado que `node:crypto` con los mismos parámetros, así que
 * las bases cifradas antes de este módulo siguen siendo legibles.
 */
import { gcm } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { scrypt } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

export const FIELD_ENC_PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface FieldKey {
  /** 32 bytes: AES-256-GCM. */
  aes: Uint8Array;
  /** 32 bytes: HMAC-SHA256 para índices (documento). */
  hmac: Uint8Array;
  /** Salt del evento (hex) con el que se derivó. */
  saltHex: string;
}

const te = new TextEncoder();
const td = new TextDecoder();

/** Salt nuevo para un evento (16 bytes, hex). Se guarda en `meta.pii_salt` del host. */
export function newFieldSalt(): string {
  return bytesToHex(randomBytes(16));
}

/** Deriva la clave del evento. Determinista: misma passphrase + mismo salt = misma clave. */
export function deriveFieldKey(passphrase: string, saltHex: string): FieldKey {
  const material = scrypt(te.encode(passphrase), hexToBytes(saltHex), { N: 16384, r: 8, p: 1, dkLen: 64 });
  return { aes: material.slice(0, 32), hmac: material.slice(32, 64), saltHex };
}

export function isEncryptedField(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(FIELD_ENC_PREFIX);
}

/** Cifra un campo. Cada llamada produce un valor distinto (IV aleatorio). */
export function encryptField(key: FieldKey, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const out = gcm(key.aes, iv).encrypt(te.encode(plain)); // ciphertext || tag
  const ct = out.slice(0, out.length - TAG_BYTES);
  const tag = out.slice(out.length - TAG_BYTES);
  return `${FIELD_ENC_PREFIX}${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(ct)}`;
}

/**
 * Descifra un campo. Un valor en claro (sin prefijo) se devuelve tal cual;
 * `null`/`undefined` devuelven `undefined`. Lanza si la clave es otra o el
 * valor fue manipulado (GCM lo detecta).
 */
export function decryptField(key: FieldKey, value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isEncryptedField(value)) return value;
  const parts = value.slice(FIELD_ENC_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Campo cifrado con formato desconocido.');
  const [ivHex, tagHex, ctHex] = parts;
  const joined = new Uint8Array(ctHex.length / 2 + TAG_BYTES);
  joined.set(hexToBytes(ctHex), 0);
  joined.set(hexToBytes(tagHex), ctHex.length / 2);
  return td.decode(gcm(key.aes, hexToBytes(ivHex)).decrypt(joined));
}

/** Documento normalizado para comparar e indexar: sin espacios, puntos ni guiones, en mayúsculas. */
export function normalizeDocument(document: string): string {
  return document.replace(/[\s.\-]/g, '').toUpperCase();
}

/** HMAC-SHA256 (hex) del documento normalizado: índice de búsqueda que no revela el documento. */
export function documentHmac(key: FieldKey, document: string): string {
  return bytesToHex(hmac(sha256, key.hmac, te.encode(normalizeDocument(document))));
}

/** Comparación en tiempo constante de dos hex. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Campos de una persona que van cifrados en reposo. */
export const SENSITIVE_PERSON_FIELDS = ['documentNumber', 'birthDate', 'guardian.document'] as const;
