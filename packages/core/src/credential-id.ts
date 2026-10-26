/**
 * ID público corto: `TP-2026-00123-C`.
 * Dígito verificador: Luhn mod 36 (ISO/IEC 7812 generalizado) sobre el cuerpo
 * alfanumérico `202600123` (año + secuencial). Detecta cualquier error de un
 * carácter y la mayoría de transposiciones adyacentes.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const N = ALPHABET.length; // 36

function codePoint(ch: string): number {
  const i = ALPHABET.indexOf(ch);
  if (i < 0) throw new Error(`Carácter no permitido: ${ch}`);
  return i;
}

/** Calcula el carácter de verificación Luhn mod 36 para `input`. */
export function luhnMod36Check(input: string): string {
  const s = input.toUpperCase();
  let factor = 2;
  let sum = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const addend = factor * codePoint(s[i]);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / N) + (addend % N);
  }
  const remainder = sum % N;
  const checkCodePoint = (N - remainder) % N;
  return ALPHABET[checkCodePoint];
}

/** Valida una cadena que ya incluye el carácter de verificación al final. */
export function luhnMod36Validate(inputWithCheck: string): boolean {
  const s = inputWithCheck.toUpperCase();
  if (s.length < 2) return false;
  for (const ch of s) if (!ALPHABET.includes(ch)) return false;
  let factor = 1;
  let sum = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const addend = factor * codePoint(s[i]);
    factor = factor === 2 ? 1 : 2;
    sum += Math.floor(addend / N) + (addend % N);
  }
  return sum % N === 0;
}

export interface ParsedCredentialId {
  prefix: string;
  year: string;
  seq: number;
  seqPadded: string;
  check: string;
}

const ID_RE = /^([A-Z]{2})-(\d{4})-(\d{5})-([0-9A-Z])$/;

/** Formatea `seq` como 5 dígitos con ceros. */
export function padSeq(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0 || seq > 99999) {
    throw new Error(`Secuencial fuera de rango: ${seq}`);
  }
  return String(seq).padStart(5, '0');
}

/**
 * Genera el ID corto. `prefix` tiene la forma `TP-2026`.
 */
export function formatCredentialId(prefix: string, seq: number): string {
  const m = /^([A-Z]{2})-(\d{4})$/.exec(prefix);
  if (!m) throw new Error(`Prefijo inválido: ${prefix}`);
  const year = m[2];
  const padded = padSeq(seq);
  const check = luhnMod36Check(year + padded);
  return `${m[1]}-${year}-${padded}-${check}`;
}

/** Parsea y valida el dígito verificador. Devuelve `null` si no es válido. */
export function parseCredentialId(raw: string): ParsedCredentialId | null {
  const s = normalizeCredentialInput(raw);
  const m = ID_RE.exec(s);
  if (!m) return null;
  const [, prefix, year, seqPadded, check] = m;
  if (!luhnMod36Validate(year + seqPadded + check)) return null;
  return { prefix, year, seq: Number(seqPadded), seqPadded, check };
}

export function isValidCredentialId(raw: string): boolean {
  return parseCredentialId(raw) !== null;
}

/**
 * Tolera entrada humana: minúsculas, espacios, guiones faltantes
 * (`tp 2026 00123 k` → `TP-2026-00123-C`).
 */
export function normalizeCredentialInput(raw: string): string {
  const compact = raw.toUpperCase().replace(/[\s\-_.]/g, '');
  const m = /^([A-Z]{2})(\d{4})(\d{5})([0-9A-Z])$/.exec(compact);
  if (!m) return raw.trim().toUpperCase();
  return `${m[1]}-${m[2]}-${m[3]}-${m[4]}`;
}
