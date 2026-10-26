/**
 * Passphrase de las claves (TP_KEY_PASSPHRASE) guardada con `safeStorage` de
 * Electron, que usa el llavero del sistema (Keychain en Mac, DPAPI en Windows).
 * Si el llavero no está disponible se guarda en claro con permisos 600 y la app
 * lo avisa ("plain"). Formato del archivo: `v1:<safe|plain>:<base64>`.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Crypt {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(buf: Buffer): string;
}

export type SecretStorage = 'safeStorage' | 'plain' | 'none';

export class PassphraseStore {
  constructor(private file: string, private crypt: Crypt) {}

  storage(): SecretStorage {
    if (!existsSync(this.file)) return 'none';
    const kind = readFileSync(this.file, 'utf8').split(':')[1];
    return kind === 'safe' ? 'safeStorage' : 'plain';
  }

  get(): string | null {
    if (!existsSync(this.file)) return null;
    const [v, kind, b64] = readFileSync(this.file, 'utf8').trim().split(':');
    if (v !== 'v1' || !kind || !b64) return null;
    const buf = Buffer.from(b64, 'base64');
    if (kind === 'safe') {
      if (!this.crypt.available()) throw new Error('El llavero del sistema no está disponible y la passphrase está cifrada con él.');
      return this.crypt.decrypt(buf);
    }
    return buf.toString('utf8');
  }

  set(passphrase: string): SecretStorage {
    if (passphrase.length < 8) throw new Error('La passphrase debe tener al menos 8 caracteres (mejor 20 o más).');
    mkdirSync(dirname(this.file), { recursive: true });
    const safe = this.crypt.available();
    const payload = safe ? this.crypt.encrypt(passphrase) : Buffer.from(passphrase, 'utf8');
    writeFileSync(this.file, `v1:${safe ? 'safe' : 'plain'}:${payload.toString('base64')}\n`);
    try { chmodSync(this.file, 0o600); } catch { /* Windows */ }
    return safe ? 'safeStorage' : 'plain';
  }
}
