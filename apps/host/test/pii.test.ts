import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createDefaultConfig, generateKeyPair } from '@tatami/core';
import { openDb } from '../src/db.js';
import { PiiCipher, encryptExistingPii, isEncrypted, normalizeDocument } from '../src/pii.js';
import { buildApp } from '../src/server.js';

describe('PiiCipher', () => {
  const salt = randomBytes(16);
  const c = new PiiCipher('clave-de-prueba', salt);

  it('cifra y descifra; cada cifrado es distinto (IV aleatorio)', () => {
    const a = c.encrypt('1061700123');
    const b = c.encrypt('1061700123');
    expect(a).not.toBe(b);
    expect(isEncrypted(a)).toBe(true);
    expect(c.decrypt(a)).toBe('1061700123');
    expect(c.decrypt(b)).toBe('1061700123');
    expect(c.decrypt('texto en claro')).toBe('texto en claro');
    expect(c.decrypt(null)).toBeUndefined();
  });

  it('otra passphrase u otro salt no descifran (GCM detecta la manipulación)', () => {
    const enc = c.encrypt('2000-01-01');
    expect(() => new PiiCipher('otra', salt).decrypt(enc)).toThrow();
    expect(() => new PiiCipher('clave-de-prueba', randomBytes(16)).decrypt(enc)).toThrow();
    const tampered = enc.slice(0, -2) + (enc.endsWith('00') ? '11' : '00');
    expect(() => c.decrypt(tampered)).toThrow();
  });

  it('HMAC del documento es determinista, normalizado y depende de la clave', () => {
    expect(c.hashDocument('1.061.700-123')).toBe(c.hashDocument('1061700123'));
    expect(normalizeDocument(' cc 1.061 ')).toBe('CC1061');
    expect(c.hashDocument('1')).not.toBe(new PiiCipher('otra', salt).hashDocument('1'));
    expect(PiiCipher.sameHash(c.hashDocument('1'), c.hashDocument('1'))).toBe(true);
    expect(PiiCipher.sameHash(c.hashDocument('1'), c.hashDocument('2'))).toBe(false);
  });

  it('forDb crea el salt una vez y lo reutiliza', () => {
    const db = openDb(':memory:');
    const a = PiiCipher.forDb(db, 'x');
    const b = PiiCipher.forDb(db, 'x');
    expect(a.salt.equals(b.salt)).toBe(true);
    expect(a.decrypt(b.encrypt('hola'))).toBe('hola');
  });
});

describe('migración de filas en claro', () => {
  it('cifra documento y fecha, calcula el hash y re-hashea la clave de dedupe', () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO persons (id, first_name, last_name, birth_date, document_number, source, dedupe_key, updated_at)
      VALUES ('p1', 'Ana', 'Ruiz', '2000-05-01', '1001', 'seed', 'ana ruiz|2000-05-01|', '2026-01-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO persons (id, first_name, last_name, birth_date, document_number, source, dedupe_key, updated_at)
      VALUES ('p2', 'Luis', 'Gómez', '1999-01-01', NULL, 'seed', 'luis gomez|1999-01-01|', '2026-01-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO persons (id, first_name, last_name, birth_date, document_number, guardian_json, source, dedupe_key, updated_at)
      VALUES ('p3', 'Niña', 'Menor', '2014-01-01', '2002', '{"name":"Pedro Menor","document":"77"}', 'seed', 'nina menor|2014-01-01|', '2026-01-01T00:00:00.000Z')`).run();
    const cipher = PiiCipher.forDb(db, 'pass');
    expect(encryptExistingPii(db, cipher).encrypted).toBe(3);
    const rows = db.prepare('SELECT * FROM persons ORDER BY id').all() as Record<string, string | null>[];
    expect(isEncrypted(rows[0].birth_date!)).toBe(true);
    expect(isEncrypted(rows[0].document_number!)).toBe(true);
    expect(rows[0].document_hash).toBe(cipher.hashDocument('1001'));
    expect(rows[0].dedupe_key!.startsWith('h1:')).toBe(true);
    expect(rows[1].document_number).toBeNull();
    expect(rows[1].document_hash).toBeNull();
    expect(cipher.decrypt(rows[0].birth_date)).toBe('2000-05-01');
    // documento del acudiente cifrado dentro del JSON; el nombre sigue legible
    expect(rows[2].guardian_json).toContain('"document":"enc:v1:');
    expect(rows[2].guardian_json).toContain('Pedro Menor');
    expect(rows[2].guardian_json).not.toContain('"77"');
    expect(cipher.decryptGuardian(rows[2].guardian_json)).toEqual({ name: 'Pedro Menor', document: '77' });
    // idempotente
    expect(encryptExistingPii(db, cipher).encrypted).toBe(0);
  });

  it('en el host: la base no contiene el documento en claro y la búsqueda por documento funciona', async () => {
    const app = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: generateKeyPair('k'), configPath: null });
    app.ctx.users.create('admin', 'admin123', 'ADMIN');
    const p = app.ctx.persons.upsert({ id: 'p_x', firstName: 'Ana', lastName: 'Ruiz', birthDate: '2000-05-01', documentNumber: '1061700123', source: 'seed', guardian: { name: 'Rosa Ruiz', document: '555' } });
    expect(p.documentNumber).toBe('1061700123');
    expect(p.birthDate).toBe('2000-05-01');
    expect(p.guardian).toEqual({ name: 'Rosa Ruiz', document: '555' });
    const raw = app.ctx.db.prepare('SELECT birth_date, document_number, guardian_json, dedupe_key FROM persons WHERE id = ?').get('p_x') as Record<string, string>;
    expect(raw.birth_date).not.toContain('2000');
    expect(raw.document_number).not.toContain('1061700123');
    expect(raw.guardian_json).not.toContain('555');
    expect(raw.dedupe_key).not.toContain('2000-05-01');
    const cred = app.ctx.credentials.issue({ person: p, roleCode: 'COMP' });
    const token = (await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
    const found = await app.inject({ method: 'GET', url: '/credentials?document=1.061.700.123', headers: { authorization: `Bearer ${token}` } });
    expect(found.json().total).toBe(1);
    expect(found.json().items[0].id).toBe(cred.id);
    const none = await app.inject({ method: 'GET', url: '/credentials?document=999', headers: { authorization: `Bearer ${token}` } });
    expect(none.json().total).toBe(0);
    // el upsert por dedupe sigue funcionando con la clave hasheada
    const again = app.ctx.persons.upsert({ id: 'p_y', firstName: 'Ana', lastName: 'Ruiz', birthDate: '2000-05-01', source: 'seed', club: undefined });
    expect(again.id).toBe('p_x');
    await app.close();
  });
});
