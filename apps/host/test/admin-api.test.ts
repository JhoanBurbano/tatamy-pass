/**
 * API nueva del panel (/admin): emisión manual, QR/token, lote entregado,
 * rechazos por puerta, copias con segundo destino + rotación 48 + 1/hora +
 * verificación, TP_ROLE y purga desde el panel.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultConfig, generateKeyPair, type ScanEvent } from '@tatami/core';
import { buildApp } from '../src/server.js';
import { seedCredentials } from '../src/seed-data.js';
import { listBackups, rotateBackups, takeSnapshot, verifySnapshot } from '../src/backup.js';
import { resolveMode } from '../src/replication.js';
import { MetaRepo } from '../src/repos.js';
import { openDb } from '../src/db.js';

const key = generateKeyPair('kadmin');
const tmp = mkdtempSync(join(tmpdir(), 'tatami-admin-'));
let app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {};
let deviceToken = '';
let deviceId = '';
const auth = (u: string) => ({ authorization: `Bearer ${tokens[u]}` });

beforeAll(async () => {
  app = await buildApp({ dbPath: ':memory:', config: createDefaultConfig({ totalCapacity: 70 }), signingKey: key, backupsDir: join(tmp, 'backups'), backupsDir2: join(tmp, 'usb'), configPath: null });
  for (const [u, r] of [['admin', 'ADMIN'], ['coord', 'COORDINATOR'], ['print', 'PRINTER'], ['super', 'SUPERVISOR'], ['audit', 'AUDITOR']] as const) {
    app.ctx.users.create(u, `${u}123`, r);
    tokens[u] = (await app.inject({ method: 'POST', url: '/auth/login', payload: { username: u, password: `${u}123` } })).json().token;
  }
  seedCredentials(app.ctx, 60);
  const t = (await app.inject({ method: 'POST', url: '/devices/enroll-token', headers: auth('super'), payload: { name: 'Puerta 1', zone: 'T' } })).json();
  const e = (await app.inject({ method: 'POST', url: '/devices/enroll', payload: { token: t.token, pin: '123456' } })).json();
  deviceToken = e.deviceToken; deviceId = e.deviceId;
});

afterAll(async () => { await app.close(); rmSync(tmp, { recursive: true, force: true }); });

describe('emisión manual en sitio', () => {
  it('valida campos, rol, edad/categoría y acudiente; emite y luego rechaza el documento repetido', async () => {
    const missing = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('coord'), payload: { firstName: 'Solo', roleCode: 'PRESS' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().errors.map((e: { path: string }) => e.path)).toContain('lastName');
    const badRole = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('coord'), payload: { firstName: 'A', lastName: 'B', roleCode: 'NOPE' } });
    expect(badRole.json().errors[0].path).toBe('roleCode');
    const compNoBirth = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('coord'), payload: { firstName: 'A', lastName: 'B', roleCode: 'COMP' } });
    expect(compNoBirth.json().error).toMatch(/fecha de nacimiento/);
    const wrongCat = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('coord'), payload: { firstName: 'A', lastName: 'B', roleCode: 'COMP', birthDate: '2000-01-01', categoryCode: 'INF_A', guardian: { name: 'x', document: '1' } } });
    expect(wrongCat.json().errors[0].path).toBe('categoryCode');
    const minor = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('coord'), payload: { firstName: 'Niño', lastName: 'Menor', roleCode: 'COMP', birthDate: '2014-03-01' } });
    expect(minor.json().errors[0].path).toBe('guardian');

    const ok = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('coord'), payload: { firstName: 'Laura', lastName: 'Prensa', roleCode: 'PRESS', documentNumber: '77.001', club: 'El Diario', note: 'llegó sin acreditar' } });
    expect(ok.statusCode).toBe(201);
    const c = ok.json().credential;
    expect(c.roleCode).toBe('PRESS');
    expect(c.displayName).toBe('Laura Prensa');
    expect(c.token).toMatch(/^TP1\./);
    expect(app.ctx.persons.byId(c.personId)!.source).toBe('manual');
    expect(app.ctx.audit.last()!.action).toBe('CREDENTIAL_ISSUED_MANUAL');
    // competidor menor con acudiente: categoría automática
    const comp = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('admin'), payload: { firstName: 'Niño', lastName: 'Menor', roleCode: 'COMP', birthDate: '2014-03-01', guardian: { name: 'Mamá', document: '9' } } });
    expect(comp.statusCode).toBe(201);
    expect(comp.json().credential.categoryCode).toBe('INF_B');
    expect(app.ctx.persons.byId(comp.json().credential.personId)!.guardian).toMatchObject({ name: 'Mamá', document: '9' });
    // documento repetido → 409 con el id existente
    const dup = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('coord'), payload: { firstName: 'Otra', lastName: 'Persona', roleCode: 'PRESS', documentNumber: '77001' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().credentialId).toBe(c.id);
    // acompañante ligado a un participante
    const acomp = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('coord'), payload: { firstName: 'Papá', lastName: 'Prensa', roleCode: 'GEN', companionOf: c.id, relationship: 'Padre' } });
    expect(acomp.statusCode).toBe(201);
    expect(acomp.json().credential.roleCode).toBe('ACOMP');
    expect(acomp.json().credential.companionOf).toBe(c.id);
    // supervisor y auditor no emiten
    expect((await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('super'), payload: { firstName: 'A', lastName: 'B', roleCode: 'GEN' } })).statusCode).toBe(403);
  });

  it('aforo total: con 70 de cupo no deja emitir la 71', async () => {
    const n = app.ctx.credentials.count();
    for (let i = n; i < 70; i++) expect((await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('admin'), payload: { firstName: `Gen${i}`, lastName: 'X', roleCode: 'GEN' } })).statusCode).toBe(201);
    const full = await app.inject({ method: 'POST', url: '/credentials/issue', headers: auth('admin'), payload: { firstName: 'Uno', lastName: 'Más', roleCode: 'GEN' } });
    expect(full.statusCode).toBe(400);
    expect(full.json().error).toMatch(/aforo total/);
  });
});

describe('credenciales: token, lote entregado, pendientes de la nube', () => {
  it('ver QR/token solo admin, coord e impresión; queda en la auditoría', async () => {
    const c = app.ctx.credentials.all()[0];
    const r = await app.inject({ method: 'GET', url: `/credentials/${c.id}/token`, headers: auth('print') });
    expect(r.statusCode).toBe(200);
    expect(r.json().token).toBe(c.token);
    expect((await app.inject({ method: 'GET', url: `/credentials/${c.id}/token`, headers: auth('audit') })).statusCode).toBe(403);
    expect(app.ctx.audit.last()!.action).toBe('CREDENTIAL_TOKEN_VIEWED');
    // anular exige motivo y no se anula dos veces
    expect((await app.inject({ method: 'POST', url: `/credentials/${c.id}/revoke`, headers: auth('super'), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/credentials/${c.id}/revoke`, headers: auth('super'), payload: { reason: 'perdida' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/credentials/${c.id}/revoke`, headers: auth('super'), payload: { reason: 'otra vez' } })).statusCode).toBe(409);
  });

  it('lote: vista previa, impreso y entregado marcan todas las credenciales', async () => {
    const b = (await app.inject({ method: 'POST', url: '/print/batches', headers: auth('print'), payload: { roleCode: 'GEN', status: 'ISSUED', limit: 5 } })).json();
    expect(b.count).toBeGreaterThan(0);
    const preview = (await app.inject({ method: 'GET', url: `/print/batches/${b.id}`, headers: auth('audit') })).json();
    expect(preview.items.length).toBe(b.count);
    expect(preview.items[0].token).toBeUndefined();
    expect((await app.inject({ method: 'POST', url: `/print/batches/${b.id}/printed`, headers: auth('print') })).json().status).toBe('PRINTED');
    const d = (await app.inject({ method: 'POST', url: `/print/batches/${b.id}/delivered`, headers: auth('print') })).json();
    expect(d.status).toBe('DELIVERED');
    expect(d.credentialsUpdated).toBe(b.count);
    expect(app.ctx.credentials.byId(b.credentialIds[0])!.status).toBe('DELIVERED');
  });

  it('pendientes de la nube: credenciales con external_id en estado emitida', async () => {
    const p = app.ctx.persons.upsert({ id: 'cloud_r9', firstName: 'Nube', lastName: 'Uno', birthDate: '2000-01-01', source: 'online', externalId: 'r9' });
    const c = app.ctx.credentials.issue({ person: p, roleCode: 'COACH' });
    const r = (await app.inject({ method: 'GET', url: '/registrations/pending', headers: auth('print') })).json();
    expect(r.total).toBe(1);
    expect(r.items[0].id).toBe(c.id);
    expect(r.items[0].token).toBeUndefined();
    expect(r.byRole.COACH).toBe(1);
    expect(r.cloud.configured).toBe(false);
    app.ctx.credentials.markPrinted([c.id]);
    expect((await app.inject({ method: 'GET', url: '/registrations/pending', headers: auth('print') })).json().total).toBe(0);
    // sin nube configurada, preview y settings responden 409 / validan
    expect((await app.inject({ method: 'GET', url: '/sync/cloud/preview', headers: auth('coord') })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: '/sync/cloud/settings', headers: auth('coord'), payload: { intervalMinutes: -1 } })).statusCode).toBe(400);
    const s = (await app.inject({ method: 'PUT', url: '/sync/cloud/settings', headers: auth('coord'), payload: { intervalMinutes: 7 } })).json();
    expect(s.intervalMinutes).toBe(7);
    expect(app.ctx.meta.get('cloudIntervalMinutes')).toBe('7');
  });
});

describe('alertas: rechazos por puerta', () => {
  it('cuenta los DENY de hoy por puerta y motivo, con los últimos casos', async () => {
    const creds = app.ctx.credentials.all();
    const now = Date.now();
    const events: ScanEvent[] = [
      { id: `${deviceId}:1`, deviceId, seq: 1, credentialId: creds[1].id, zone: 'T', direction: 'IN', decision: 'ALLOW', reasonCode: 'OK', at: new Date(now - 3000).toISOString() },
      { id: `${deviceId}:2`, deviceId, seq: 2, credentialId: creds[1].id, zone: 'T', direction: 'IN', decision: 'DENY', reasonCode: 'ANTI_PASSBACK', at: new Date(now - 2000).toISOString() },
      { id: `${deviceId}:3`, deviceId, seq: 3, credentialId: creds[2].id, zone: 'T', direction: 'IN', decision: 'DENY', reasonCode: 'ZONE_NOT_ALLOWED', at: new Date(now - 1000).toISOString() }
    ];
    expect((await app.inject({ method: 'POST', url: '/sync/events', headers: { authorization: `Bearer ${deviceToken}` }, payload: { events } })).json().accepted).toBe(3);
    const r = (await app.inject({ method: 'GET', url: '/alerts/denied', headers: auth('super') })).json();
    expect(r.total).toBe(2);
    expect(r.byReason).toEqual({ ANTI_PASSBACK: 1, ZONE_NOT_ALLOWED: 1 });
    expect(r.byGate.find((x: { deviceId: string }) => x.deviceId === deviceId).denied).toBe(2);
    expect(r.recent[0].device).toBe('Puerta 1');
    expect(r.recent[0].credential.displayName).toBe(creds[2].displayName);
    // renombrar puerta
    const renamed = (await app.inject({ method: 'PATCH', url: `/devices/${deviceId}`, headers: auth('super'), payload: { name: 'Puerta 1 · Tatamis' } })).json();
    expect(renamed.name).toBe('Puerta 1 · Tatamis');
  });
});

describe('copias de seguridad', () => {
  it('snapshot va al destino principal y al segundo; verificación abre y cuenta filas', async () => {
    const r = (await app.inject({ method: 'POST', url: '/backup/snapshot', headers: auth('admin') })).json();
    expect(r.secondary.ok).toBe(true);
    expect(existsSync(join(tmp, 'usb', r.name))).toBe(true);
    expect(r.message).toMatch(/segundo destino/);
    const v = (await app.inject({ method: 'POST', url: '/backup/verify', headers: auth('audit'), payload: { name: r.name } })).json();
    expect(v.ok).toBe(true);
    expect(v.integrity).toBe('ok');
    expect(v.credentials).toBe(app.ctx.credentials.count());
    expect(v.scans).toBe(app.ctx.scans.count());
    expect(v.audit).toBeGreaterThan(0);
    expect(v.current.credentials).toBe(v.credentials);
    expect(v.message).toMatch(/Copia íntegra/);
    expect((await app.inject({ method: 'POST', url: '/backup/verify', headers: auth('audit'), payload: { name: '../../etc/passwd' } })).statusCode).toBe(404);
    const st = (await app.inject({ method: 'GET', url: '/backup/list', headers: auth('audit') })).json();
    expect(st.dir2).toBe(join(tmp, 'usb'));
    expect(st.count2).toBe(1);
    expect(st.lastBackup2At).toBeTruthy();
    expect(st.keep).toBe(48);
    // una copia dañada se detecta
    const broken = join(tmp, 'backups', 'tatami-rota.db');
    writeFileSync(broken, 'esto no es sqlite');
    expect((await app.inject({ method: 'POST', url: '/backup/verify', headers: auth('audit'), payload: { name: 'tatami-rota.db' } })).statusCode).toBe(400);
    rmSync(broken);
  });

  it('si el segundo destino no está disponible, la copia principal se hace igual y se avisa', async () => {
    writeFileSync(join(tmp, 'no-es-carpeta'), 'x');
    const other = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, backupsDir: join(tmp, 'b-alt'), backupsDir2: join(tmp, 'no-es-carpeta', 'usb'), configPath: null });
    const r = takeSnapshot(other.ctx, 'test');
    expect(existsSync(r.file)).toBe(true);
    expect(r.secondary?.ok).toBe(false);
    expect(other.ctx.meta.get('lastBackup2Error')).toBeTruthy();
    await other.close();
  });

  it('rotación 48 + 1 por hora', () => {
    const dir = join(tmp, 'rot');
    rmSync(dir, { recursive: true, force: true });
    const db = openDb(':memory:');
    db.close();
    // 60 copias cada 5 min (5 h) + 24 copias más viejas repartidas en 6 horas (4 por hora)
    const base = Date.parse('2026-11-20T12:00:00Z');
    const stamps: number[] = [];
    for (let i = 0; i < 60; i++) stamps.push(base - i * 5 * 60_000);
    for (let i = 0; i < 24; i++) stamps.push(base - 6 * 3600_000 - i * 15 * 60_000);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const t of stamps) {
      const f = join(dir, `tatami-${new Date(t).toISOString().replace(/[:.]/g, '-')}.db`);
      writeFileSync(f, 'x');
      utimesSync(f, new Date(t), new Date(t));
    }
    expect(listBackups(dir).length).toBe(84);
    const removed = rotateBackups(dir, 48);
    const left = listBackups(dir);
    // 48 recientes + de las 36 restantes (13 en las horas 08-07 y 24 entre las 06 y las 00) una por hora: 9 horas distintas
    expect(left.length).toBe(48 + 9);
    expect(removed).toBe(84 - left.length);
    // las 48 más recientes siguen intactas
    expect(left.slice(0, 48).map((b) => b.name)).toEqual(stamps.slice(0, 48).map((t) => `tatami-${new Date(t).toISOString().replace(/[:.]/g, '-')}.db`));
    // ningún archivo que no sea copia se toca
    expect(readdirSync(dir).every((f) => f.startsWith('tatami-'))).toBe(true);
    expect(rotateBackups(dir, 48)).toBe(0);
    expect(verifySnapshot).toBeTypeOf('function');
  });
});

describe('modo del host', () => {
  it('TP_ROLE y TP_MODE definen el modo si la base no lo recuerda', () => {
    const db = openDb(':memory:');
    const meta = new MetaRepo(db);
    const prev = { role: process.env.TP_ROLE, mode: process.env.TP_MODE };
    delete process.env.TP_ROLE; delete process.env.TP_MODE;
    expect(resolveMode({ meta })).toBe('primary');
    process.env.TP_ROLE = 'standby';
    expect(resolveMode({ meta })).toBe('standby');
    delete process.env.TP_ROLE; process.env.TP_MODE = 'standby';
    expect(resolveMode({ meta })).toBe('standby');
    meta.set('hostMode', 'primary');
    expect(resolveMode({ meta })).toBe('primary');
    if (prev.role !== undefined) process.env.TP_ROLE = prev.role; else delete process.env.TP_ROLE;
    if (prev.mode !== undefined) process.env.TP_MODE = prev.mode; else delete process.env.TP_MODE;
    db.close();
  });

  it('purga desde el panel: simulación, confirmación con el nombre del evento y resumen', async () => {
    const dry = (await app.inject({ method: 'POST', url: '/system/purge', headers: auth('admin'), payload: { dryRun: true, force: true } })).json();
    expect(dry.dryRun).toBe(true);
    expect(dry.persons).toBe(app.ctx.persons.count());
    expect((await app.inject({ method: 'POST', url: '/system/purge', headers: auth('admin'), payload: { dryRun: false, force: true, confirm: 'otro nombre' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/system/purge', headers: auth('coord'), payload: { dryRun: false, force: true, confirm: app.ctx.config.name } })).statusCode).toBe(403);
    const real = (await app.inject({ method: 'POST', url: '/system/purge', headers: auth('admin'), payload: { dryRun: false, force: true, confirm: app.ctx.config.name } })).json();
    expect(real.persons).toBe(dry.persons);
    expect(real.summary.credentialsByRole).toBeTruthy();
    const h = (await app.inject({ method: 'GET', url: '/system/health', headers: auth('audit') })).json();
    expect(h.purge.pending).toBe(0);
    expect(h.purge.lastSummary.persons).toBe(dry.persons);
    expect(h.backups.dir2).toBe(join(tmp, 'usb'));
    expect(h.role).toBe('primary');
  });
});
