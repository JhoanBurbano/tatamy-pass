import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultConfig, generateKeyPair, verifyToken, evaluateScan, type ScanEvent } from '@tatami/core';
import { buildApp } from '../src/server.js';
import { seedCredentials } from '../src/seed-data.js';

const key = generateKeyPair('ktest');
const tmp = mkdtempSync(join(tmpdir(), 'tatami-host-'));
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken = '';
let auditToken = '';
let deviceToken = '';
let deviceId = '';

beforeAll(async () => {
  app = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, backupsDir: join(tmp, 'backups') });
  app.ctx.users.create('admin', 'admin123', 'ADMIN');
  app.ctx.users.create('audit', 'audit123', 'AUDITOR');
  seedCredentials(app.ctx, 50);
});

afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

describe('health y auth', () => {
  it('GET /health', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, event: 'nac2026', credentials: 50 });
  });

  it('login correcto e incorrecto', async () => {
    const bad = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } });
    expect(ok.statusCode).toBe(200);
    adminToken = ok.json().token;
    auditToken = (await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'audit', password: 'audit123' } })).json().token;
    expect(adminToken).toBeTruthy();
  });

  it('endpoints protegidos exigen sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/sync/snapshot' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/reports/gate-summary', headers: auth('xxx') })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/backup/snapshot', headers: auth(auditToken) })).statusCode).toBe(403);
  });
});

describe('enrolamiento', () => {
  it('crea token (10 min) y enrola con PIN', async () => {
    const t = await app.inject({ method: 'POST', url: '/devices/enroll-token', headers: auth(adminToken), payload: { name: 'Puerta T1', zone: 'T' } });
    expect(t.statusCode).toBe(200);
    const { token, expiresAt } = t.json();
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    const badPin = await app.inject({ method: 'POST', url: '/devices/enroll', payload: { token, pin: '12' } });
    expect(badPin.statusCode).toBe(400);

    const e = await app.inject({ method: 'POST', url: '/devices/enroll', payload: { token, pin: '123456' } });
    expect(e.statusCode).toBe(200);
    deviceToken = e.json().deviceToken;
    deviceId = e.json().deviceId;
    expect(e.json()).toMatchObject({ zone: 'T', role: 'CONTROL', name: 'Puerta T1' });

    // el token es de un solo uso
    const again = await app.inject({ method: 'POST', url: '/devices/enroll', payload: { token, pin: '123456' } });
    expect(again.statusCode).toBe(400);
    // zona inválida
    const bz = await app.inject({ method: 'POST', url: '/devices/enroll-token', headers: auth(adminToken), payload: { name: 'x', zone: 'ZZ' } });
    expect(bz.statusCode).toBe(400);
  });
});

