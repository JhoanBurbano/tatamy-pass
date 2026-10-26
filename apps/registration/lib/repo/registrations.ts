/** Repositorio de inscripciones. SQL portable (SQLite y Postgres) sobre `SqlDriver`. */
import { dedupeKey, type Person } from '@tatami/core';
import { num, type Row, type SqlDriver } from '../db/driver';
import { ACTIVE_STATUSES, type CredentialState, type Registration, type RegistrationStatus } from './types';
import { newId, publicCode, secureToken } from '../ids';

const ACTIVE_SQL = `status IN (${ACTIVE_STATUSES.map((s) => `'${s}'`).join(',')})`;

function s(v: unknown): string | undefined { return v === null || v === undefined ? undefined : String(v); }

export function rowToRegistration(r: Row): Registration {
  return {
    id: r.id as string, code: s(r.code), firstName: r.first_name as string, lastName: r.last_name as string, birthDate: r.birth_date as string,
    documentNumber: s(r.document_number), club: s(r.club), delegationId: s(r.delegation_id), email: s(r.email), roleCode: r.role_code as string,
    categoryCode: s(r.category_code), guardian: r.guardian_json ? JSON.parse(r.guardian_json as string) : undefined, photoUrl: s(r.photo_url),
    delegation: s(r.delegation), emergencyContact: r.emergency_json ? JSON.parse(r.emergency_json as string) : undefined, eps: r.eps_json ? JSON.parse(r.eps_json as string) : undefined,
    status: r.status as RegistrationStatus, rejectionReason: s(r.rejection_reason), source: r.source as Person['source'], externalId: s(r.external_id),
    companionOf: s(r.companion_of) ?? null, relationship: s(r.relationship), consentAt: s(r.consent_at),
    offerToken: s(r.offer_token), offerExpiresAt: s(r.offer_expires_at), offeredAt: s(r.offered_at),
    credentialId: s(r.credential_id), credentialStatus: s(r.credential_status) as CredentialState | undefined, credentialVersion: r.credential_version === null || r.credential_version === undefined ? undefined : Number(r.credential_version), credentialUpdatedAt: s(r.credential_updated_at),
    exportedAt: s(r.exported_at), revokedAt: s(r.revoked_at), revokeReason: s(r.revoke_reason), credentialToken: s(r.credential_token),
    createdAt: r.created_at as string, updatedAt: r.updated_at as string
  };
}

export interface ListFilters {
  status?: RegistrationStatus | 'ALL';
  roleCode?: string;
  categoryCode?: string;
  club?: string;
  delegationId?: string;
  search?: string;
  /** Solo participantes (sin acompañantes). Por defecto true. */
  participantsOnly?: boolean;
  limit?: number;
}

export type UpsertInput = Omit<Registration, 'id' | 'code' | 'createdAt' | 'updatedAt'> & { id?: string };

