/**
 * Repositorios sobre SQLite. Sin lógica de dominio (eso vive en @tatami/core).
 */
import {
  appendAudit, dedupeKey, formatCredentialId, resolveZones, signCredentialToken, verifyChain,
  type AuditRecord, type Credential, type Device, type EventConfig, type KeyPair, type Person, type RevocationEntry, type ScanEvent
} from '@tatami/core';
import { createHash } from 'node:crypto';
import type { Db } from './db.js';
import { hashSecret, randomToken, verifySecret, type UserRole } from './auth.js';
import type { PiiCipher } from './pii.js';

const nowIso = () => new Date().toISOString();

// ---------- usuarios y sesiones ----------

export interface User { id: string; username: string; role: UserRole; club?: string; disabledAt?: string | null; createdAt?: string }

export class UserRepo {
  constructor(private db: Db) {}

  create(username: string, password: string, role: UserRole, club?: string): User {
    const id = `u_${randomToken(6)}`;
    const at = nowIso();
    this.db.prepare('INSERT INTO users (id, username, password_hash, role, club, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, username, hashSecret(password), role, club ?? null, at, at);
    return { id, username, role, club, createdAt: at, disabledAt: null };
  }

  findByUsername(username: string): (User & { passwordHash: string }) | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as Record<string, string> | undefined;
    if (!r) return undefined;
    return { id: r.id, username: r.username, role: r.role as UserRole, club: r.club ?? undefined, passwordHash: r.password_hash, disabledAt: r.disabled_at ?? null, createdAt: r.created_at };
  }

