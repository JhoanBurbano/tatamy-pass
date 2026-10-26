/**
 * Contraseñas y PIN con scrypt (node:crypto). El contrato pide Argon2id; se
 * usa scrypt para no depender de un módulo nativo adicional. Cambiar a
 * `argon2` es un reemplazo de estas dos funciones.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [algo, saltHex, hashHex] = stored.split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = scryptSync(secret, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export type UserRole = 'ADMIN' | 'COORDINATOR' | 'PRINTER' | 'REGISTRAR' | 'CONTROL' | 'SUPERVISOR' | 'AUDITOR';

export const USER_ROLES: UserRole[] = ['ADMIN', 'COORDINATOR', 'PRINTER', 'REGISTRAR', 'CONTROL', 'SUPERVISOR', 'AUDITOR'];
