import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createDefaultConfig, generateKeyPair } from '@tatami/core';
import { buildApp } from '../src/server.js';

/** Nube falsa: simula GET /api/export?since= de apps/registration. */
interface FakeReg { id: string; firstName: string; lastName: string; birthDate: string; club?: string; roleCode: string; categoryCode?: string; updatedAt: string; companions: FakeReg[]; delegation?: string; emergencyContact?: { name: string; phone: string }; eps?: { name: string; regime?: string } }
const cloudData: FakeReg[] = [];
const cloud = Fastify();
let cloudUrl = '';
let cloudDown = false;
/** Reportes host → nube recibidos por la nube falsa (POST /api/host-report). */
interface ReportBody { hostId?: string; at?: string; summary?: Record<string, unknown>; credentials: { externalId: string; credentialId: string; version: number; status: string; updatedAt?: string }[] }
const reports: ReportBody[] = [];
let reportDown = false;
cloud.post<{ Body: ReportBody }>('/api/host-report', async (req, reply) => {
  if (reportDown) return reply.code(500).send({ error: 'boom' });
  if (req.headers['x-tatami-key'] !== 'secreto') return reply.code(401).send({ error: 'Clave x-tatami-key inválida.' });
  reports.push(req.body);
  const known = new Set(cloudData.flatMap((r) => [r.id, ...r.companions.map((c) => c.id)]));
  const unknown = req.body.credentials.filter((c) => !known.has(c.externalId)).map((c) => c.externalId);
  return { ok: true, reportId: `rep${reports.length}`, applied: req.body.credentials.length - unknown.length, unknown, invalid: 0 };
});
cloud.get<{ Querystring: { since?: string } }>('/api/export', async (req, reply) => {
  if (cloudDown) return reply.code(500).send({ error: 'boom' });
  if (req.headers['x-tatami-key'] !== 'secreto') return reply.code(401).send({ error: 'Clave inválida.' });
  const since = req.query.since;
  const regs = cloudData.filter((r) => !since || r.updatedAt > since || r.companions.some((c) => c.updatedAt > since));
  const cursor = regs.reduce((m, r) => [r.updatedAt, ...r.companions.map((c) => c.updatedAt)].reduce((a, b) => (a > b ? a : b), m), since ?? '');
  return { serverTime: new Date().toISOString(), since: since ?? null, cursor: cursor || null, count: regs.length, registrations: regs };
});

let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken = '';
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

beforeAll(async () => {
  await cloud.listen({ port: 0, host: '127.0.0.1' });
  const addr = cloud.server.address();
  cloudUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  app = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: generateKeyPair('kc'), cloud: { url: cloudUrl, key: 'secreto', intervalMinutes: 0 } });
  app.ctx.users.create('admin', 'admin123', 'ADMIN');
  app.ctx.users.create('audit', 'audit123', 'AUDITOR');
  adminToken = (await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
});

afterAll(async () => {
  await app.close();
  await cloud.close();
});