  byId(id: string): User | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, string> | undefined;
    return r ? { id: r.id, username: r.username, role: r.role as UserRole, club: r.club ?? undefined, disabledAt: r.disabled_at ?? null, createdAt: r.created_at } : undefined;
  }

  all(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as Record<string, string>[])
      .map((r) => ({ id: r.id, username: r.username, role: r.role as UserRole, club: r.club ?? undefined, disabledAt: r.disabled_at ?? null, createdAt: r.created_at }));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  setDisabled(id: string, disabled: boolean): void {
    const at = nowIso();
    this.db.prepare('UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?').run(disabled ? at : null, at, id);
    if (disabled) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  resetPassword(id: string, password: string): void {
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashSecret(password), nowIso(), id);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }

  login(username: string, password: string, ttlHours = 12): { token: string; user: User } | null {
    const u = this.findByUsername(username);
    if (!u || u.disabledAt || !verifySecret(password, u.passwordHash)) return null;
    const token = randomToken(32);
    const expires = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    this.db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, u.id, expires);
    return { token, user: { id: u.id, username: u.username, role: u.role, club: u.club } };
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  bySession(token: string): User | undefined {
    const r = this.db.prepare(
      'SELECT u.id, u.username, u.role, u.club FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ? AND u.disabled_at IS NULL'
    ).get(token, nowIso()) as Record<string, string> | undefined;
    return r ? { id: r.id, username: r.username, role: r.role as UserRole, club: r.club ?? undefined } : undefined;
  }

  // --- replicación (standby): filas crudas con hash de contraseña ---
  rawSince(since?: string): Record<string, unknown>[] {
    return (since ? this.db.prepare('SELECT * FROM users WHERE updated_at > ?').all(since) : this.db.prepare('SELECT * FROM users').all()) as Record<string, unknown>[];
  }

  upsertRaw(r: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO users (id, username, password_hash, role, club, created_at, disabled_at, updated_at) VALUES (@id, @username, @password_hash, @role, @club, @created_at, @disabled_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, role = excluded.role, club = excluded.club, disabled_at = excluded.disabled_at, updated_at = excluded.updated_at`)
      .run({ club: null, disabled_at: null, ...r });
  }
}

// ---------- personas ----------

export interface PersonRow extends Person { updatedAt: string; purgedAt?: string | null }

const hashKey = (k: string) => `h1:${createHash('sha256').update(k).digest('hex')}`;

/**
 * Personas. Documento y fecha de nacimiento se guardan cifrados (ver pii.ts) y
 * la clave de dedupe se guarda como hash para no dejar la fecha en claro.
 */
export class PersonRepo {
  constructor(private db: Db, private cipher: PiiCipher) {}

  private rowToPerson(r: Record<string, string | null>): PersonRow {
    return {
      id: r.id!, firstName: r.first_name!, lastName: r.last_name!, birthDate: this.cipher.decrypt(r.birth_date) ?? '',
      documentNumber: this.cipher.decrypt(r.document_number), club: r.club ?? undefined, photoUrl: r.photo_url ?? undefined,
      guardian: this.cipher.decryptGuardian(r.guardian_json),
      delegation: r.delegation ?? undefined, emergencyContact: this.cipher.decryptEmergency(r.emergency_json), eps: r.eps_json ? (JSON.parse(r.eps_json) as Person['eps']) : undefined,
      source: r.source as Person['source'], externalId: r.external_id ?? undefined,
      companionOf: r.companion_of ?? null, relationship: r.relationship ?? undefined,
      updatedAt: r.updated_at ?? '', purgedAt: r.purged_at ?? null
    };
  }

  private params(p: Person, at: string) {
    return {
      id: p.id, first_name: p.firstName, last_name: p.lastName, birth_date: this.cipher.encrypt(p.birthDate),
      document_number: p.documentNumber ? this.cipher.encrypt(p.documentNumber) : null,
      document_hash: p.documentNumber ? this.cipher.hashDocument(p.documentNumber) : null,
      club: p.club ?? null, photo_url: p.photoUrl ?? null, guardian_json: this.cipher.encryptGuardian(p.guardian),
      delegation: p.delegation ?? null, emergency_json: this.cipher.encryptEmergency(p.emergencyContact), eps_json: p.eps ? JSON.stringify(p.eps) : null,
      source: p.source, external_id: p.externalId ?? null, dedupe_key: hashKey(dedupeKey(p)), companion_of: p.companionOf ?? null, relationship: p.relationship ?? null,
      updated_at: at
    };
  }

  upsert(p: Person): PersonRow {
    const key = hashKey(dedupeKey(p));
    this.db.prepare(`INSERT INTO persons (id, first_name, last_name, birth_date, document_number, document_hash, club, photo_url, guardian_json, delegation, emergency_json, eps_json, source, external_id, dedupe_key, companion_of, relationship, updated_at)
      VALUES (@id, @first_name, @last_name, @birth_date, @document_number, @document_hash, @club, @photo_url, @guardian_json, @delegation, @emergency_json, @eps_json, @source, @external_id, @dedupe_key, @companion_of, @relationship, @updated_at)
      ON CONFLICT(dedupe_key) DO UPDATE SET document_number = COALESCE(excluded.document_number, document_number), document_hash = COALESCE(excluded.document_hash, document_hash),
        external_id = COALESCE(excluded.external_id, external_id), photo_url = COALESCE(excluded.photo_url, photo_url),
        guardian_json = COALESCE(excluded.guardian_json, guardian_json), companion_of = COALESCE(excluded.companion_of, companion_of),
        delegation = COALESCE(excluded.delegation, delegation), emergency_json = COALESCE(excluded.emergency_json, emergency_json), eps_json = COALESCE(excluded.eps_json, eps_json),
        relationship = COALESCE(excluded.relationship, relationship), updated_at = excluded.updated_at`).run(this.params(p, nowIso()));
    return this.byDedupeKey(key)!;
  }

  /** Actualiza una persona existente por id (recalcula la clave de dedupe). */
  updateById(p: Person): PersonRow {
    const v = this.params(p, nowIso());
    this.db.prepare(`UPDATE persons SET first_name = @first_name, last_name = @last_name, birth_date = @birth_date, document_number = @document_number, document_hash = @document_hash,
      club = @club, photo_url = @photo_url, guardian_json = @guardian_json, delegation = @delegation, emergency_json = @emergency_json, eps_json = @eps_json, source = @source, external_id = @external_id, dedupe_key = @dedupe_key,
      companion_of = @companion_of, relationship = @relationship, updated_at = @updated_at WHERE id = @id`).run(v);
    return this.byId(p.id)!;
  }

  byDedupeKey(key: string): PersonRow | undefined {
    const r = this.db.prepare('SELECT * FROM persons WHERE dedupe_key = ?').get(key) as Record<string, string | null> | undefined;
    return r ? this.rowToPerson(r) : undefined;
  }

  byId(id: string): PersonRow | undefined {
    const r = this.db.prepare('SELECT * FROM persons WHERE id = ?').get(id) as Record<string, string | null> | undefined;
    return r ? this.rowToPerson(r) : undefined;
  }

  byExternalId(externalId: string): PersonRow | undefined {
    const r = this.db.prepare('SELECT * FROM persons WHERE external_id = ?').get(externalId) as Record<string, string | null> | undefined;
    return r ? this.rowToPerson(r) : undefined;
  }

  /** Búsqueda por documento sin descifrar nada: HMAC indexado. */
  byDocument(document: string): PersonRow[] {
    const h = this.cipher.hashDocument(document);
    return (this.db.prepare('SELECT * FROM persons WHERE document_hash = ?').all(h) as Record<string, string | null>[]).map((r) => this.rowToPerson(r));
  }

  all(): PersonRow[] {
    return (this.db.prepare('SELECT * FROM persons').all() as Record<string, string | null>[]).map((r) => this.rowToPerson(r));
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM persons').get() as { n: number }).n;
  }

  /** Personas que todavía tienen datos personales (no purgadas). */
  countUnpurged(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM persons WHERE purged_at IS NULL').get() as { n: number }).n;
  }

  /** Borra los datos personales (purga a N días). Conserva el id para que credenciales y escaneos sigan cuadrando. */
  purge(id: string, at: string): void {
    this.db.prepare(`UPDATE persons SET first_name = 'Persona', last_name = 'purgada', birth_date = '', document_number = NULL, document_hash = NULL,
      photo_url = NULL, guardian_json = NULL, emergency_json = NULL, eps_json = NULL, external_id = NULL, relationship = NULL, dedupe_key = ?, purged_at = ?, updated_at = ? WHERE id = ?`)
      .run(`purged:${id}`, at, at, id);
  }

  // --- replicación (standby): PII en claro en tránsito (LAN entre hosts); el standby vuelve a cifrar con su clave ---
  plainSince(since?: string): Record<string, unknown>[] {
    const rows = (since ? this.db.prepare('SELECT * FROM persons WHERE updated_at > ?').all(since) : this.db.prepare('SELECT * FROM persons').all()) as Record<string, string | null>[];
    return rows.map((r) => ({
      ...r, birth_date: this.cipher.decrypt(r.birth_date) ?? '', document_number: this.cipher.decrypt(r.document_number) ?? null, document_hash: undefined,
      guardian_json: r.guardian_json ? JSON.stringify(this.cipher.decryptGuardian(r.guardian_json)) : null,
      emergency_json: r.emergency_json ? JSON.stringify(this.cipher.decryptEmergency(r.emergency_json)) : null
    }));
  }

  upsertPlain(r: Record<string, unknown>): void {
    const doc = r.document_number as string | null;
    const v = {
      photo_url: null, club: null, external_id: null, companion_of: null, relationship: null, purged_at: null, delegation: null, eps_json: null, ...r,
      birth_date: r.birth_date ? this.cipher.encrypt(r.birth_date as string) : '',
      document_number: doc ? this.cipher.encrypt(doc) : null, document_hash: doc ? this.cipher.hashDocument(doc) : null,
      guardian_json: r.guardian_json ? this.cipher.encryptGuardian(JSON.parse(r.guardian_json as string)) : null,
      emergency_json: r.emergency_json ? this.cipher.encryptEmergency(JSON.parse(r.emergency_json as string)) : null
    };
    this.db.prepare(`INSERT INTO persons (id, first_name, last_name, birth_date, document_number, document_hash, club, photo_url, guardian_json, delegation, emergency_json, eps_json, source, external_id, dedupe_key, companion_of, relationship, updated_at, purged_at)
      VALUES (@id, @first_name, @last_name, @birth_date, @document_number, @document_hash, @club, @photo_url, @guardian_json, @delegation, @emergency_json, @eps_json, @source, @external_id, @dedupe_key, @companion_of, @relationship, @updated_at, @purged_at)
      ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, birth_date = excluded.birth_date, document_number = excluded.document_number,
        document_hash = excluded.document_hash, club = excluded.club, photo_url = excluded.photo_url, guardian_json = excluded.guardian_json, source = excluded.source,
        delegation = excluded.delegation, emergency_json = excluded.emergency_json, eps_json = excluded.eps_json,
        external_id = excluded.external_id, dedupe_key = excluded.dedupe_key, companion_of = excluded.companion_of, relationship = excluded.relationship,
        updated_at = excluded.updated_at, purged_at = excluded.purged_at`).run(v);
  }
}

// ---------- credenciales ----------

export interface CredentialRow extends Credential { token: string; deliveredAt?: string | null; printedAt?: string | null }

function rowToCredential(r: Record<string, unknown>): CredentialRow {
  return {
    id: r.id as string, seq: r.seq as number, eventId: r.event_id as string, personId: r.person_id as string,
    displayName: r.display_name as string, club: (r.club as string | null) ?? undefined, roleCode: r.role_code as string,
    zones: JSON.parse(r.zones_json as string), validFrom: r.valid_from as string, validTo: r.valid_to as string,
    version: r.version as number, status: r.status as Credential['status'], kid: r.kid as string,
    categoryCode: (r.category_code as string | null) ?? undefined, photoUrl: (r.photo_url as string | null) ?? undefined,
    companionOf: (r.companion_of as string | null) ?? null,
    token: r.token as string, issuedAt: r.issued_at as string, updatedAt: r.updated_at as string,
    deliveredAt: (r.delivered_at as string | null) ?? null, printedAt: (r.printed_at as string | null) ?? null
  };
}

/** Lo que ve un scanner: sin token ni datos sensibles. */
export function publicCredential(c: CredentialRow): Credential {
  const { token: _token, deliveredAt: _d, printedAt: _p, ...rest } = c;
  return rest;
}

export interface CredentialSearch {
  /** Texto libre: nombre, ID corto, club. */
  q?: string;
  /** Documento de identidad (búsqueda exacta por HMAC). */
  document?: string;
  roleCode?: string;
  status?: Credential['status'];
  club?: string;
  limit?: number;
  offset?: number;
}

export class CredentialRepo {
  constructor(private db: Db, private config: EventConfig, private key: KeyPair) {}

  nextSeq(): number {
    const r = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM credentials').get() as { m: number };
    return r.m + 1;
  }

  issue(args: { person: Person; roleCode: string; categoryCode?: string; validFrom?: string; validTo?: string; zones?: string[]; companionOf?: string | null }): CredentialRow {
    const role = this.config.roles.find((r) => r.code === args.roleCode);
    if (!role) throw new Error(`Rol desconocido: ${args.roleCode}`);
    const seq = this.nextSeq();
    const at = nowIso();
    const base: Credential = {
      id: formatCredentialId(this.config.idPrefix, seq), seq, eventId: this.config.eventId, personId: args.person.id,
      displayName: `${args.person.firstName} ${args.person.lastName}`.trim(), club: args.person.club, roleCode: role.code,
      zones: args.zones ?? resolveZones(role.zones, this.config), validFrom: args.validFrom ?? this.config.startDate,
      validTo: args.validTo ?? this.config.endDate, version: 1, status: 'ISSUED', kid: this.key.kid,
      categoryCode: args.categoryCode, photoUrl: args.person.photoUrl, companionOf: args.companionOf ?? null, issuedAt: at, updatedAt: at
    };
    const token = signCredentialToken(base, this.key);
    this.insert({ ...base, token });
    return { ...base, token };
  }

  private insert(c: CredentialRow): void {
    this.db.prepare(`INSERT INTO credentials (id, seq, event_id, person_id, display_name, club, role_code, zones_json, valid_from, valid_to, version, status, kid, category_code, photo_url, token, issued_at, updated_at, companion_of)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      c.id, c.seq, c.eventId, c.personId, c.displayName, c.club ?? null, c.roleCode, JSON.stringify(c.zones), c.validFrom, c.validTo,
      c.version, c.status, c.kid, c.categoryCode ?? null, c.photoUrl ?? null, c.token, c.issuedAt, c.updatedAt, c.companionOf ?? null
    );
  }

  byId(id: string): CredentialRow | undefined {
    const r = this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? rowToCredential(r) : undefined;
  }

  byPersonId(personId: string): CredentialRow | undefined {
    const r = this.db.prepare('SELECT * FROM credentials WHERE person_id = ? ORDER BY seq DESC LIMIT 1').get(personId) as Record<string, unknown> | undefined;
    return r ? rowToCredential(r) : undefined;
  }

  /** Acompañantes ligados a la credencial de un participante. */
  companionsOf(credentialId: string): CredentialRow[] {
    return (this.db.prepare('SELECT * FROM credentials WHERE companion_of = ? ORDER BY seq').all(credentialId) as Record<string, unknown>[]).map(rowToCredential);
  }

  countCompanions(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM credentials WHERE role_code = 'ACOMP' AND status != 'REVOKED'").get() as { n: number }).n;
  }

  bySeq(seq: number): CredentialRow | undefined {
    const r = this.db.prepare('SELECT * FROM credentials WHERE seq = ?').get(seq) as Record<string, unknown> | undefined;
    return r ? rowToCredential(r) : undefined;
  }

  all(opts: { updatedSince?: string } = {}): CredentialRow[] {
    const rows = opts.updatedSince
      ? this.db.prepare('SELECT * FROM credentials WHERE updated_at > ? ORDER BY seq').all(opts.updatedSince)
      : this.db.prepare('SELECT * FROM credentials ORDER BY seq').all();
    return (rows as Record<string, unknown>[]).map(rowToCredential);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM credentials').get() as { n: number }).n;
  }

  /** Búsqueda del panel. El documento se resuelve por HMAC en PersonRepo (ids de persona). */
  search(f: CredentialSearch, personIdsByDocument?: string[]): { items: CredentialRow[]; total: number } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.q?.trim()) {
      const q = `%${f.q.trim()}%`;
      where.push('(display_name LIKE ? COLLATE NOCASE OR id LIKE ? COLLATE NOCASE OR club LIKE ? COLLATE NOCASE OR person_id = ?)');
      params.push(q, q, q, f.q.trim());
    }
    if (personIdsByDocument) {
      if (!personIdsByDocument.length) return { items: [], total: 0 };
      where.push(`person_id IN (${personIdsByDocument.map(() => '?').join(',')})`);
      params.push(...personIdsByDocument);
    }
    if (f.roleCode) { where.push('role_code = ?'); params.push(f.roleCode); }
    if (f.status) { where.push('status = ?'); params.push(f.status); }
    if (f.club) { where.push('club = ?'); params.push(f.club); }
    const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM credentials${sql}`).get(...params) as { n: number }).n;
    const limit = Math.min(Math.max(1, f.limit ?? 50), 500);
    const rows = this.db.prepare(`SELECT * FROM credentials${sql} ORDER BY seq LIMIT ? OFFSET ?`).all(...params, limit, f.offset ?? 0) as Record<string, unknown>[];
    return { items: rows.map(rowToCredential), total };
  }

  /** Credenciales que llegaron de la nube (persona con external_id) y siguen sin imprimir ni entregar. */
  pendingFromCloud(limit = 50, offset = 0): { items: CredentialRow[]; total: number; byRole: Record<string, number> } {
    const where = "FROM credentials c JOIN persons p ON p.id = c.person_id WHERE p.external_id IS NOT NULL AND c.status = 'ISSUED'";
    const total = (this.db.prepare(`SELECT COUNT(*) AS n ${where}`).get() as { n: number }).n;
    const byRole = Object.fromEntries((this.db.prepare(`SELECT c.role_code AS r, COUNT(*) AS n ${where} GROUP BY c.role_code`).all() as { r: string; n: number }[]).map((x) => [x.r, x.n]));
    const rows = this.db.prepare(`SELECT c.* ${where} ORDER BY c.issued_at DESC, c.seq DESC LIMIT ? OFFSET ?`).all(limit, offset) as Record<string, unknown>[];
    return { items: rows.map(rowToCredential), total, byRole };
  }

  clubs(): string[] {
    return (this.db.prepare('SELECT DISTINCT club FROM credentials WHERE club IS NOT NULL ORDER BY club').all() as { club: string }[]).map((r) => r.club);
  }

  byIds(ids: string[]): CredentialRow[] {
    const out: CredentialRow[] = [];
    const stmt = this.db.prepare('SELECT * FROM credentials WHERE id = ?');
    for (const id of ids) { const r = stmt.get(id) as Record<string, unknown> | undefined; if (r) out.push(rowToCredential(r)); }
    return out;
  }

  markDelivered(id: string): void {
    const at = nowIso();
    this.db.prepare("UPDATE credentials SET status = 'DELIVERED', delivered_at = ?, updated_at = ? WHERE id = ? AND status != 'REVOKED'").run(at, at, id);
  }

  markPrinted(ids: string[]): number {
    const at = nowIso();
    const stmt = this.db.prepare("UPDATE credentials SET status = CASE WHEN status = 'ISSUED' THEN 'PRINTED' ELSE status END, printed_at = COALESCE(printed_at, ?), updated_at = ? WHERE id = ? AND status != 'REVOKED'");
    let n = 0;
    this.db.transaction(() => { for (const id of ids) n += stmt.run(at, at, id).changes; })();
    return n;
  }

  countByStatus(): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM credentials GROUP BY status').all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  /** Anonimiza el nombre visible (purga). */
  purgeDisplay(personId: string, at: string): void {
    this.db.prepare("UPDATE credentials SET display_name = 'Credencial purgada', photo_url = NULL, updated_at = ? WHERE person_id = ?").run(at, personId);
  }

  // --- replicación ---
  rawSince(since?: string): Record<string, unknown>[] {
    return (since ? this.db.prepare('SELECT * FROM credentials WHERE updated_at > ? ORDER BY seq').all(since) : this.db.prepare('SELECT * FROM credentials ORDER BY seq').all()) as Record<string, unknown>[];
  }

  upsertRaw(r: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO credentials (id, seq, event_id, person_id, display_name, club, role_code, zones_json, valid_from, valid_to, version, status, kid, category_code, photo_url, token, issued_at, updated_at, companion_of, delivered_at, printed_at)
      VALUES (@id, @seq, @event_id, @person_id, @display_name, @club, @role_code, @zones_json, @valid_from, @valid_to, @version, @status, @kid, @category_code, @photo_url, @token, @issued_at, @updated_at, @companion_of, @delivered_at, @printed_at)
      ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, club = excluded.club, role_code = excluded.role_code, zones_json = excluded.zones_json, valid_from = excluded.valid_from,
        valid_to = excluded.valid_to, version = excluded.version, status = excluded.status, kid = excluded.kid, category_code = excluded.category_code, photo_url = excluded.photo_url,
        token = excluded.token, updated_at = excluded.updated_at, companion_of = excluded.companion_of, delivered_at = excluded.delivered_at, printed_at = excluded.printed_at`)
      .run({ club: null, category_code: null, photo_url: null, companion_of: null, delivered_at: null, printed_at: null, ...r });
  }

  upsertRevocation(r: RevocationEntry): void {
    this.db.prepare('INSERT OR IGNORE INTO revocations (credential_id, version, reason, at, by) VALUES (?, ?, ?, ?, ?)').run(r.credentialId, r.version, r.reason, r.at, r.by);
  }

  countByRole(): Record<string, number> {
    const rows = this.db.prepare("SELECT role_code, COUNT(*) AS n FROM credentials WHERE status != 'REVOKED' GROUP BY role_code").all() as { role_code: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.role_code, r.n]));
  }

  /** Cambia datos visibles (nombre/club/categoría) sin re-emitir: el token no los contiene. */
  updateDetails(id: string, d: { displayName?: string; club?: string; categoryCode?: string }): void {
    this.db.prepare('UPDATE credentials SET display_name = COALESCE(?, display_name), club = COALESCE(?, club), category_code = COALESCE(?, category_code), updated_at = ? WHERE id = ?')
      .run(d.displayName ?? null, d.club ?? null, d.categoryCode ?? null, nowIso(), id);
  }

  setStatus(id: string, status: Credential['status']): void {
    this.db.prepare('UPDATE credentials SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  }

  /** Re-emite: incrementa versión, firma token nuevo y revoca las anteriores. */
  reissue(id: string, by: string, reason: string): CredentialRow {
    const cur = this.byId(id);
    if (!cur) throw new Error('Credencial no encontrada');
    const at = nowIso();
    const next: Credential = { ...publicCredential(cur), version: cur.version + 1, status: 'ISSUED', updatedAt: at };
    const token = signCredentialToken(next, this.key);
    this.db.transaction(() => {
      this.db.prepare('UPDATE credentials SET version = ?, status = ?, token = ?, kid = ?, updated_at = ? WHERE id = ?')
        .run(next.version, next.status, token, this.key.kid, at, id);
      this.db.prepare('INSERT INTO revocations (credential_id, version, reason, at, by) VALUES (?, ?, ?, ?, ?)')
        .run(id, cur.version, `Re-emisión: ${reason}`, at, by);
    })();
    return { ...next, token };
  }

  revoke(id: string, by: string, reason: string): RevocationEntry {
    const cur = this.byId(id);
    if (!cur) throw new Error('Credencial no encontrada');
    const at = nowIso();
    this.db.transaction(() => {
      this.db.prepare('UPDATE credentials SET status = ?, updated_at = ? WHERE id = ?').run('REVOKED', at, id);
      this.db.prepare('INSERT INTO revocations (credential_id, version, reason, at, by) VALUES (?, NULL, ?, ?, ?)').run(id, reason, at, by);
    })();
    return { credentialId: id, version: null, reason, at, by };
  }

  revocations(since?: string): RevocationEntry[] {
    const rows = since
      ? this.db.prepare('SELECT * FROM revocations WHERE at > ? ORDER BY at').all(since)
      : this.db.prepare('SELECT * FROM revocations ORDER BY at').all();
    return (rows as Record<string, unknown>[]).map((r) => ({
      credentialId: r.credential_id as string, version: (r.version as number | null), reason: r.reason as string, at: r.at as string, by: r.by as string
    }));
  }
}

// ---------- dispositivos ----------

export interface DeviceRow extends Device { token: string; lastSeenAt?: string | null; pendingCount: number; disabledAt?: string | null }
/** Lo que ve el panel: sin token. */
export type DeviceView = Omit<DeviceRow, 'token'>;

export class DeviceRepo {
  constructor(private db: Db) {}

  createEnrollToken(args: { name: string; zone: string; role: Device['role']; ttlMinutes?: number }): { token: string; expiresAt: string } {
    const token = randomToken(12);
    const expiresAt = new Date(Date.now() + (args.ttlMinutes ?? 10) * 60_000).toISOString();
    this.db.prepare('INSERT INTO enroll_tokens (token, name, zone, role, expires_at) VALUES (?, ?, ?, ?, ?)').run(token, args.name, args.zone, args.role, expiresAt);
    return { token, expiresAt };
  }

  /** Canjea un token de enrolamiento (una sola vez, antes de que caduque). */
  enroll(enrollToken: string, pin: string): DeviceRow | null {
    const t = this.db.prepare('SELECT * FROM enroll_tokens WHERE token = ?').get(enrollToken) as Record<string, string | null> | undefined;
    if (!t || t.used_at || t.expires_at! <= nowIso()) return null;
    const id = `dev_${randomToken(6)}`;
    const token = randomToken(32);
    const enrolledAt = nowIso();
    this.db.transaction(() => {
      this.db.prepare('UPDATE enroll_tokens SET used_at = ? WHERE token = ?').run(enrolledAt, enrollToken);
      this.db.prepare('INSERT INTO devices (id, name, zone, role, pin_hash, token, enrolled_at, last_seq, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
        .run(id, t.name, t.zone, t.role, hashSecret(pin), token, enrolledAt, enrolledAt);
    })();
    return { id, name: t.name!, zone: t.zone!, role: t.role as Device['role'], enrolledAt, lastSeq: 0, token, pendingCount: 0, lastSeenAt: null, disabledAt: null };
  }

  byToken(token: string): DeviceRow | undefined {
    const r = this.db.prepare('SELECT * FROM devices WHERE token = ?').get(token) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }

  byId(id: string): DeviceRow | undefined {
    const r = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }

  all(): DeviceView[] {
    return (this.db.prepare('SELECT * FROM devices ORDER BY enrolled_at').all() as Record<string, unknown>[]).map((r) => {
      const { token: _t, ...rest } = this.row(r);
      return rest;
    });
  }

  touch(id: string, lastSeq: number, pending?: number): void {
    const at = nowIso();
    if (pending === undefined) this.db.prepare('UPDATE devices SET last_seq = MAX(last_seq, ?), last_seen_at = ? WHERE id = ?').run(lastSeq, at, id);
    else this.db.prepare('UPDATE devices SET last_seq = MAX(last_seq, ?), last_seen_at = ?, pending_count = ? WHERE id = ?').run(lastSeq, at, Math.max(0, pending), id);
  }

  /** Solo "visto": lo llama cualquier petición autenticada del dispositivo. */
  seen(id: string, pending?: number): void {
    if (pending === undefined) this.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), id);
    else this.db.prepare('UPDATE devices SET last_seen_at = ?, pending_count = ? WHERE id = ?').run(nowIso(), Math.max(0, pending), id);
  }

  setZone(id: string, zone: string): void {
    this.db.prepare('UPDATE devices SET zone = ?, updated_at = ? WHERE id = ?').run(zone, nowIso(), id);
  }

  rename(id: string, name: string): void {
    this.db.prepare('UPDATE devices SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), id);
  }

  setDisabled(id: string, disabled: boolean): void {
    const at = nowIso();
    this.db.prepare('UPDATE devices SET disabled_at = ?, updated_at = ? WHERE id = ?').run(disabled ? at : null, at, id);
  }

  private row(r: Record<string, unknown>): DeviceRow {
    return {
      id: r.id as string, name: r.name as string, zone: r.zone as string, role: r.role as Device['role'],
      enrolledAt: r.enrolled_at as string, lastSeq: r.last_seq as number, token: r.token as string,
      lastSeenAt: (r.last_seen_at as string | null) ?? null, pendingCount: (r.pending_count as number) ?? 0, disabledAt: (r.disabled_at as string | null) ?? null
    };
  }

  // --- replicación: filas crudas con token y hash de PIN, para que los scanners no tengan que re-enrolarse ---
  rawSince(since?: string): Record<string, unknown>[] {
    return (since ? this.db.prepare('SELECT * FROM devices WHERE updated_at > ? OR last_seen_at > ?').all(since, since) : this.db.prepare('SELECT * FROM devices').all()) as Record<string, unknown>[];
  }

  upsertRaw(r: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO devices (id, name, zone, role, pin_hash, token, enrolled_at, last_seq, last_seen_at, pending_count, disabled_at, updated_at)
      VALUES (@id, @name, @zone, @role, @pin_hash, @token, @enrolled_at, @last_seq, @last_seen_at, @pending_count, @disabled_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, zone = excluded.zone, role = excluded.role, pin_hash = excluded.pin_hash, token = excluded.token,
        last_seq = MAX(last_seq, excluded.last_seq), last_seen_at = COALESCE(excluded.last_seen_at, last_seen_at), pending_count = excluded.pending_count,
        disabled_at = excluded.disabled_at, updated_at = excluded.updated_at`)
      .run({ last_seen_at: null, pending_count: 0, disabled_at: null, ...r });
  }
}

// ---------- eventos de escaneo ----------

function rowToScan(r: Record<string, unknown>): ScanEvent {
  return {
    id: r.id as string, deviceId: r.device_id as string, seq: r.seq as number, credentialId: (r.credential_id as string | null),
    zone: r.zone as string, direction: r.direction as ScanEvent['direction'], decision: r.decision as ScanEvent['decision'],
    reasonCode: r.reason_code as ScanEvent['reasonCode'], at: r.at as string,
    tokenVersion: (r.token_version as number | null) ?? undefined,
    manual: r.manual_json ? JSON.parse(r.manual_json as string) : undefined, receivedAt: r.received_at as string
  };
}

export class ScanEventRepo {
  constructor(private db: Db) {}

  /** Inserta ignorando duplicados (device_id, seq). Devuelve cuántos entraron. */
  appendBatch(events: ScanEvent[]): { accepted: number; duplicates: number; receivedAt: string } {
    const receivedAt = nowIso();
    const stmt = this.db.prepare(`INSERT OR IGNORE INTO scan_events (id, device_id, seq, credential_id, zone, direction, decision, reason_code, at, token_version, manual_json, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let accepted = 0;
    this.db.transaction(() => {
      for (const e of events) {
        const r = stmt.run(`${e.deviceId}:${e.seq}`, e.deviceId, e.seq, e.credentialId, e.zone, e.direction, e.decision, e.reasonCode, e.at,
          e.tokenVersion ?? null, e.manual ? JSON.stringify(e.manual) : null, receivedAt);
        accepted += r.changes;
      }
    })();
    return { accepted, duplicates: events.length - accepted, receivedAt };
  }

  since(receivedAfter: string | undefined, limit = 5000): ScanEvent[] {
    const rows = receivedAfter
      ? this.db.prepare('SELECT * FROM scan_events WHERE received_at > ? ORDER BY received_at, id LIMIT ?').all(receivedAfter, limit)
      : this.db.prepare('SELECT * FROM scan_events ORDER BY received_at, id LIMIT ?').all(limit);
    return (rows as Record<string, unknown>[]).map(rowToScan);
  }

  allForCredential(credentialId: string, limit = 200): ScanEvent[] {
    return (this.db.prepare('SELECT * FROM scan_events WHERE credential_id = ? ORDER BY at DESC LIMIT ?').all(credentialId, limit) as Record<string, unknown>[]).map(rowToScan);
  }

  /** Eventos con `at` dentro de un rango (para reportes y KPIs). */
  between(fromAt: string, toAt: string): ScanEvent[] {
    return (this.db.prepare('SELECT * FROM scan_events WHERE at >= ? AND at < ? ORDER BY at').all(fromAt, toAt) as Record<string, unknown>[]).map(rowToScan);
  }

  /** Último `seq` guardado de un dispositivo (0 si no tiene eventos). Lo usa la radio para numerar sus hechos. */
  maxSeq(deviceId: string): number {
    return (this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM scan_events WHERE device_id = ?').get(deviceId) as { n: number }).n;
  }

  /** Eventos de un dispositivo (p. ej. el virtual `radio`) con `at` en un rango, del más reciente al más antiguo. */
  forDevice(deviceId: string, fromAt: string, toAt: string, limit = 500): ScanEvent[] {
    return (this.db.prepare('SELECT * FROM scan_events WHERE device_id = ? AND at >= ? AND at < ? ORDER BY at DESC LIMIT ?').all(deviceId, fromAt, toAt, limit) as Record<string, unknown>[]).map(rowToScan);
  }

  lastByDevice(): Record<string, string> {
    const rows = this.db.prepare('SELECT device_id, MAX(at) AS last_at FROM scan_events GROUP BY device_id').all() as { device_id: string; last_at: string }[];
    return Object.fromEntries(rows.map((r) => [r.device_id, r.last_at]));
  }

  forCredential(credentialId: string, sinceAt: string): ScanEvent[] {
    return (this.db.prepare('SELECT * FROM scan_events WHERE credential_id = ? AND at >= ? ORDER BY at').all(credentialId, sinceAt) as Record<string, unknown>[]).map(rowToScan);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM scan_events').get() as { n: number }).n;
  }

  /** Rechazos (DENY) del día local del evento: total, por motivo y los últimos N. */
  deniedToday(utcOffsetMinutes: number, limit = 50, now = Date.now()): { total: number; byReason: Record<string, number>; recent: ScanEvent[] } {
    const start = Date.parse(new Date(now + utcOffsetMinutes * 60_000).toISOString().slice(0, 10) + 'T00:00:00.000Z') - utcOffsetMinutes * 60_000;
    const from = new Date(start).toISOString(), to = new Date(start + 86_400_000).toISOString();
    const rows = this.db.prepare("SELECT reason_code, COUNT(*) AS n FROM scan_events WHERE decision = 'DENY' AND at >= ? AND at < ? GROUP BY reason_code").all(from, to) as { reason_code: string; n: number }[];
    const byReason: Record<string, number> = {};
    let total = 0;
    for (const r of rows) { byReason[r.reason_code] = r.n; total += r.n; }
    const recent = (this.db.prepare("SELECT * FROM scan_events WHERE decision = 'DENY' AND at >= ? AND at < ? ORDER BY at DESC LIMIT ?").all(from, to, limit) as Record<string, unknown>[]).map(rowToScan);
    return { total, byReason, recent };
  }

  gateSummary(): { byZone: Record<string, Record<string, number>>; byDevice: Record<string, Record<string, number>>; byReason: Record<string, number>; total: number } {
    const rows = this.db.prepare('SELECT zone, device_id, decision, reason_code, COUNT(*) AS n FROM scan_events GROUP BY zone, device_id, decision, reason_code').all() as
      { zone: string; device_id: string; decision: string; reason_code: string; n: number }[];
    const byZone: Record<string, Record<string, number>> = {};
    const byDevice: Record<string, Record<string, number>> = {};
    const byReason: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      (byZone[r.zone] ??= {})[r.decision] = ((byZone[r.zone] ?? {})[r.decision] ?? 0) + r.n;
      (byDevice[r.device_id] ??= {})[r.decision] = ((byDevice[r.device_id] ?? {})[r.decision] ?? 0) + r.n;
      byReason[r.reason_code] = (byReason[r.reason_code] ?? 0) + r.n;
      total += r.n;
    }
    return { byZone, byDevice, byReason, total };
  }
}

// ---------- auditoría encadenada ----------

export class AuditRepo {
  constructor(private db: Db) {}

  last(): AuditRecord | null {
    const r = this.db.prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1').get() as Record<string, unknown> | undefined;
    return r ? this.row(r) : null;
  }

  append(actor: string, action: string, payload: unknown): AuditRecord {
    return this.db.transaction(() => {
      const rec = appendAudit(this.last(), { at: nowIso(), actor, action, payload });
      this.db.prepare('INSERT INTO audit_log (seq, at, actor, action, payload_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(rec.seq, rec.at, rec.actor, rec.action, JSON.stringify(rec.payload), rec.prevHash, rec.hash);
      return rec;
    })();
  }

  all(): AuditRecord[] {
    return (this.db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as Record<string, unknown>[]).map((r) => this.row(r));
  }

  page(opts: { offset?: number; limit?: number; action?: string; actor?: string } = {}): { records: AuditRecord[]; total: number } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.action) { where.push('action = ?'); params.push(opts.action); }
    if (opts.actor) { where.push('actor = ?'); params.push(opts.actor); }
    const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM audit_log${sql}`).get(...params) as { n: number }).n;
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 1000);
    const records = (this.db.prepare(`SELECT * FROM audit_log${sql} ORDER BY seq DESC LIMIT ? OFFSET ?`).all(...params, limit, opts.offset ?? 0) as Record<string, unknown>[]).map((r) => this.row(r));
    return { records, total };
  }

  /** Acciones distintas registradas (para el filtro del panel). */
  actions(): string[] {
    return (this.db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all() as { action: string }[]).map((r) => r.action);
  }

  since(seq: number): AuditRecord[] {
    return (this.db.prepare('SELECT * FROM audit_log WHERE seq > ? ORDER BY seq').all(seq) as Record<string, unknown>[]).map((r) => this.row(r));
  }

  /** Inserta un registro replicado tal cual (misma cadena que el primario). */
  insertRaw(rec: AuditRecord): void {
    this.db.prepare('INSERT OR IGNORE INTO audit_log (seq, at, actor, action, payload_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(rec.seq, rec.at, rec.actor, rec.action, JSON.stringify(rec.payload), rec.prevHash, rec.hash);
  }

  verify() {
    return verifyChain(this.all());
  }

  private row(r: Record<string, unknown>): AuditRecord {
    return {
      seq: r.seq as number, at: r.at as string, actor: r.actor as string, action: r.action as string,
      payload: JSON.parse(r.payload_json as string), prevHash: r.prev_hash as string, hash: r.hash as string
    };
  }
}

// ---------- alertas ----------

export type AlertKind = 'DUPLICATE' | 'MANUAL' | 'OFFLINE';
export interface Alert {
  id: string; kind: AlertKind; at: string; credentialId: string | null; deviceId: string | null;
  detail: Record<string, unknown>; status: 'OPEN' | 'RESOLVED'; resolvedAt: string | null; resolvedBy: string | null; note: string | null; updatedAt: string;
}

export class AlertRepo {
  constructor(private db: Db) {}

  private row(r: Record<string, unknown>): Alert {
    return {
      id: r.id as string, kind: r.kind as AlertKind, at: r.at as string, credentialId: (r.credential_id as string | null) ?? null, deviceId: (r.device_id as string | null) ?? null,
      detail: JSON.parse(r.detail_json as string), status: r.status as Alert['status'], resolvedAt: (r.resolved_at as string | null) ?? null,
      resolvedBy: (r.resolved_by as string | null) ?? null, note: (r.note as string | null) ?? null, updatedAt: r.updated_at as string
    };
  }

  /** Crea si no existe (id idempotente). Devuelve true si la creó. */
  open(a: { id: string; kind: AlertKind; at: string; credentialId?: string | null; deviceId?: string | null; detail: Record<string, unknown> }): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO alerts (id, kind, at, credential_id, device_id, detail_json, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(a.id, a.kind, a.at, a.credentialId ?? null, a.deviceId ?? null, JSON.stringify(a.detail), 'OPEN', nowIso());
    return r.changes > 0;
  }

  /** Alertas derivadas de un lote de escaneos aceptado: duplicados e ingresos manuales. */
  fromScans(events: ScanEvent[], deviceNames: Record<string, string>): number {
    let n = 0;
    for (const e of events) {
      const device = deviceNames[e.deviceId] ?? e.deviceId;
      if (e.reasonCode === 'DUPLICATE' || e.decision === 'ALERT') {
        if (this.open({ id: `dup:${e.id}`, kind: 'DUPLICATE', at: e.at, credentialId: e.credentialId, deviceId: e.deviceId, detail: { device, zone: e.zone, reasonCode: e.reasonCode } })) n++;
      } else if (e.reasonCode === 'OK_MANUAL' || e.manual) {
        if (this.open({ id: `man:${e.id}`, kind: 'MANUAL', at: e.at, credentialId: e.credentialId, deviceId: e.deviceId, detail: { device, zone: e.zone, reason: e.manual?.reason ?? '', by: e.manual?.by ?? '' } })) n++;
      }
    }
    return n;
  }

  /** Dispositivos sin reportar > umbral: abre una alerta por dispositivo; si volvió, la cierra sola. */
  refreshOffline(devices: DeviceView[], thresholdMs = 5 * 60_000, now = Date.now()): void {
    for (const d of devices) {
      if (d.disabledAt) continue;
      const last = d.lastSeenAt ? Date.parse(d.lastSeenAt) : Date.parse(d.enrolledAt);
      const id = `off:${d.id}`;
      if (now - last > thresholdMs) {
        this.open({ id, kind: 'OFFLINE', at: new Date(last).toISOString(), deviceId: d.id, detail: { device: d.name, zone: d.zone, pending: d.pendingCount } });
      } else {
        this.db.prepare("UPDATE alerts SET status = 'RESOLVED', resolved_at = ?, resolved_by = 'system', note = 'Volvió a conectarse.', updated_at = ? WHERE id = ? AND status = 'OPEN'").run(nowIso(), nowIso(), id);
      }
    }
  }

  list(status?: Alert['status'], limit = 200): Alert[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM alerts WHERE status = ? ORDER BY at DESC LIMIT ?').all(status, limit)
      : this.db.prepare('SELECT * FROM alerts ORDER BY at DESC LIMIT ?').all(limit);
    return (rows as Record<string, unknown>[]).map((r) => this.row(r));
  }

  byId(id: string): Alert | undefined {
    const r = this.db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }

  resolve(id: string, by: string, note: string): Alert | undefined {
    const at = nowIso();
    this.db.prepare("UPDATE alerts SET status = 'RESOLVED', resolved_at = ?, resolved_by = ?, note = ?, updated_at = ? WHERE id = ?").run(at, by, note, at, id);
    return this.byId(id);
  }

  countOpen(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE status = 'OPEN'").get() as { n: number }).n;
  }

  countByKind(fromAt?: string, toAt?: string): Record<string, number> {
    const rows = (fromAt && toAt
      ? this.db.prepare('SELECT kind, COUNT(*) AS n FROM alerts WHERE at >= ? AND at < ? GROUP BY kind').all(fromAt, toAt)
      : this.db.prepare('SELECT kind, COUNT(*) AS n FROM alerts GROUP BY kind').all()) as { kind: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  }

  rawSince(since?: string): Record<string, unknown>[] {
    return (since ? this.db.prepare('SELECT * FROM alerts WHERE updated_at > ?').all(since) : this.db.prepare('SELECT * FROM alerts').all()) as Record<string, unknown>[];
  }

  upsertRaw(r: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO alerts (id, kind, at, credential_id, device_id, detail_json, status, resolved_at, resolved_by, note, updated_at)
      VALUES (@id, @kind, @at, @credential_id, @device_id, @detail_json, @status, @resolved_at, @resolved_by, @note, @updated_at)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, resolved_at = excluded.resolved_at, resolved_by = excluded.resolved_by, note = excluded.note, updated_at = excluded.updated_at`)
      .run({ credential_id: null, device_id: null, resolved_at: null, resolved_by: null, note: null, ...r });
  }
}

// ---------- lotes de impresión ----------

export interface PrintBatch {
  id: string; createdAt: string; createdBy: string; filter: Record<string, unknown>; credentialIds: string[]; count: number;
  status: 'PENDING' | 'PRINTED' | 'DELIVERED'; printedAt: string | null; printedBy: string | null; deliveredAt: string | null; deliveredBy: string | null;
}

export class PrintBatchRepo {
  constructor(private db: Db) {}

  private row(r: Record<string, unknown>): PrintBatch {
    return {
      id: r.id as string, createdAt: r.created_at as string, createdBy: r.created_by as string, filter: JSON.parse(r.filter_json as string),
      credentialIds: JSON.parse(r.credential_ids_json as string), count: r.count as number, status: r.status as PrintBatch['status'],
      printedAt: (r.printed_at as string | null) ?? null, printedBy: (r.printed_by as string | null) ?? null,
      deliveredAt: (r.delivered_at as string | null) ?? null, deliveredBy: (r.delivered_by as string | null) ?? null
    };
  }

  create(by: string, filter: Record<string, unknown>, credentialIds: string[]): PrintBatch {
    const id = `lote_${randomToken(5)}`;
    const at = nowIso();
    this.db.prepare('INSERT INTO print_batches (id, created_at, created_by, filter_json, credential_ids_json, count, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, at, by, JSON.stringify(filter), JSON.stringify(credentialIds), credentialIds.length, 'PENDING', at);
    return this.byId(id)!;
  }

  byId(id: string): PrintBatch | undefined {
    const r = this.db.prepare('SELECT * FROM print_batches WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return r ? this.row(r) : undefined;
  }

  all(): PrintBatch[] {
    return (this.db.prepare('SELECT * FROM print_batches ORDER BY created_at DESC').all() as Record<string, unknown>[]).map((r) => this.row(r));
  }

  markPrinted(id: string, by: string): PrintBatch | undefined {
    const at = nowIso();
    this.db.prepare("UPDATE print_batches SET status = 'PRINTED', printed_at = ?, printed_by = ?, updated_at = ? WHERE id = ?").run(at, by, at, id);
    return this.byId(id);
  }

  markDelivered(id: string, by: string): PrintBatch | undefined {
    const at = nowIso();
    this.db.prepare("UPDATE print_batches SET status = 'DELIVERED', printed_at = COALESCE(printed_at, ?), printed_by = COALESCE(printed_by, ?), delivered_at = ?, delivered_by = ?, updated_at = ? WHERE id = ?").run(at, by, at, by, at, id);
    return this.byId(id);
  }

  rawSince(since?: string): Record<string, unknown>[] {
    return (since ? this.db.prepare('SELECT * FROM print_batches WHERE updated_at > ?').all(since) : this.db.prepare('SELECT * FROM print_batches').all()) as Record<string, unknown>[];
  }

  upsertRaw(r: Record<string, unknown>): void {
    this.db.prepare(`INSERT INTO print_batches (id, created_at, created_by, filter_json, credential_ids_json, count, status, printed_at, printed_by, delivered_at, delivered_by, updated_at)
      VALUES (@id, @created_at, @created_by, @filter_json, @credential_ids_json, @count, @status, @printed_at, @printed_by, @delivered_at, @delivered_by, @updated_at)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, printed_at = excluded.printed_at, printed_by = excluded.printed_by, delivered_at = excluded.delivered_at, delivered_by = excluded.delivered_by, updated_at = excluded.updated_at`)
      .run({ printed_at: null, printed_by: null, delivered_at: null, delivered_by: null, ...r });
  }
}

// ---------- meta ----------

export class MetaRepo {
  constructor(private db: Db) {}
  get(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value;
  }
  set(key: string, value: string): void {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  delete(key: string): void {
    this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  }
}

// ---------- escaneos: replicación ----------

export function scanRawSince(db: Db, since?: string, limit = 20000): Record<string, unknown>[] {
  return (since
    ? db.prepare('SELECT * FROM scan_events WHERE received_at > ? ORDER BY received_at, id LIMIT ?').all(since, limit)
    : db.prepare('SELECT * FROM scan_events ORDER BY received_at, id LIMIT ?').all(limit)) as Record<string, unknown>[];
}

/** Devuelve 1 si lo insertó, 0 si ya existía. */
export function scanUpsertRaw(db: Db, r: Record<string, unknown>): number {
  return db.prepare(`INSERT OR IGNORE INTO scan_events (id, device_id, seq, credential_id, zone, direction, decision, reason_code, at, token_version, manual_json, received_at)
    VALUES (@id, @device_id, @seq, @credential_id, @zone, @direction, @decision, @reason_code, @at, @token_version, @manual_json, @received_at)`)
    .run({ credential_id: null, token_version: null, manual_json: null, ...r }).changes;
}