describe('sync', () => {
  let credId = '';
  let credToken = '';

  it('snapshot trae config con clave pública, credenciales sin token y revocaciones', async () => {
    const r = await app.inject({ method: 'GET', url: '/sync/snapshot', headers: auth(deviceToken) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.config.signingKeys[0]).toEqual({ kid: 'ktest', publicKeyHex: key.publicKeyHex });
    expect(body.credentials).toHaveLength(50);
    expect(body.credentials[0].token).toBeUndefined();
    expect(body.credentials[0].id).toMatch(/^TP-2026-\d{5}-[0-9A-Z]$/);
    expect(body.revocations).toEqual([]);
    credId = body.credentials.find((c: { roleCode: string }) => c.roleCode === 'COMP').id;
    credToken = app.ctx.credentials.byId(credId)!.token;
    // el token firmado por el host verifica con la clave pública del snapshot y pasa las reglas
    const v = verifyToken(credToken, body.config.signingKeys);
    expect(v.ok).toBe(true);
    const res = evaluateScan({
      source: { kind: 'token', verification: v }, credential: body.credentials.find((c: { id: string }) => c.id === credId), zone: 'T',
      now: '2026-11-20T14:00:00Z', device: { id: deviceId, zone: 'T', role: 'CONTROL' }, recentScans: [], revocations: [], config: body.config
    });
    expect(res.decision).toBe('ALLOW');
  });

  it('POST /sync/events es idempotente por (deviceId, seq)', async () => {
    const ev = (seq: number, extra: Partial<ScanEvent> = {}): ScanEvent => ({
      id: `${deviceId}:${seq}`, deviceId, seq, credentialId: credId, zone: 'T', direction: 'IN', decision: 'ALLOW', reasonCode: 'OK_PHOTO_CHECK',
      at: `2026-11-20T14:0${seq}:00.000Z`, tokenVersion: 1, ...extra
    });
    const first = await app.inject({ method: 'POST', url: '/sync/events', headers: auth(deviceToken), payload: { events: [ev(1), ev(2), ev(3)] } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ accepted: 3, duplicates: 0 });

    const retry = await app.inject({ method: 'POST', url: '/sync/events', headers: auth(deviceToken), payload: { events: [ev(2), ev(3), ev(4)] } });
    expect(retry.json()).toMatchObject({ accepted: 1, duplicates: 2 });
    expect(app.ctx.scans.count()).toBe(4);
    expect(app.ctx.devices.byId(deviceId)!.lastSeq).toBe(4);
  });

  it('un dispositivo no puede subir eventos de otro', async () => {
    const r = await app.inject({ method: 'POST', url: '/sync/events', headers: auth(deviceToken), payload: { events: [{ id: 'otro:1', deviceId: 'otro', seq: 1, credentialId: null, zone: 'T', direction: 'IN', decision: 'DENY', reasonCode: 'MALFORMED', at: '2026-11-20T14:00:00Z' }] } });
    expect(r.statusCode).toBe(403);
    const bad = await app.inject({ method: 'POST', url: '/sync/events', headers: auth(deviceToken), payload: { events: [{ seq: 'x' }] } });
    expect(bad.statusCode).toBe(400);
    const notArray = await app.inject({ method: 'POST', url: '/sync/events', headers: auth(deviceToken), payload: { nope: 1 } });
    expect(notArray.statusCode).toBe(400);
  });

  it('GET /sync/events?since= pagina por receivedAt', async () => {
    const all = await app.inject({ method: 'GET', url: '/sync/events', headers: auth(deviceToken) });
    expect(all.json().events).toHaveLength(4);
    const cursor = all.json().cursor;
    expect(cursor).toBeTruthy();
    const none = await app.inject({ method: 'GET', url: `/sync/events?since=${encodeURIComponent(cursor)}`, headers: auth(deviceToken) });
    expect(none.json().events).toHaveLength(0);
    expect(none.json().cursor).toBe(cursor);
    const limited = await app.inject({ method: 'GET', url: '/sync/events?limit=2', headers: auth(deviceToken) });
    expect(limited.json().events).toHaveLength(2);
  });

  it('revocar aparece en snapshot y bloquea el escaneo', async () => {
    const r = await app.inject({ method: 'POST', url: `/credentials/${credId}/revoke`, headers: auth(adminToken), payload: { reason: 'Credencial reportada perdida' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().credential.status).toBe('REVOKED');
    const snap = (await app.inject({ method: 'GET', url: '/sync/snapshot', headers: auth(deviceToken) })).json();
    expect(snap.revocations).toEqual([expect.objectContaining({ credentialId: credId, version: null })]);
    const res = evaluateScan({
      source: { kind: 'token', verification: verifyToken(credToken, snap.config.signingKeys) },
      credential: snap.credentials.find((c: { id: string }) => c.id === credId), zone: 'T', now: '2026-11-20T14:00:00Z',
      device: { id: deviceId, zone: 'T', role: 'CONTROL' }, recentScans: [], revocations: snap.revocations, config: snap.config
    });
    expect(res.reasonCode).toBe('REVOKED');
    expect((await app.inject({ method: 'POST', url: '/credentials/NOPE/revoke', headers: auth(adminToken) })).statusCode).toBe(404);
  });

  it('reemitir sube la versión y revoca la anterior', async () => {
    const other = app.ctx.credentials.all().find((c) => c.id !== credId && c.status !== 'REVOKED')!;
    const oldToken = other.token;
    const r = await app.inject({ method: 'POST', url: `/credentials/${other.id}/reissue`, headers: auth(adminToken), payload: { reason: 'Foto incorrecta' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().credential.version).toBe(2);
    expect(r.json().credential.token).not.toBe(oldToken);
    const snap = (await app.inject({ method: 'GET', url: '/sync/snapshot', headers: auth(deviceToken) })).json();
    const local = snap.credentials.find((c: { id: string }) => c.id === other.id);
    expect(local.version).toBe(2);
    const scanOld = evaluateScan({
      source: { kind: 'token', verification: verifyToken(oldToken, snap.config.signingKeys) }, credential: local, zone: 'G', now: '2026-11-20T14:00:00Z',
      device: { id: deviceId, zone: 'G', role: 'CONTROL' }, recentScans: [], revocations: snap.revocations, config: snap.config
    });
    expect(scanOld.reasonCode).toBe('OLD_VERSION');
    const scanNew = evaluateScan({
      source: { kind: 'token', verification: verifyToken(r.json().credential.token, snap.config.signingKeys) }, credential: local, zone: 'G', now: '2026-11-20T14:00:00Z',
      device: { id: deviceId, zone: 'G', role: 'CONTROL' }, recentScans: [], revocations: snap.revocations, config: snap.config
    });
    expect(scanNew.decision).toBe('ALLOW');
    // auditor no puede reemitir
    expect((await app.inject({ method: 'POST', url: `/credentials/${other.id}/reissue`, headers: auth(auditToken) })).statusCode).toBe(403);
  });
});

describe('acompañantes', () => {
  it('GET /credentials/:id/companions lista los acompañantes ligados y los límites', async () => {
    const parent = app.ctx.credentials.all().find((c) => c.roleCode === 'COMP' && app.ctx.credentials.companionsOf(c.id).length > 0)!;
    expect(parent).toBeTruthy();
    const r = await app.inject({ method: 'GET', url: `/credentials/${parent.id}/companions`, headers: auth(auditToken) });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.count).toBeGreaterThan(0);
    expect(body.count).toBeLessThanOrEqual(2);
    expect(body.companions[0]).toMatchObject({ roleCode: 'ACOMP', companionOf: parent.id, zones: ['G'] });
    expect(body.companions[0].token).toBeUndefined();
    expect(body.limits).toEqual({ perParticipant: 2, total: null, totalCapacity: 2000 });
    expect(body.usedCompanionsTotal).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/credentials/NOPE/companions', headers: auth(auditToken) })).statusCode).toBe(404);
  });
});

describe('reportes, auditoría y backup', () => {
  it('gate-summary agrega por zona/dispositivo/motivo', async () => {
    const r = await app.inject({ method: 'GET', url: '/reports/gate-summary', headers: auth(auditToken) });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(4);
    expect(r.json().byZone.T.ALLOW).toBe(4);
    expect(r.json().byDevice[deviceId].ALLOW).toBe(4);
    expect(r.json().credentialsByRole.COMP).toBeGreaterThan(0);
  });

  it('la cadena de auditoría verifica y registra las acciones', async () => {
    const r = await app.inject({ method: 'GET', url: '/audit', headers: auth(auditToken) });
    expect(r.json().verification.ok).toBe(true);
    const actions = r.json().records.map((x: { action: string }) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['LOGIN', 'ENROLL_TOKEN_CREATED', 'DEVICE_ENROLLED', 'CREDENTIAL_REVOKED', 'CREDENTIAL_REISSUED']));
    // alterar un registro en la base rompe la cadena
    const original = (app.ctx.db.prepare('SELECT actor FROM audit_log WHERE seq = 2').get() as { actor: string }).actor;
    app.ctx.db.prepare("UPDATE audit_log SET actor = 'hacker' WHERE seq = 2").run();
    expect(app.ctx.audit.verify()).toMatchObject({ ok: false, brokenAt: 2 });
    app.ctx.db.prepare('UPDATE audit_log SET actor = ? WHERE seq = 2').run(original);
    expect(app.ctx.audit.verify().ok).toBe(true);
  });

  it('backup VACUUM INTO crea un archivo', async () => {
    const r = await app.inject({ method: 'POST', url: '/backup/snapshot', headers: auth(adminToken) });
    expect(r.statusCode).toBe(200);
    expect(readdirSync(join(tmp, 'backups')).some((f) => f.endsWith('.db'))).toBe(true);
  });
});