export function createRegistrationRepo(db: SqlDriver) {
  const now = () => new Date().toISOString();

  const repo = {
    async byId(id: string): Promise<Registration | undefined> {
      const r = await db.get('SELECT * FROM registrations WHERE id = ?', [id]);
      return r ? rowToRegistration(r) : undefined;
    },
    async byCode(code: string): Promise<Registration | undefined> {
      const r = await db.get('SELECT * FROM registrations WHERE UPPER(code) = UPPER(?)', [code.trim()]);
      return r ? rowToRegistration(r) : undefined;
    },
    async byDedupeKey(key: string): Promise<Registration | undefined> {
      const r = await db.get('SELECT * FROM registrations WHERE dedupe_key = ?', [key]);
      return r ? rowToRegistration(r) : undefined;
    },
    async byOfferToken(token: string): Promise<Registration | undefined> {
      const r = await db.get('SELECT * FROM registrations WHERE offer_token = ?', [token]);
      return r ? rowToRegistration(r) : undefined;
    },
    async byCredentialToken(token: string): Promise<Registration | undefined> {
      if (!token) return undefined;
      const r = await db.get('SELECT * FROM registrations WHERE credential_token = ?', [token]);
      return r ? rowToRegistration(r) : undefined;
    },
    /** Devuelve el token de credencial digital, creándolo si la fila todavía no tiene (filas anteriores a 002). */
    async ensureCredentialToken(id: string): Promise<string> {
      const r = await repo.byId(id);
      if (!r) throw new Error('Inscripción no encontrada.');
      if (r.credentialToken) return r.credentialToken;
      const token = secureToken();
      await db.run('UPDATE registrations SET credential_token = ? WHERE id = ? AND credential_token IS NULL', [token, id]);
      return (await repo.byId(id))!.credentialToken!;
    },
    async all(): Promise<Registration[]> {
      return (await db.all('SELECT * FROM registrations ORDER BY created_at, id')).map(rowToRegistration);
    },
    async list(f: ListFilters = {}): Promise<Registration[]> {
      const where: string[] = [];
      const params: unknown[] = [];
      if (f.participantsOnly !== false) where.push('companion_of IS NULL');
      if (f.status && f.status !== 'ALL') { where.push('status = ?'); params.push(f.status); }
      if (f.roleCode) { where.push('role_code = ?'); params.push(f.roleCode); }
      if (f.categoryCode) { where.push('category_code = ?'); params.push(f.categoryCode); }
      if (f.club) { where.push('LOWER(club) = LOWER(?)'); params.push(f.club); }
      if (f.delegationId) { where.push('(delegation_id = ? OR LOWER(club) IN (SELECT LOWER(name) FROM delegations WHERE id = ?))'); params.push(f.delegationId, f.delegationId); }
      if (f.search) {
        where.push("(LOWER(first_name || ' ' || last_name) LIKE LOWER(?) OR document_number LIKE ? OR UPPER(code) = UPPER(?) OR LOWER(email) = LOWER(?))");
        params.push(`%${f.search}%`, `%${f.search}%`, f.search, f.search);
      }
      const sql = `SELECT * FROM registrations${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ${Math.min(f.limit ?? 500, 5000)}`;
      return (await db.all(sql, params)).map(rowToRegistration);
    },
    async companionsOf(id: string): Promise<Registration[]> {
      return (await db.all('SELECT * FROM registrations WHERE companion_of = ? ORDER BY created_at, id', [id])).map(rowToRegistration);
    },

    // ─── Conteos para cupos ──────────────────────────────────────────────
    async countByRole(): Promise<Record<string, number>> {
      const rows = await db.all<{ role_code: string; n: unknown }>(`SELECT role_code, COUNT(*) AS n FROM registrations WHERE ${ACTIVE_SQL} GROUP BY role_code`);
      return Object.fromEntries(rows.map((r) => [r.role_code, num(r.n)]));
    },
    async countByCategory(): Promise<Record<string, number>> {
      const rows = await db.all<{ category_code: string; n: unknown }>(`SELECT category_code, COUNT(*) AS n FROM registrations WHERE ${ACTIVE_SQL} AND category_code IS NOT NULL GROUP BY category_code`);
      return Object.fromEntries(rows.map((r) => [r.category_code, num(r.n)]));
    },
    async countCompanions(): Promise<number> {
      return num((await db.get<{ n: unknown }>(`SELECT COUNT(*) AS n FROM registrations WHERE role_code = 'ACOMP' AND ${ACTIVE_SQL}`))?.n);
    },
    async countActive(): Promise<number> {
      return num((await db.get<{ n: unknown }>(`SELECT COUNT(*) AS n FROM registrations WHERE ${ACTIVE_SQL}`))?.n);
    },
    /** Conteo agrupado por una columna (reportes). */
    async countBy(column: 'role_code' | 'category_code' | 'club' | 'status' | 'credential_status', filters: { delegationId?: string } = {}): Promise<{ key: string; n: number }[]> {
      const params: unknown[] = [];
      let where = 'companion_of IS NULL';
      if (filters.delegationId) { where += ' AND (delegation_id = ? OR LOWER(club) IN (SELECT LOWER(name) FROM delegations WHERE id = ?))'; params.push(filters.delegationId, filters.delegationId); }
      const rows = await db.all<{ k: unknown; n: unknown }>(`SELECT COALESCE(${column}, '') AS k, COUNT(*) AS n FROM registrations WHERE ${where} GROUP BY COALESCE(${column}, '') ORDER BY n DESC, k`, params);
      return rows.map((r) => ({ key: String(r.k ?? ''), n: num(r.n) }));
    },

    // ─── Escritura ───────────────────────────────────────────────────────
    /** Inserta o actualiza (por nombre+fecha+club; acompañantes por participante+nombre+documento). */
    async upsert(reg: UpsertInput): Promise<{ registration: Registration; created: boolean }> {
      const key = reg.companionOf
        ? `companion:${reg.companionOf}|${dedupeKey({ firstName: reg.firstName, lastName: reg.lastName, birthDate: reg.birthDate, club: reg.documentNumber ?? '' })}`
        : dedupeKey(reg);
      const existing = await repo.byDedupeKey(key);
      const at = now();
      if (existing) {
        const changed = (reg.documentNumber && reg.documentNumber !== existing.documentNumber) || (reg.externalId && reg.externalId !== existing.externalId)
          || (reg.categoryCode && reg.categoryCode !== existing.categoryCode) || (reg.relationship && reg.relationship !== existing.relationship)
          || (reg.photoUrl && reg.photoUrl !== existing.photoUrl) || (reg.email && reg.email !== existing.email) || (reg.delegationId && reg.delegationId !== existing.delegationId)
          || (reg.delegation && reg.delegation !== existing.delegation)
          || (reg.emergencyContact && JSON.stringify(reg.emergencyContact) !== JSON.stringify(existing.emergencyContact)) || (reg.eps && JSON.stringify(reg.eps) !== JSON.stringify(existing.eps));
        if (changed) {
          await db.run(`UPDATE registrations SET document_number = COALESCE(?, document_number), external_id = COALESCE(?, external_id), category_code = COALESCE(?, category_code),
            relationship = COALESCE(?, relationship), photo_url = COALESCE(?, photo_url), email = COALESCE(?, email), delegation_id = COALESCE(?, delegation_id),
            delegation = COALESCE(?, delegation), emergency_json = COALESCE(?, emergency_json), eps_json = COALESCE(?, eps_json), updated_at = ? WHERE id = ?`,
            [reg.documentNumber ?? null, reg.externalId ?? null, reg.categoryCode ?? null, reg.relationship ?? null, reg.photoUrl ?? null, reg.email ?? null, reg.delegationId ?? null,
              reg.delegation ?? null, reg.emergencyContact ? JSON.stringify(reg.emergencyContact) : null, reg.eps ? JSON.stringify(reg.eps) : null, at, existing.id]);
        }
        return { registration: (await repo.byDedupeKey(key))!, created: false };
      }
      const id = reg.id ?? newId('r');
      const code = reg.companionOf ? null : await repo.freshCode();
      await db.run(`INSERT INTO registrations (id, code, first_name, last_name, birth_date, document_number, club, delegation_id, email, role_code, category_code, guardian_json, photo_url, status,
        rejection_reason, source, external_id, dedupe_key, companion_of, relationship, consent_at, credential_token, delegation, emergency_json, eps_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        id, code, reg.firstName, reg.lastName, reg.birthDate, reg.documentNumber ?? null, reg.club ?? null, reg.delegationId ?? null, reg.email ?? null, reg.roleCode,
        reg.categoryCode ?? null, reg.guardian ? JSON.stringify(reg.guardian) : null, reg.photoUrl ?? null, reg.status, reg.rejectionReason ?? null, reg.source,
        reg.externalId ?? null, key, reg.companionOf ?? null, reg.relationship ?? null, reg.consentAt ?? null, secureToken(),
        reg.delegation ?? null, reg.emergencyContact ? JSON.stringify(reg.emergencyContact) : null, reg.eps ? JSON.stringify(reg.eps) : null, at, at
      ]);
      return { registration: (await repo.byDedupeKey(key))!, created: true };
    },
    async freshCode(): Promise<string> {
      for (let i = 0; i < 20; i++) {
        const c = publicCode();
        if (!(await db.get('SELECT 1 FROM registrations WHERE code = ?', [c]))) return c;
      }
      throw new Error('No pude generar un código único.');
    },
    /** Cambia el estado del participante y propaga a sus acompañantes (salvo rechazados). */
    async setStatus(id: string, status: RegistrationStatus, opts: { rejectionReason?: string } = {}): Promise<void> {
      const at = now();
      await db.run('UPDATE registrations SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ?', [status, opts.rejectionReason ?? null, at, id]);
      await db.run("UPDATE registrations SET status = ?, updated_at = ? WHERE companion_of = ? AND status != 'REJECTED'", [status, at, id]);
    },
    async update(id: string, patch: Partial<Pick<Registration, 'firstName' | 'lastName' | 'documentNumber' | 'club' | 'delegationId' | 'email' | 'categoryCode' | 'photoUrl' | 'consentAt'>>): Promise<void> {
      const map: Record<string, string> = { firstName: 'first_name', lastName: 'last_name', documentNumber: 'document_number', club: 'club', delegationId: 'delegation_id', email: 'email', categoryCode: 'category_code', photoUrl: 'photo_url', consentAt: 'consent_at' };
      const sets: string[] = []; const params: unknown[] = [];
      for (const [k, v] of Object.entries(patch)) if (k in map && v !== undefined) { sets.push(`${map[k]} = ?`); params.push(v); }
      if (!sets.length) return;
      sets.push('updated_at = ?'); params.push(now(), id);
      await db.run(`UPDATE registrations SET ${sets.join(', ')} WHERE id = ?`, params);
    },
    /**
     * Edición desde el panel (coordinador o inscriptor): datos de identidad y contacto.
     * Recalcula la clave de deduplicación; si choca con otra inscripción devuelve `conflict`.
     */
    async updateDetails(id: string, patch: Partial<Pick<Registration, 'firstName' | 'lastName' | 'birthDate' | 'documentNumber' | 'club' | 'delegationId' | 'email' | 'categoryCode' | 'guardian' | 'relationship'>>): Promise<{ ok: true; registration: Registration } | { ok: false; conflict: Registration }> {
      const current = await repo.byId(id);
      if (!current) throw new Error('Inscripción no encontrada.');
      const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Registration;
      const key = next.companionOf
        ? `companion:${next.companionOf}|${dedupeKey({ firstName: next.firstName, lastName: next.lastName, birthDate: next.birthDate, club: next.documentNumber ?? '' })}`
        : dedupeKey(next);
      const other = await repo.byDedupeKey(key);
      if (other && other.id !== id) return { ok: false, conflict: other };
      await db.run(`UPDATE registrations SET first_name = ?, last_name = ?, birth_date = ?, document_number = ?, club = ?, delegation_id = ?, email = ?, category_code = ?, guardian_json = ?, relationship = ?, dedupe_key = ?, updated_at = ? WHERE id = ?`,
        [next.firstName, next.lastName, next.birthDate, next.documentNumber ?? null, next.club ?? null, next.delegationId ?? null, next.email ?? null, next.categoryCode ?? null, next.guardian ? JSON.stringify(next.guardian) : null, next.relationship ?? null, key, now(), id]);
      // los acompañantes heredan el club del participante
      if (!next.companionOf) await db.run('UPDATE registrations SET club = ?, delegation_id = ?, updated_at = ? WHERE companion_of = ?', [next.club ?? null, next.delegationId ?? null, now(), id]);
      return { ok: true, registration: (await repo.byId(id))! };
    },
    async delete(id: string): Promise<void> {
      await db.run('DELETE FROM registrations WHERE companion_of = ?', [id]);
      await db.run('DELETE FROM registrations WHERE id = ?', [id]);
    },

    // ─── Lista de espera ─────────────────────────────────────────────────
    async waitlist(f: { roleCode?: string; categoryCode?: string } = {}): Promise<Registration[]> {
      const where = ["status IN ('WAITLIST','OFFERED')", 'companion_of IS NULL']; const params: unknown[] = [];
      if (f.roleCode) { where.push('role_code = ?'); params.push(f.roleCode); }
      if (f.categoryCode) { where.push('category_code = ?'); params.push(f.categoryCode); }
      return (await db.all(`SELECT * FROM registrations WHERE ${where.join(' AND ')} ORDER BY created_at, id`, params)).map(rowToRegistration);
    },
    /** Primero en espera (sin oferta activa) para un rol/categoría. */
    async nextInWaitlist(f: { roleCode: string; categoryCode?: string }): Promise<Registration | undefined> {
      const where = ["status = 'WAITLIST'", 'companion_of IS NULL', 'role_code = ?']; const params: unknown[] = [f.roleCode];
      if (f.categoryCode) { where.push('category_code = ?'); params.push(f.categoryCode); }
      const r = await db.get(`SELECT * FROM registrations WHERE ${where.join(' AND ')} ORDER BY created_at, id LIMIT 1`, params);
      return r ? rowToRegistration(r) : undefined;
    },
    async markOffered(id: string, token: string, expiresAt: string): Promise<void> {
      const at = now();
      await db.run("UPDATE registrations SET status = 'OFFERED', offer_token = ?, offer_expires_at = ?, offered_at = ?, updated_at = ? WHERE id = ?", [token, expiresAt, at, at, id]);
      await db.run("UPDATE registrations SET status = 'OFFERED', updated_at = ? WHERE companion_of = ? AND status != 'REJECTED'", [at, id]);
    },
    async expiredOffers(nowIso: string): Promise<Registration[]> {
      return (await db.all("SELECT * FROM registrations WHERE status = 'OFFERED' AND offer_expires_at IS NOT NULL AND offer_expires_at < ? ORDER BY offer_expires_at", [nowIso])).map(rowToRegistration);
    },
    async clearOffer(id: string): Promise<void> {
      await db.run('UPDATE registrations SET offer_token = NULL, offer_expires_at = NULL, updated_at = ? WHERE id = ?', [now(), id]);
    },

    // ─── Export al host y credenciales ───────────────────────────────────
    /** Participantes aprobados actualizados después de `since`, con sus acompañantes (para el host). */
    async exportSince(since: string | undefined): Promise<Array<Registration & { companions: Registration[] }>> {
      const rows = since
        ? await db.all("SELECT * FROM registrations WHERE status = 'APPROVED' AND companion_of IS NULL AND updated_at > ? ORDER BY updated_at, id", [since])
        : await db.all("SELECT * FROM registrations WHERE status = 'APPROVED' AND companion_of IS NULL ORDER BY updated_at, id");
      const ids = new Set(rows.map((r) => r.id as string));
      if (since) {
        const changed = await db.all<{ id: string }>('SELECT DISTINCT companion_of AS id FROM registrations WHERE companion_of IS NOT NULL AND updated_at > ?', [since]);
        for (const c of changed) if (!ids.has(c.id)) { const p = await repo.byId(c.id); if (p && p.status === 'APPROVED') ids.add(c.id); }
      }
      const out: Array<Registration & { companions: Registration[] }> = [];
      for (const id of ids) out.push({ ...(await repo.byId(id))!, companions: (await repo.companionsOf(id)).filter((c) => c.status !== 'REJECTED') });
      return out.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id.localeCompare(b.id)));
    },
    /** Marca cuándo el host se llevó estas inscripciones (no toca updated_at para no re-exportarlas). */
    async markExported(ids: string[], at = now()): Promise<void> {
      for (const id of ids) await db.run('UPDATE registrations SET exported_at = ? WHERE id = ? OR companion_of = ?', [at, id, id]);
    },
    /** Lo que reporta el host sobre una credencial (por id de inscripción = external_id en el host). */
    async setCredential(id: string, c: { credentialId?: string; status: CredentialState; at: string; version?: number }): Promise<boolean> {
      const r = await db.run('UPDATE registrations SET credential_id = COALESCE(?, credential_id), credential_status = ?, credential_version = COALESCE(?, credential_version), credential_updated_at = ? WHERE id = ?', [c.credentialId ?? null, c.status, c.version ?? null, c.at, id]);
      return r.changes > 0;
    },
    /** Revoca desde la nube: cambia updated_at para que el host se lo lleve en el próximo export. */
    async revoke(id: string, reason: string): Promise<void> {
      const at = now();
      await db.run("UPDATE registrations SET revoked_at = ?, revoke_reason = ?, credential_status = 'REVOKED', credential_updated_at = ?, updated_at = ? WHERE id = ?", [at, reason, at, at, id]);
    },
    async unrevoke(id: string): Promise<void> {
      const at = now();
      await db.run("UPDATE registrations SET revoked_at = NULL, revoke_reason = NULL, credential_status = CASE WHEN credential_id IS NULL THEN NULL ELSE 'ISSUED' END, credential_updated_at = ?, updated_at = ? WHERE id = ?", [at, at, id]);
    },

    // ─── Duplicados ──────────────────────────────────────────────────────
    /** Pares candidatos: mismo documento, o mismo nombre+fecha (aunque el club esté escrito distinto). */
    async duplicateCandidates(): Promise<{ a: Registration; b: Registration; reason: 'document' | 'name-birth' }[]> {
      const all = (await db.all("SELECT * FROM registrations WHERE companion_of IS NULL AND status != 'REJECTED' ORDER BY created_at, id")).map(rowToRegistration);
      const pairs = new Map<string, { a: Registration; b: Registration; reason: 'document' | 'name-birth' }>();
      const add = (a: Registration, b: Registration, reason: 'document' | 'name-birth') => {
        const key = [a.id, b.id].sort().join('|');
        if (!pairs.has(key)) pairs.set(key, { a, b, reason });
      };
      const byDoc = new Map<string, Registration[]>();
      const byNameBirth = new Map<string, Registration[]>();
      for (const r of all) {
        const doc = r.documentNumber?.replace(/\D/g, '');
        if (doc) { byDoc.set(doc, [...(byDoc.get(doc) ?? []), r]); }
        const nb = `${r.firstName} ${r.lastName}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim() + '|' + r.birthDate;
        byNameBirth.set(nb, [...(byNameBirth.get(nb) ?? []), r]);
      }
      for (const group of byDoc.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) add(group[i], group[j], 'document');
      for (const group of byNameBirth.values()) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) add(group[i], group[j], 'name-birth');
      const decided = new Set((await db.all<{ pair_key: string }>('SELECT pair_key FROM duplicate_decisions')).map((d) => d.pair_key));
      return [...pairs.entries()].filter(([k]) => !decided.has(k)).map(([, v]) => v);
    },
    async recordDuplicateDecision(aId: string, bId: string, decision: 'distinct' | 'merged', byUser?: string): Promise<void> {
      const key = [aId, bId].sort().join('|');
      await db.run('INSERT INTO duplicate_decisions (pair_key, decision, by_user, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (pair_key) DO UPDATE SET decision = excluded.decision, by_user = excluded.by_user, created_at = excluded.created_at', [key, decision, byUser ?? null, now()]);
    },
    /** Fusiona `fromId` en `intoId`: completa datos vacíos, mueve acompañantes y borra la duplicada. */
    async merge(intoId: string, fromId: string): Promise<Registration> {
      const into = await repo.byId(intoId); const from = await repo.byId(fromId);
      if (!into || !from) throw new Error('Inscripción no encontrada.');
      const at = now();
      await db.run(`UPDATE registrations SET document_number = COALESCE(document_number, ?), email = COALESCE(email, ?), club = COALESCE(club, ?), delegation_id = COALESCE(delegation_id, ?),
        photo_url = COALESCE(photo_url, ?), category_code = COALESCE(category_code, ?), external_id = COALESCE(external_id, ?), guardian_json = COALESCE(guardian_json, ?), updated_at = ? WHERE id = ?`,
        [from.documentNumber ?? null, from.email ?? null, from.club ?? null, from.delegationId ?? null, from.photoUrl ?? null, from.categoryCode ?? null, from.externalId ?? null, from.guardian ? JSON.stringify(from.guardian) : null, at, intoId]);
      // acompañantes: se mueven si no chocan por clave; si chocan, se borran (ya existen en el destino)
      for (const c of await repo.companionsOf(fromId)) {
        const newKey = `companion:${intoId}|${dedupeKey({ firstName: c.firstName, lastName: c.lastName, birthDate: c.birthDate, club: c.documentNumber ?? '' })}`;
        if (await repo.byDedupeKey(newKey)) await db.run('DELETE FROM registrations WHERE id = ?', [c.id]);
        else await db.run('UPDATE registrations SET companion_of = ?, dedupe_key = ?, status = ?, updated_at = ? WHERE id = ?', [intoId, newKey, into.status, at, c.id]);
      }
      await db.run('DELETE FROM registrations WHERE id = ?', [fromId]);
      return (await repo.byId(intoId))!;
    }
  };
  return repo;
}

export type RegistrationRepo = ReturnType<typeof createRegistrationRepo>;
