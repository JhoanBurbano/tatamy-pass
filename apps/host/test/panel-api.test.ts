import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultConfig, generateKeyPair, type ScanEvent } from '@tatami/core';
import { buildApp } from '../src/server.js';
import { seedCredentials } from '../src/seed-data.js';
import { dayRange, localDate } from '../src/reports.js';
import { purgePii } from '../src/purge.js';

const key = generateKeyPair('ktest');
const tmp = mkdtempSync(join(tmpdir(), 'tatami-panel-'));
let app: Awaited<ReturnType<typeof buildApp>>;
const tokens: Record<string, string> = {};
let deviceToken = '';
let deviceId = '';
const auth = (u: string) => ({ authorization: `Bearer ${tokens[u]}` });
const devAuth = () => ({ authorization: `Bearer ${deviceToken}` });

beforeAll(async () => {
  app = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, backupsDir: join(tmp, 'backups'), configPath: null });
  for (const [u, r] of [['admin', 'ADMIN'], ['coord', 'COORDINATOR'], ['print', 'PRINTER'], ['super', 'SUPERVISOR'], ['audit', 'AUDITOR']] as const) {
    app.ctx.users.create(u, `${u}123`, r);
    tokens[u] = (await app.inject({ method: 'POST', url: '/auth/login', payload: { username: u, password: `${u}123` } })).json().token;
  }
  seedCredentials(app.ctx, 60);
  const t = (await app.inject({ method: 'POST', url: '/devices/enroll-token', headers: auth('admin'), payload: { name: 'Tatamis', zone: 'T' } })).json();
  expect(JSON.parse(t.qr)).toMatchObject({ token: t.token });
  const e = (await app.inject({ method: 'POST', url: '/devices/enroll', payload: { token: t.token, pin: '123456' } })).json();
  deviceToken = e.deviceToken; deviceId = e.deviceId;
});

afterAll(async () => { await app.close(); rmSync(tmp, { recursive: true, force: true }); });

const ev = (seq: number, credentialId: string | null, extra: Partial<ScanEvent> = {}): ScanEvent => ({
  id: `${deviceId}:${seq}`, deviceId, seq, credentialId, zone: 'T', direction: 'IN', decision: 'ALLOW', reasonCode: 'OK', at: new Date(Date.now() - (100 - seq) * 1000).toISOString(), ...extra
});

describe('usuarios', () => {
  it('admin crea, desactiva y resetea; los demás no', async () => {
    expect((await app.inject({ method: 'GET', url: '/users', headers: auth('coord') })).statusCode).toBe(403);
    const bad = await app.inject({ method: 'POST', url: '/users', headers: auth('admin'), payload: { username: 'x', password: 'corta', role: 'PRINTER' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/users', headers: auth('admin'), payload: { username: 'print2', password: 'print2-2026', role: 'PRINTER' } });
    expect(ok.statusCode).toBe(200);
    const id = ok.json().id;
    expect((await app.inject({ method: 'POST', url: '/users', headers: auth('admin'), payload: { username: 'print2', password: 'print2-2026', role: 'PRINTER' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'print2', password: 'print2-2026' } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: `/users/${id}/disable`, headers: auth('admin'), payload: { disabled: true } });
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'print2', password: 'print2-2026' } })).statusCode).toBe(401);
    await app.inject({ method: 'POST', url: `/users/${id}/disable`, headers: auth('admin'), payload: { disabled: false } });
    await app.inject({ method: 'POST', url: `/users/${id}/reset-password`, headers: auth('admin'), payload: { password: 'nueva-clave-1' } });
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'print2', password: 'nueva-clave-1' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/users', headers: auth('admin') })).json().length).toBe(6);
    const me = (await app.inject({ method: 'POST', url: `/users/${app.ctx.users.findByUsername('admin')!.id}/disable`, headers: auth('admin'), payload: {} }));
    expect(me.statusCode).toBe(400);
  });
});