describe('actualización desde la nube', () => {
  it('status inicial: configurada, sin sincronizar', async () => {
    const r = await app.inject({ method: 'GET', url: '/sync/cloud/status', headers: auth(adminToken) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ configured: true, url: cloudUrl, intervalMinutes: 0, lastCloudSyncAt: null, online: null });
  });

  it('pull crea 2 inscripciones nuevas con acompañantes y emite credenciales', async () => {
    cloudData.push(
      { id: 'reg1', firstName: 'Ana', lastName: 'Ruiz', birthDate: '2010-05-01', club: 'Academia Caucana', roleCode: 'COMP', updatedAt: '2026-10-10T10:00:00.000Z',
        delegation: 'Cauca', emergencyContact: { name: 'Rosa Ruiz', phone: '3102345678' }, eps: { name: 'Sura', regime: 'Contributivo' },
        companions: [{ id: 'reg1c1', firstName: 'Pedro', lastName: 'Ruiz', birthDate: '', roleCode: 'ACOMP', updatedAt: '2026-10-10T10:00:00.000Z', companions: [] }] },
      { id: 'reg2', firstName: 'Luis', lastName: 'Gómez', birthDate: '1995-01-01', club: 'Tigres', roleCode: 'COACH', updatedAt: '2026-10-10T10:05:00.000Z', companions: [] }
    );
    const r = await app.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(adminToken) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, received: 2, created: 2, updated: 0, unchanged: 0, companionsCreated: 1, cursor: '2026-10-10T10:05:00.000Z' });
    expect(r.json().status.online).toBe(true);
    expect(app.ctx.credentials.count()).toBe(3);
    const ana = app.ctx.credentials.all().find((c) => c.displayName === 'Ana Ruiz')!;
    expect(ana).toMatchObject({ roleCode: 'COMP', categoryCode: 'JUV', club: 'Academia Caucana' });
    expect(app.ctx.persons.byId(ana.personId)).toMatchObject({ delegation: 'Cauca', emergencyContact: { name: 'Rosa Ruiz', phone: '3102345678' }, eps: { name: 'Sura', regime: 'Contributivo' } });
    const comps = app.ctx.credentials.companionsOf(ana.id);
    expect(comps).toHaveLength(1);
    expect(comps[0]).toMatchObject({ roleCode: 'ACOMP', displayName: 'Pedro Ruiz', zones: ['G'] });
  });

  it('tras el pull el host reporta a la nube los IDs/versiones emitidos (POST /api/host-report)', async () => {
    expect(reports).toHaveLength(1);
    const [rep] = reports;
    expect(rep.credentials).toHaveLength(3);
    expect(rep.credentials.map((c) => c.externalId).sort()).toEqual(['reg1', 'reg1c1', 'reg2']);
    for (const c of rep.credentials) {
      expect(c.credentialId).toMatch(/^TP-\d{4}-\d{5}-[A-Z0-9]$/);
      expect(c).toMatchObject({ version: 1, status: 'ISSUED' });
    }
    expect(rep.credentials.find((c) => c.externalId === 'reg1')!.credentialId).toBe(app.ctx.credentials.all().find((c) => c.displayName === 'Ana Ruiz')!.id);
    const st = (await app.inject({ method: 'GET', url: '/sync/cloud/status', headers: auth(adminToken) })).json();
    expect(st.lastReport).toMatchObject({ ok: true, sent: 3, applied: 3, unknown: [] });
    expect(st.lastResult.report).toMatchObject({ ok: true, sent: 3 });
    expect(app.ctx.audit.all().some((a) => a.action === 'CLOUD_REPORT')).toBe(true);
  });

  it('pull repetido sin cambios = 0 cambios (idempotente)', async () => {
    const r = await app.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(adminToken) });
    expect(r.json()).toMatchObject({ ok: true, received: 0, created: 0, updated: 0, companionsCreated: 0 });
    expect(app.ctx.credentials.count()).toBe(3);
    // incluso sin cursor (desde cero) no duplica
    app.ctx.meta.set('cloudCursor', '');
    const r2 = await app.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(adminToken) });
    expect(r2.json()).toMatchObject({ ok: true, received: 2, created: 0, unchanged: 2, companionsCreated: 0 });
    expect(app.ctx.credentials.count()).toBe(3);
    // el reporte también es idempotente: sin cambios no se vuelve a enviar nada
    expect(reports).toHaveLength(1);
    expect(r2.json().report).toMatchObject({ ok: true, sent: 0 });
  });

  it('una revocación en el host llega a la nube en el siguiente reporte; si la nube falla, se reintenta después', async () => {
    const luis = app.ctx.credentials.all().find((c) => c.displayName === 'Luis Gómez')!;
    const rev = await app.inject({ method: 'POST', url: `/credentials/${luis.id}/revoke`, headers: auth(adminToken), payload: { reason: 'prueba' } });
    expect(rev.statusCode).toBe(200);
    // la nube acepta el pull pero su endpoint de reporte falla: el pull sigue OK y el reporte queda pendiente
    reportDown = true;
    const r1 = await app.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(adminToken) });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().ok).toBe(true);
    expect(r1.json().report).toMatchObject({ ok: false, sent: 1 });
    expect(r1.json().report.error).toContain('500');
    expect(reports).toHaveLength(1);
    reportDown = false;
    const r2 = await app.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(adminToken) });
    expect(r2.json().report).toMatchObject({ ok: true, sent: 1, applied: 1 });
    expect(reports).toHaveLength(2);
    expect(reports[1].credentials).toEqual([expect.objectContaining({ externalId: 'reg2', credentialId: luis.id, status: 'REVOKED' })]);
    // `force` reenvía todo (útil al cierre o tras restaurar la nube)
    const forced = await app.ctx.cloud.report({ force: true });
    expect(forced).toMatchObject({ ok: true, sent: 3, applied: 3 });
    expect(reports).toHaveLength(3);
    // con clave equivocada la nube responde 401 y el host lo registra sin romper nada
    const bad = new (app.ctx.cloud.constructor as new (...a: unknown[]) => typeof app.ctx.cloud)(app.ctx, { url: cloudUrl, key: 'otra', intervalMinutes: 0 }, () => undefined);
    const unauthorized = await bad.report({ force: true });
    expect(unauthorized.ok).toBe(false);
    expect(unauthorized.error).toContain('401');
  });

  it('una inscripción actualizada en la nube actualiza la credencial sin re-emitir', async () => {
    cloudData[1] = { ...cloudData[1], club: 'Tigres Cali', updatedAt: '2026-10-11T08:00:00.000Z' };
    const before = app.ctx.credentials.all().find((c) => c.displayName === 'Luis Gómez')!;
    const r = await app.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(adminToken) });
    expect(r.json()).toMatchObject({ ok: true, received: 1, created: 0, updated: 1, cursor: '2026-10-11T08:00:00.000Z' });
    const after = app.ctx.credentials.byId(before.id)!;
    expect(after.club).toBe('Tigres Cali');
    expect(after.version).toBe(before.version);
    expect(after.token).toBe(before.token);
    const st = (await app.inject({ method: 'GET', url: '/sync/cloud/status', headers: auth(adminToken) })).json();
    expect(st.lastCloudSyncAt).toBeTruthy();
    expect(st.lastResult.updated).toBe(1);
    expect(st.message).toContain('Última actualización');
  });

  it('sin internet: 503 con mensaje, estado "sin conexión", y no rompe nada', async () => {
    cloudDown = true;
    const r = await app.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(adminToken) });
    expect(r.statusCode).toBe(503);
    expect(r.json().ok).toBe(false);
    expect(r.json().error).toContain('500');
    const st = (await app.inject({ method: 'GET', url: '/sync/cloud/status', headers: auth(adminToken) })).json();
    expect(st.online).toBe(false);
    expect(st.message).toContain('Sin conexión a la nube');
    cloudDown = false;
    expect(app.ctx.credentials.count()).toBe(3);
  });

  it('permisos: auditor no puede hacer pull pero sí ver el estado', async () => {
    const t = (await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'audit', password: 'audit123' } })).json().token;
    expect((await app.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(t) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/sync/cloud/status', headers: auth(t) })).statusCode).toBe(200);
  });

  it('sin TP_CLOUD_URL el endpoint responde 409 con mensaje claro', async () => {
    const noCloud = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: generateKeyPair('kn'), cloud: { intervalMinutes: 5 } });
    noCloud.ctx.users.create('admin', 'admin123', 'ADMIN');
    const t = (await noCloud.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
    const r = await noCloud.inject({ method: 'POST', url: '/sync/cloud/pull', headers: auth(t) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toContain('TP_CLOUD_URL');
    noCloud.ctx.cloud.startScheduler(); // no debe programar nada
    expect(noCloud.ctx.cloud.status()).toMatchObject({ configured: false, nextRunAt: null });
    await noCloud.close();
  });

  it('el scheduler programa la siguiente ejecución y no solapa', async () => {
    app.ctx.cloud.settings.intervalMinutes = 1;
    app.ctx.cloud.startScheduler();
    expect(app.ctx.cloud.status().nextRunAt).toBeTruthy();
    const [a, b] = await Promise.all([app.ctx.cloud.pull(), app.ctx.cloud.pull()]);
    expect(a).toBe(b); // misma ejecución compartida
    app.ctx.cloud.stopScheduler();
    expect(app.ctx.cloud.status().nextRunAt).toBeNull();
  });

  it('vista previa: muestra lo que falta por traer sin mover el cursor; el intervalo se edita y persiste', async () => {
    cloudData.push({ id: 'reg3', firstName: 'Nueva', lastName: 'Persona', birthDate: '2001-01-01', roleCode: 'PRESS', updatedAt: '2026-10-12T08:00:00.000Z', companions: [] });
    cloudData[1] = { ...cloudData[1], club: 'Tigres Norte', updatedAt: '2026-10-12T09:00:00.000Z' };
    const cursor = app.ctx.meta.get('cloudCursor');
    const p = await app.inject({ method: 'GET', url: '/sync/cloud/preview', headers: auth(adminToken) });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ ok: true, count: 2, newCount: 1, updatedCount: 1 });
    expect(p.json().items.find((i: { id: string }) => i.id === 'reg3')).toMatchObject({ name: 'Nueva Persona', roleCode: 'PRESS', isNew: true });
    expect(app.ctx.meta.get('cloudCursor')).toBe(cursor);
    expect(app.ctx.credentials.count()).toBe(3);
    // pendientes de imprimir que trajo la nube
    const pend = (await app.inject({ method: 'GET', url: '/registrations/pending', headers: auth(adminToken) })).json();
    expect(pend.total).toBe(2); // 3 de la nube menos la anulada en el test del reporte
    expect(pend.cloud.configured).toBe(true);
    // intervalo editable
    const s = await app.inject({ method: 'PUT', url: '/sync/cloud/settings', headers: auth(adminToken), payload: { intervalMinutes: 15 } });
    expect(s.json().intervalMinutes).toBe(15);
    expect(s.json().message).toContain('15 min');
    expect(app.ctx.meta.get('cloudIntervalMinutes')).toBe('15');
    expect(app.ctx.cloud.status().nextRunAt).toBeNull(); // el scheduler no estaba activo: no se arranca solo
    const off = await app.inject({ method: 'PUT', url: '/sync/cloud/settings', headers: auth(adminToken), payload: { intervalMinutes: 0 } });
    expect(off.json().message).toContain('solo manual');
    cloudDown = true;
    const down = await app.inject({ method: 'GET', url: '/sync/cloud/preview', headers: auth(adminToken) });
    expect(down.statusCode).toBe(503);
    expect(down.json().error).toContain('Sin conexión');
    cloudDown = false;
  });
});
