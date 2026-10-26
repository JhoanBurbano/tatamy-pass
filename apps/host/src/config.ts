/**
 * Config del evento (event.config.json) y clave de firma.
 *
 * Clave privada Ed25519: se guarda cifrada con AES-256-GCM (clave derivada con
 * scrypt de `TP_KEY_PASSPHRASE`) en `keys/signing.enc.json`. En desarrollo, si
 * no hay passphrase, se usa una por defecto y se avisa por consola.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultConfig, generateKeyPair, type EventConfig, type KeyPair } from '@tatami/core';

const HERE = dirname(fileURLToPath(import.meta.url));
export const HOST_ROOT = join(HERE, '..');

export function loadEventConfig(path = process.env.TP_EVENT_CONFIG ?? join(HOST_ROOT, 'event.config.json')): EventConfig {
  if (!existsSync(path)) {
    const cfg = createDefaultConfig();
    writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
    return cfg;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<EventConfig>;
  return { ...createDefaultConfig(), ...raw };
}

interface EncryptedKeyFile {
  kid: string;
  publicKeyHex: string;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function passphrase(): string {
  const p = process.env.TP_KEY_PASSPHRASE;
  if (!p) {
    if (process.env.NODE_ENV === 'production') throw new Error('TP_KEY_PASSPHRASE es obligatoria en producción');
    return 'dev-passphrase-cambiar';
  }
  return p;
}

export function encryptKey(kp: KeyPair, pass: string): EncryptedKeyFile {
  const salt = randomBytes(16);
  const key = scryptSync(pass, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(kp.privateKeyHex, 'utf8'), cipher.final()]);
  return {
    kid: kp.kid, publicKeyHex: kp.publicKeyHex,
    salt: salt.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ct.toString('hex')
  };
}

export function decryptKey(f: EncryptedKeyFile, pass: string): KeyPair {
  const key = scryptSync(pass, Buffer.from(f.salt, 'hex'), 32);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(f.tag, 'hex'));
  const priv = Buffer.concat([decipher.update(Buffer.from(f.ciphertext, 'hex')), decipher.final()]).toString('utf8');
  return { kid: f.kid, publicKeyHex: f.publicKeyHex, privateKeyHex: priv };
}

/** Carga (o crea) la clave de firma del evento. */
export function loadSigningKey(opts: { keysDir?: string; kid?: string } = {}): KeyPair {
  if (process.env.TP_SIGNING_KEY_JSON) {
    return JSON.parse(process.env.TP_SIGNING_KEY_JSON) as KeyPair;
  }
  const dir = opts.keysDir ?? process.env.TP_KEYS_DIR ?? join(HOST_ROOT, 'keys');
  const file = join(dir, 'signing.enc.json');
  const pass = passphrase();
  if (existsSync(file)) {
    return decryptKey(JSON.parse(readFileSync(file, 'utf8')) as EncryptedKeyFile, pass);
  }
  mkdirSync(dir, { recursive: true });
  const kp = generateKeyPair(opts.kid ?? 'k1');
  writeFileSync(file, JSON.stringify(encryptKey(kp, pass), null, 2));
  if (!process.env.TP_KEY_PASSPHRASE) {
    console.warn('[tatami] Clave de firma creada con passphrase de desarrollo. Define TP_KEY_PASSPHRASE en producción.');
  }
  return kp;
}
