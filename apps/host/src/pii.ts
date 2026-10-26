/**
 * Cifrado en reposo de campos sensibles (§10 de 00-DECISIONES): documento de
 * identidad, fecha de nacimiento y documento del acudiente de las personas.
 *
 * Las primitivas viven en `@tatami/core` (`field-crypto.ts`): AES-256-GCM por
 * campo con clave derivada (scrypt) de `TP_KEY_PASSPHRASE` + un salt aleatorio
 * por evento guardado en `meta.pii_salt`. Aquí solo se ata al host: el salt se
 * crea una vez por base, el documento se indexa por HMAC (`persons.document_hash`)
 * y `encryptExistingPii()` migra al arrancar las filas que sigan en claro.
 */
import { createHash } from 'node:crypto';
import {
  decryptField, deriveFieldKey, documentHmac, encryptField, isEncryptedField, newFieldSalt, normalizeDocument as normalize, sameHex, type EmergencyContact, type FieldKey, type Guardian
} from '@tatami/core';
import type { Db } from './db.js';

export const ENC_PREFIX = 'enc:v1:';

export class PiiCipher {
  private readonly key: FieldKey;

  constructor(passphrase: string, readonly salt: Buffer) {
    this.key = deriveFieldKey(passphrase, salt.toString('hex'));
  }

  /** Crea (o recupera) el cipher del evento usando el salt guardado en `meta`. */
  static forDb(db: Db, passphrase: string): PiiCipher {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'pii_salt'").get() as { value: string } | undefined;
    let saltHex: string;
    if (row) saltHex = row.value;
    else {
      saltHex = newFieldSalt();
      db.prepare("INSERT INTO meta (key, value) VALUES ('pii_salt', ?)").run(saltHex);
    }
    return new PiiCipher(passphrase, Buffer.from(saltHex, 'hex'));
  }

  encrypt(plain: string): string {
    return encryptField(this.key, plain);
  }

  /** Descifra; si el valor no está cifrado (fila legada) lo devuelve tal cual. */
  decrypt(value: string | null | undefined): string | undefined {
    return decryptField(this.key, value);
  }

  /** HMAC indexable del documento (normalizado: sin espacios ni puntos, mayúsculas). */
  hashDocument(document: string): string {
    return documentHmac(this.key, document);
  }

  /** Acudiente con el documento cifrado (el nombre queda legible para el panel). */
  encryptGuardian(g: Guardian | undefined): string | null {
    if (!g) return null;
    return JSON.stringify({ ...g, document: g.document ? this.encrypt(g.document) : g.document });
  }

  decryptGuardian(json: string | null | undefined): Guardian | undefined {
    if (!json) return undefined;
    const g = JSON.parse(json) as Guardian;
    return { ...g, document: this.decrypt(g.document) ?? '' };
  }

  /** Contacto de emergencia con el teléfono cifrado (el nombre queda legible). */
  encryptEmergency(c: EmergencyContact | undefined): string | null {
    if (!c) return null;
    return JSON.stringify({ ...c, phone: c.phone ? this.encrypt(c.phone) : c.phone });
  }

  decryptEmergency(json: string | null | undefined): EmergencyContact | undefined {
    if (!json) return undefined;
    const c = JSON.parse(json) as EmergencyContact;
    return { ...c, phone: this.decrypt(c.phone) ?? '' };
  }

  /** Comparación en tiempo constante de dos hashes. */
  static sameHash(a: string, b: string): boolean {
    return sameHex(a, b);
  }
}

export function isEncrypted(value: string): boolean {
  return isEncryptedField(value);
}

export function normalizeDocument(document: string): string {
  return normalize(document);
}

/**
 * Migración de datos: cifra documento, fecha de nacimiento y documento del
 * acudiente (y el teléfono de emergencia) de las filas que todavía estén en claro
 * y calcula `document_hash`. Idempotente: una fila ya cifrada no se toca.
 */
export function encryptExistingPii(db: Db, cipher: PiiCipher): { encrypted: number } {
  const rows = db.prepare(`SELECT id, birth_date, document_number, guardian_json, emergency_json, dedupe_key FROM persons
    WHERE purged_at IS NULL AND (birth_date NOT LIKE 'enc:%' OR (document_number IS NOT NULL AND document_number NOT LIKE 'enc:%')
      OR (document_number IS NOT NULL AND document_hash IS NULL) OR dedupe_key NOT LIKE 'h1:%'
      OR (guardian_json IS NOT NULL AND guardian_json NOT LIKE '%"document":"enc:v1:%')
      OR (emergency_json IS NOT NULL AND emergency_json NOT LIKE '%"phone":"enc:v1:%'))`)
    .all() as { id: string; birth_date: string; document_number: string | null; guardian_json: string | null; emergency_json: string | null; dedupe_key: string }[];
  const upd = db.prepare('UPDATE persons SET birth_date = ?, document_number = ?, document_hash = ?, guardian_json = ?, emergency_json = ?, dedupe_key = ? WHERE id = ?');
  db.transaction(() => {
    for (const r of rows) {
      const birth = isEncrypted(r.birth_date) ? r.birth_date : cipher.encrypt(r.birth_date);
      const docPlain = cipher.decrypt(r.document_number);
      const doc = r.document_number === null ? null : isEncrypted(r.document_number) ? r.document_number : cipher.encrypt(r.document_number);
      let guardian: string | null = r.guardian_json;
      if (r.guardian_json) {
        const g = JSON.parse(r.guardian_json) as Guardian;
        if (g.document && !isEncrypted(g.document)) guardian = cipher.encryptGuardian(g);
      }
      let emergency: string | null = r.emergency_json;
      if (r.emergency_json) {
        const c = JSON.parse(r.emergency_json) as EmergencyContact;
        if (c.phone && !isEncrypted(c.phone)) emergency = cipher.encryptEmergency(c);
      }
      // la clave de dedupe legada contenía la fecha de nacimiento en claro: se guarda como hash
      const key = r.dedupe_key.startsWith('h1:') || r.dedupe_key.startsWith('purged:') ? r.dedupe_key : `h1:${createHash('sha256').update(r.dedupe_key).digest('hex')}`;
      upd.run(birth, doc, docPlain ? cipher.hashDocument(docPlain) : null, guardian, emergency, key, r.id);
    }
  })();
  return { encrypted: rows.length };
}
