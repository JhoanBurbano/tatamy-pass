/**
 * Repositorio sobre SQLite en memoria y, si hay DATABASE_URL, sobre Postgres real.
 *
 * Postgres local:
 *   docker run --rm -d --name tp-pg -e POSTGRES_PASSWORD=tp -e POSTGRES_DB=tatami -p 5432:5432 postgres:16
 *   DATABASE_URL=postgres://postgres:tp@localhost:5432/tatami npm test -w apps/registration
 * El test limpia sus tablas al terminar (usa un esquema aparte: tp_test).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SqlDriver } from '../lib/db/driver';
import { toPgPlaceholders } from '../lib/db/driver';
import { migrate } from '../lib/db/migrate';
import { createSqliteDriver } from '../lib/db/sqlite';
import { createRepos, type Repos } from '../lib/repo';

function suite(name: string, open: () => Promise<{ repos: Repos; close: () => Promise<void> }>, skip = false) {
  describe.skipIf(skip)(`repositorio · ${name}`, () => {
    let repos: Repos; let close: () => Promise<void>;
    beforeAll(async () => { ({ repos, close } = await open()); });
    afterAll(async () => { await close(); });

    it('migra una sola vez (idempotente)', async () => {
      expect(await migrate(repos.db)).toEqual([]);
    });

    it('crea, lee por id/código y deduplica por nombre+fecha+club', async () => {
      const a = await repos.registrations.upsert({ firstName: 'Ana', lastName: 'Ruiz', birthDate: '2000-05-01', club: 'Caucana', roleCode: 'COMP', categoryCode: 'ADU', status: 'PENDING', source: 'online' });
      expect(a.created).toBe(true);
      expect(a.registration.code).toMatch(/^N26-[A-Z2-9]{6}$/);
      const again = await repos.registrations.upsert({ firstName: 'ana', lastName: 'RUIZ', birthDate: '2000-05-01', club: 'caucana', roleCode: 'COMP', status: 'PENDING', source: 'online', documentNumber: '123' });
      expect(again.created).toBe(false);
      expect(again.registration.id).toBe(a.registration.id);
      expect(again.registration.documentNumber).toBe('123');
      expect((await repos.registrations.byCode(a.registration.code!.toLowerCase()))?.id).toBe(a.registration.id);
    });

    it('cuenta activos por rol y categoría; los rechazados no ocupan cupo', async () => {
      const b = await repos.registrations.upsert({ firstName: 'Luis', lastName: 'Gómez', birthDate: '2010-01-01', club: 'Caucana', roleCode: 'COMP', categoryCode: 'JUV', status: 'PENDING', source: 'online' });
      await repos.registrations.setStatus(b.registration.id, 'REJECTED', { rejectionReason: 'datos incompletos' });
      expect((await repos.registrations.countByRole()).COMP).toBe(1);
      expect((await repos.registrations.countByCategory()).ADU).toBe(1);
      expect((await repos.registrations.byId(b.registration.id))?.rejectionReason).toBe('datos incompletos');
    });

    it('acompañantes heredan el estado y entran en countActive', async () => {
      const p = (await repos.registrations.list({ roleCode: 'COMP', status: 'PENDING' }))[0];
      const c = await repos.registrations.upsert({ firstName: 'Pedro', lastName: 'Ruiz', birthDate: '', roleCode: 'ACOMP', status: 'PENDING', source: 'online', companionOf: p.id });
      expect(c.registration.code).toBeUndefined();
      await repos.registrations.setStatus(p.id, 'APPROVED');
      expect((await repos.registrations.companionsOf(p.id))[0].status).toBe('APPROVED');
      expect(await repos.registrations.countCompanions()).toBe(1);
      expect(await repos.registrations.countActive()).toBe(2);
    });

    it('lista con filtros y búsqueda', async () => {
      expect((await repos.registrations.list({ status: 'APPROVED' })).length).toBe(1);
      expect((await repos.registrations.list({ search: 'ruiz' })).length).toBe(1);
      expect((await repos.registrations.list({ club: 'CAUCANA', status: 'ALL' })).length).toBe(2);
      expect((await repos.registrations.list({ roleCode: 'PRESS' })).length).toBe(0);
    });

    it('usuarios y delegaciones', async () => {
      const d = await repos.users.createDelegation({ name: 'Academia Caucana', city: 'Popayán' });
      expect((await repos.users.createDelegation({ name: 'academia caucana' })).id).toBe(d.id);
      const u = await repos.users.create({ email: 'Club@Correo.com', name: 'Club', role: 'club', delegationId: d.id, inviteToken: 'tok', inviteExpiresAt: '2099-01-01T00:00:00.000Z' });
      expect((await repos.users.byEmail('club@correo.com'))?.id).toBe(u.id);
      expect((await repos.users.byInviteToken('tok'))?.id).toBe(u.id);
      await repos.users.setPassword(u.id, 'hash');
      expect((await repos.users.byId(u.id))?.inviteToken).toBeUndefined();
      expect(await repos.users.count()).toBe(1);
    });

    it('ajustes del evento, lotes e informes del host', async () => {
      await repos.settings.saveEventConfig({ totalCapacity: 10 });
      await repos.settings.saveEventConfig({ totalCapacity: 20 });
      expect((await repos.settings.eventSettings()).config.totalCapacity).toBe(20);
      expect((await repos.settings.eventSettings()).form.privacyNotice).toContain('Ley 1581');
      await repos.settings.addImportBatch({ fileName: 'a.csv', rows: 3, created: 2, updated: 1, unchanged: 0, duplicatesInFile: 0, errors: [], mapping: { birthDate: 'Fecha' }, byUser: 'coord' });
      expect((await repos.settings.importBatches())[0].created).toBe(2);
      await repos.settings.addHostReport({ hostId: 'h1', summary: { scans: 5 }, credentialsCount: 1 });
      expect((await repos.settings.hostReports())[0].summary.scans).toBe(5);
      await repos.settings.audit('coord', 'APPROVE', 'r_1');
      expect((await repos.settings.auditEntries())[0].action).toBe('APPROVE');
    });

    it('credencial: reporte del host y revocación bumpean updated_at para el export', async () => {
      const approved = (await repos.registrations.list({ status: 'APPROVED' }))[0];
      const before = approved.updatedAt;
      expect(await repos.registrations.setCredential(approved.id, { credentialId: 'TP-2026-00001-C', status: 'PRINTED', at: '2026-11-19T10:00:00.000Z' })).toBe(true);
      expect(await repos.registrations.setCredential('nope', { status: 'PRINTED', at: '2026-11-19T10:00:00.000Z' })).toBe(false);
      await new Promise((r) => setTimeout(r, 5));
      await repos.registrations.revoke(approved.id, 'perdida');
      const after = (await repos.registrations.byId(approved.id))!;
      expect(after.credentialStatus).toBe('REVOKED');
      expect(after.revokeReason).toBe('perdida');
      expect(after.updatedAt > before).toBe(true);
      expect((await repos.registrations.exportSince(before)).map((r) => r.id)).toContain(approved.id);
    });

    it('duplicados: candidatos por documento y por nombre+fecha; fusionar y marcar distintos', async () => {
      const x = await repos.registrations.upsert({ firstName: 'Carla', lastName: 'Mesa', birthDate: '1999-02-02', club: 'Club A', documentNumber: '555', roleCode: 'COACH', status: 'PENDING', source: 'online' });
      const y = await repos.registrations.upsert({ firstName: 'Carla', lastName: 'Mesa', birthDate: '1999-02-02', club: 'Club B', roleCode: 'COACH', status: 'PENDING', source: 'online', email: 'carla@x.com' });
      const z = await repos.registrations.upsert({ firstName: 'Otra', lastName: 'Persona', birthDate: '1980-02-02', club: 'Club C', documentNumber: '555', roleCode: 'GEN', status: 'PENDING', source: 'online' });
      const cands = await repos.registrations.duplicateCandidates();
      expect(cands.length).toBe(2);
      await repos.registrations.recordDuplicateDecision(x.registration.id, z.registration.id, 'distinct');
      expect((await repos.registrations.duplicateCandidates()).length).toBe(1);
      const merged = await repos.registrations.merge(x.registration.id, y.registration.id);
      expect(merged.email).toBe('carla@x.com');
      expect(await repos.registrations.byId(y.registration.id)).toBeUndefined();
      await repos.registrations.recordDuplicateDecision(x.registration.id, y.registration.id, 'merged');
      expect((await repos.registrations.duplicateCandidates()).length).toBe(0);
    });

    it('reportes: conteo por columna', async () => {
      const byRole = await repos.registrations.countBy('role_code');
      expect(byRole.find((r) => r.key === 'COMP')?.n).toBe(2);
    });

    it('token de credencial digital en cada fila; ensureCredentialToken es estable', async () => {
      const n = await repos.registrations.upsert({ firstName: 'Nora', lastName: 'Digital', birthDate: '1990-01-01', club: 'X', roleCode: 'GEN', status: 'PENDING', source: 'online' });
      expect(n.registration.credentialToken).toMatch(/^[A-Za-z0-9_-]{30,}$/);
      expect(await repos.registrations.ensureCredentialToken(n.registration.id)).toBe(n.registration.credentialToken);
      expect((await repos.registrations.byCredentialToken(n.registration.credentialToken!))?.id).toBe(n.registration.id);
      expect(await repos.registrations.byCredentialToken('')).toBeUndefined();
    });

    it('editar datos recalcula la clave de duplicados y detecta choques', async () => {
      const a = await repos.registrations.upsert({ firstName: 'Edu', lastName: 'Uno', birthDate: '1991-01-01', club: 'Club A', roleCode: 'COMP', categoryCode: 'ADU', status: 'PENDING', source: 'online' });
      const b = await repos.registrations.upsert({ firstName: 'Edu', lastName: 'Dos', birthDate: '1991-01-01', club: 'Club A', roleCode: 'COMP', categoryCode: 'ADU', status: 'PENDING', source: 'online', companionOf: undefined });
      await repos.registrations.upsert({ firstName: 'Mamá', lastName: 'Edu', birthDate: '', roleCode: 'ACOMP', status: 'PENDING', source: 'online', companionOf: a.registration.id, club: 'Club A' });
      const ok = await repos.registrations.updateDetails(a.registration.id, { lastName: 'Uno Editado', email: 'e@x.com', club: 'Club B' });
      expect(ok.ok).toBe(true);
      if (!ok.ok) return;
      expect(ok.registration.lastName).toBe('Uno Editado');
      expect((await repos.registrations.companionsOf(a.registration.id))[0].club).toBe('Club B');
      // mismo nombre+fecha+club que otra → conflicto, sin tocar nada
      const clash = await repos.registrations.updateDetails(a.registration.id, { lastName: 'Dos', club: 'Club A' });
      expect(clash.ok).toBe(false);
      if (clash.ok) return;
      expect(clash.conflict.id).toBe(b.registration.id);
      expect((await repos.registrations.byId(a.registration.id))!.lastName).toBe('Uno Editado');
    });
  });
}

suite('sqlite (memoria)', async () => {
  const driver = createSqliteDriver(':memory:');
  await migrate(driver);
  return { repos: createRepos(driver), close: () => driver.close() };
});

const PG = process.env.DATABASE_URL;
suite('postgres (DATABASE_URL)', async () => {
  process.env.PG_SCHEMA = 'tp_test';
  const { createPostgresDriver } = await import('../lib/db/postgres');
  const driver: SqlDriver = createPostgresDriver(PG!);
  await driver.exec('DROP SCHEMA IF EXISTS tp_test CASCADE; CREATE SCHEMA tp_test');
  await migrate(driver);
  return { repos: createRepos(driver), close: async () => { await driver.exec('DROP SCHEMA IF EXISTS tp_test CASCADE'); await driver.close(); } };
}, !PG);

describe('toPgPlaceholders', () => {
  it('numera los ? en orden', () => {
    expect(toPgPlaceholders('SELECT ? , ? WHERE a = ?')).toBe('SELECT $1 , $2 WHERE a = $3');
  });
});
