/**
 * Contraseñas: Argon2id (`@node-rs/argon2`, binario precompilado) y, si ese módulo
 * no carga en la plataforma, scrypt de `node:crypto`. Los hashes se reconocen por
 * prefijo (`$argon2id$…` / `scrypt$…`), así que ambos conviven en la misma tabla.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

type Argon2 = { hash(p: string, o?: Record<string, unknown>): Promise<string>; verify(h: string, p: string): Promise<boolean> };
let argon2: Argon2 | null | undefined;

async function loadArgon2(): Promise<Argon2 | null> {
  if (argon2 !== undefined) return argon2;
  if (process.env.PASSWORD_HASH === 'scrypt') { argon2 = null; return null; }
  try {
    argon2 = (await import('@node-rs/argon2')) as unknown as Argon2;
  } catch {
    argon2 = null;
  }
  return argon2;
}

export async function hashPassword(password: string): Promise<string> {
  const a = await loadArgon2();
  if (a) return a.hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
  if (!hash) return false;
  if (hash.startsWith('$argon2')) {
    const a = await loadArgon2();
    if (!a) return false;
    try { return await a.verify(hash, password); } catch { return false; }
  }
  if (hash.startsWith('scrypt$')) {
    const [, saltB64, keyB64] = hash.split('$');
    const key = (await scrypt(password, Buffer.from(saltB64, 'base64'), 64)) as Buffer;
    const expected = Buffer.from(keyB64, 'base64');
    return key.length === expected.length && timingSafeEqual(key, expected);
  }
  return false;
}

export function passwordPolicy(password: string): string | undefined {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Combina letras y números.';
  return undefined;
}