describe('credenciales', () => {
  it('busca por nombre, ID y club; detalle con persona según rol', async () => {
    const first = app.ctx.credentials.all()[0];
    const byId = (await app.inject({ method: 'GET', url: `/credentials?q=${encodeURIComponent(first.id)}`, headers: auth('super') })).json();
    expect(byId.total).toBe(1);
    expect(byId.items[0].token).toBeUndefined();
    const byName = (await app.inject({ method: 'GET', url: `/credentials?q=${encodeURIComponent(first.displayName.split(' ')[0])}`, headers: auth('admin') })).json();
    expect(byName.total).toBeGreaterThanOrEqual(1);
    const comp = (await app.inject({ method: 'GET', url: '/credentials?roleCode=COMP&limit=5', headers: auth('admin') })).json();
    expect(comp.items.length).toBe(5);
    expect(comp.items.every((c: { roleCode: string }) => c.roleCode === 'COMP')).toBe(true);
    const clubs = (await app.inject({ method: 'GET', url: '/credentials/clubs', headers: auth('print') })).json();
    expect(clubs.length).toBeGreaterThan(0);
    const detailAdmin = (await app.inject({ method: 'GET', url: `/credentials/${first.id}`, headers: auth('admin') })).json();
    expect(detailAdmin.person.documentNumber).toBeTruthy();
    expect(detailAdmin.token).toBeTruthy();
    const detailAudit = (await app.inject({ method: 'GET', url: `/credentials/${first.id}`, headers: auth('audit') })).json();
    expect(detailAudit.person.documentNumber).toBeUndefined();
    expect(detailAudit.token).toBeUndefined();
    expect(Array.isArray(detailAudit.scans)).toBe(true);
  });

  it('entregar, PDF individual y lote', async () => {
    const c = app.ctx.credentials.all().find((x) => x.roleCode === 'COMP')!;
    app.ctx.credentials.setStatus(c.id, 'ISSUED');
    const d = await app.inject({ method: 'POST', url: `/credentials/${c.id}/deliver`, headers: auth('print') });
    expect(d.json().credential.status).toBe('DELIVERED');
    expect((await app.inject({ method: 'POST', url: `/credentials/${c.id}/deliver`, headers: auth('audit') })).statusCode).toBe(403);
    const pdf = await app.inject({ method: 'GET', url: `/credentials/${c.id}/pdf`, headers: auth('print') });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('impresión por lotes', () => {
  it('crea lote por rol, genera PDF y marca impreso', async () => {
    for (const c of app.ctx.credentials.all().filter((x) => x.roleCode === 'COACH')) app.ctx.credentials.setStatus(c.id, 'ISSUED');
    const empty = await app.inject({ method: 'POST', url: '/print/batches', headers: auth('print'), payload: { roleCode: 'COACH', status: 'PRINTED' } });
    expect(empty.statusCode).toBe(400);
    const b = (await app.inject({ method: 'POST', url: '/print/batches', headers: auth('print'), payload: { roleCode: 'COACH' } })).json();
    expect(b.count).toBeGreaterThan(0);
    const pdf = await app.inject({ method: 'GET', url: `/print/batches/${b.id}/pdf`, headers: auth('print') });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.length).toBeGreaterThan(1000);
    const printed = (await app.inject({ method: 'POST', url: `/print/batches/${b.id}/printed`, headers: auth('print') })).json();
    expect(printed.status).toBe('PRINTED');
    expect(printed.credentialsUpdated).toBe(b.count);
    expect(app.ctx.credentials.byId(b.credentialIds[0])!.status).toBe('PRINTED');
    const list = (await app.inject({ method: 'GET', url: '/print/batches', headers: auth('audit') })).json();
    expect(list[0].id).toBe(b.id);
  });
});

describe('dispositivos y alertas', () => {
  it('cambiar zona, desactivar y el scanner desactivado no entra', async () => {
    const z = await app.inject({ method: 'PATCH', url: `/devices/${deviceId}`, headers: auth('super'), payload: { zone: 'W' } });
    expect(z.json().zone).toBe('W');
    await app.inject({ method: 'PATCH', url: `/devices/${deviceId}`, headers: auth('super'), payload: { zone: 'T' } });
    expect((await app.inject({ method: 'PATCH', url: `/devices/${deviceId}`, headers: auth('super'), payload: { zone: 'ZZ' } })).statusCode).toBe(400);
    await app.inject({ method: 'POST', url: `/devices/${deviceId}/disable`, headers: auth('admin'), payload: { disabled: true } });
    const r = await app.inject({ method: 'GET', url: '/sync/snapshot', headers: devAuth() });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toMatch(/desactivado/);
    await app.inject({ method: 'POST', url: `/devices/${deviceId}/disable`, headers: auth('admin'), payload: { disabled: false } });
    expect((await app.inject({ method: 'GET', url: '/sync/snapshot', headers: devAuth() })).statusCode).toBe(200);
  });

  it('eventos ALERT y manuales generan alertas; se resuelven con nota; pendientes reportados', async () => {
    const creds = app.ctx.credentials.all();
    const events = [
      ev(1, creds[0].id), ev(2, creds[1].id), ev(3, creds[0].id, { direction: 'OUT', reasonCode: 'OK_EXIT' }),
      ev(4, creds[2].id, { decision: 'ALERT', reasonCode: 'DUPLICATE' }),
      ev(5, creds[3].id, { reasonCode: 'OK_MANUAL', manual: { reason: 'QR dañado', by: 'super' } }),
      ev(6, creds[4].id, { decision: 'DENY', reasonCode: 'ANTI_PASSBACK' })
    ];
    const r = await app.inject({ method: 'POST', url: '/sync/events', headers: { ...devAuth(), 'x-tatami-pending': '12' }, payload: { events, pending: 12 } });
    expect(r.json().accepted).toBe(6);
    const dev = (await app.inject({ method: 'GET', url: '/devices', headers: auth('super') })).json()[0];
    expect(dev.pendingCount).toBe(12);
    expect(dev.lastSeenAt).toBeTruthy();
    const alerts = (await app.inject({ method: 'GET', url: '/alerts?status=OPEN', headers: auth('super') })).json();
    expect(alerts.open).toBe(2);
    const dup = alerts.items.find((a: { kind: string }) => a.kind === 'DUPLICATE');
    expect(dup.credential.id).toBe(creds[2].id);
    expect((await app.inject({ method: 'POST', url: `/alerts/${dup.id}/resolve`, headers: auth('super'), payload: {} })).statusCode).toBe(400);
    const res = (await app.inject({ method: 'POST', url: `/alerts/${dup.id}/resolve`, headers: auth('super'), payload: { note: 'Era la misma persona, foto coincide.' } })).json();
    expect(res.status).toBe('RESOLVED');
    expect((await app.inject({ method: 'GET', url: '/alerts?status=OPEN', headers: auth('audit') })).json().open).toBe(1);
    expect((await app.inject({ method: 'POST', url: `/alerts/${dup.id}/resolve`, headers: auth('audit'), payload: { note: 'x' } })).statusCode).toBe(403);
  });

  it('dispositivo sin conexión > 5 min abre alerta OFFLINE y se cierra sola al volver', async () => {
    app.ctx.db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(new Date(Date.now() - 6 * 60_000).toISOString(), deviceId);
    const live = (await app.inject({ method: 'GET', url: '/live', headers: auth('super') })).json();
    expect(live.gates[0].status).toBe('off');
    expect(live.gates[0].statusText).toMatch(/Sin conexión hace 6 min/);
    const alerts = (await app.inject({ method: 'GET', url: '/alerts?status=OPEN', headers: auth('super') })).json();
    expect(alerts.items.some((a: { kind: string }) => a.kind === 'OFFLINE')).toBe(true);
    await app.inject({ method: 'GET', url: '/sync/snapshot', headers: devAuth() }); // vuelve
    const after = (await app.inject({ method: 'GET', url: '/alerts?status=OPEN', headers: auth('super') })).json();
    expect(after.items.some((a: { kind: string }) => a.kind === 'OFFLINE')).toBe(false);
  });
});

describe('puertas en vivo y cierre del día', () => {
  it('KPIs, dentro ahora por zona y reporte CSV', async () => {
    const live = (await app.inject({ method: 'GET', url: '/live', headers: auth('coord') })).json();
    expect(live.kpis.entriesToday).toBe(3); // seq 1, 2, 5 (manual también entra)
    expect(live.insideByZone.find((z: { code: string }) => z.code === 'T').inside).toBe(2); // 3 entradas − 1 salida
    expect(live.gates[0].today).toBe(3);
    expect(live.gates[0].denied).toBe(1);
    expect(live.kpis.accredited).toBe(60);
    const rep = (await app.inject({ method: 'GET', url: '/reports/day-close', headers: auth('audit') })).json();
    expect(rep.totals).toMatchObject({ scans: 6, entries: 3, exits: 1, denied: 1, alerts: 1, manual: 1 });
    expect(rep.manualEntries[0].reason).toBe('QR dañado');
    expect(rep.insideAtClose.find((z: { code: string }) => z.code === 'T').inside).toBe(2);
    expect(rep.byRole.find((r: { roleCode: string }) => r.roleCode === 'COMP').accredited).toBeGreaterThan(0);
    const csv = await app.inject({ method: 'GET', url: '/reports/day-close?format=csv', headers: auth('audit') });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('ingreso_manual');
    expect(csv.body).toContain('QR dañado');
    // otro día: vacío
    const other = (await app.inject({ method: 'GET', url: '/reports/day-close?date=2001-01-01', headers: auth('audit') })).json();
    expect(other.totals.scans).toBe(0);
  });

  it('helpers de zona horaria', () => {
    expect(localDate('2026-11-21T03:30:00.000Z', -300)).toBe('2026-11-20');
    expect(dayRange('2026-11-20', -300)).toEqual({ from: '2026-11-20T05:00:00.000Z', to: '2026-11-21T05:00:00.000Z' });
  });
});

describe('config del evento', () => {
  it('valida, versiona y rechaza versiones viejas; solo admin', async () => {
    const cur = (await app.inject({ method: 'GET', url: '/config', headers: auth('print') })).json().config;
    expect((await app.inject({ method: 'PUT', url: '/config', headers: auth('coord'), payload: { config: cur } })).statusCode).toBe(403);
    const bad = { ...cur, roles: [...cur.roles, { ...cur.roles[0], code: 'GEN' }] };
    const r1 = await app.inject({ method: 'PUT', url: '/config', headers: auth('admin'), payload: { config: bad } });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().errors[0].message).toMatch(/repetido/);
    const next = { ...cur, roles: cur.roles.map((r: { code: string; capacity: number | null }) => (r.code === 'GEN' ? { ...r, capacity: 1 } : r)), totalCapacity: null };
    const r2 = await app.inject({ method: 'PUT', url: '/config', headers: auth('admin'), payload: { config: next, expectedVersion: cur.configVersion } });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().config.configVersion).toBe(cur.configVersion + 1);
    expect(r2.json().warnings[0]).toMatch(/Bajar el cupo a 1/);
    expect(app.ctx.config.totalCapacity).toBeNull();
    // el snapshot de los scanners ya trae la nueva versión y conserva la clave pública
    const snap = (await app.inject({ method: 'GET', url: '/sync/snapshot', headers: devAuth() })).json();
    expect(snap.config.configVersion).toBe(cur.configVersion + 1);
    expect(snap.config.signingKeys[0].kid).toBe('ktest');
    const stale = await app.inject({ method: 'PUT', url: '/config', headers: auth('admin'), payload: { config: next, expectedVersion: cur.configVersion } });
    expect(stale.statusCode).toBe(409);
  });
});

describe('auditoría', () => {
  it('paginada, verificación y exportación con hash', async () => {
    const page = (await app.inject({ method: 'GET', url: '/audit?limit=5', headers: auth('audit') })).json();
    expect(page.records.length).toBe(5);
    expect(page.total).toBeGreaterThan(5);
    expect(page.verification.ok).toBe(true);
    const v = (await app.inject({ method: 'GET', url: '/audit/verify', headers: auth('coord') })).json();
    expect(v.message).toMatch(/Registro íntegro hasta el número/);
    const csv = await app.inject({ method: 'GET', url: '/audit/export?format=csv', headers: auth('audit') });
    expect(csv.headers['x-content-sha256']).toHaveLength(64);
    expect(csv.body.split('\n')[0]).toBe('seq,at,actor,action,payload,prevHash,hash');
    const json = (await app.inject({ method: 'GET', url: '/audit/export', headers: auth('admin') })).json();
    expect(json.verification.ok).toBe(true);
    expect(json.records.length).toBe(json.records[json.records.length - 1].seq);
    expect((await app.inject({ method: 'GET', url: '/audit', headers: auth('print') })).statusCode).toBe(403);
  });
});

describe('salud, backups y purga', () => {
  it('salud con disco, backups y nube; snapshot y restauración', async () => {
    const h = (await app.inject({ method: 'GET', url: '/system/health', headers: auth('super') })).json();
    expect(h.mode).toBe('primary');
    expect(h.disk.freeBytes).toBeGreaterThan(0);
    expect(h.purge.retentionDays).toBe(90);
    expect(h.purge.due).toBe(false);
    const snap = (await app.inject({ method: 'POST', url: '/backup/snapshot', headers: auth('admin') })).json();
    expect(snap.name).toMatch(/^tatami-.*\.db$/);
    const before = app.ctx.credentials.count();
    app.ctx.db.prepare('DELETE FROM credentials').run();
    expect(app.ctx.credentials.count()).toBe(0);
    const noConfirm = await app.inject({ method: 'POST', url: '/backup/restore', headers: auth('admin'), payload: { name: snap.name } });
    expect(noConfirm.statusCode).toBe(400);
    const r = (await app.inject({ method: 'POST', url: '/backup/restore', headers: auth('admin'), payload: { name: snap.name, confirm: 'RESTAURAR' } })).json();
    expect(r.tables).toBeGreaterThan(5);
    expect(app.ctx.credentials.count()).toBe(before);
    const list = (await app.inject({ method: 'GET', url: '/backup/list', headers: auth('audit') })).json();
    expect(list.snapshots.length).toBe(2); // el snapshot + la copia de seguridad previa a restaurar
    expect(app.ctx.audit.verify().ok).toBe(true);
  });

  it('purga: no toca nada antes de los 90 días; con --force borra PII y conserva agregados', async () => {
    const dry = purgePii(app.ctx, { dryRun: true });
    expect(dry.due).toBe(false);
    expect(dry.persons).toBe(0);
    expect(dry.message).toMatch(/Todavía no/);
    const after = Date.parse('2026-11-22T23:59:59Z') + 91 * 86_400_000;
    const dryDue = purgePii(app.ctx, { dryRun: true, now: after });
    expect(dryDue.due).toBe(true);
    expect(dryDue.persons).toBe(app.ctx.persons.count());
    expect(app.ctx.persons.all()[0].firstName).not.toBe('Persona');
    const notYet = purgePii(app.ctx, { now: after - 2 * 86_400_000 });
    expect(notYet.due).toBe(false);
    const sample = app.ctx.credentials.all()[0];
    const scansBefore = app.ctx.scans.count();
    const api = await app.inject({ method: 'POST', url: '/system/purge', headers: auth('admin'), payload: { dryRun: false, force: true } });
    expect(api.statusCode).toBe(400); // falta confirmar con el nombre del evento
    const real = purgePii(app.ctx, { force: true, by: 'admin' });
    expect(real.persons).toBe(dryDue.persons);
    expect(real.credentials).toBeGreaterThan(0);
    const p = app.ctx.persons.byId(sample.personId)!;
    expect(p.firstName).toBe('Persona');
    expect(p.documentNumber).toBeUndefined();
    expect(p.birthDate).toBe('');
    expect(p.purgedAt).toBeTruthy();
    expect(app.ctx.credentials.byId(sample.id)!.displayName).toBe('Credencial purgada');
    expect(app.ctx.credentials.byId(sample.id)!.roleCode).toBe(sample.roleCode);
    expect(app.ctx.scans.count()).toBe(scansBefore);
    expect(JSON.parse(app.ctx.meta.get('purge_summary')!).scans).toBe(scansBefore);
    expect(app.ctx.audit.last()!.action).toBe('PII_PURGED');
    expect(app.ctx.audit.verify().ok).toBe(true);
    expect(purgePii(app.ctx, { force: true }).message).toMatch(/No queda nada/);
  });
});
