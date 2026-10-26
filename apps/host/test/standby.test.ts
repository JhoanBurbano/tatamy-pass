/**
 * Host standby: dos hosts en memoria. El standby replica snapshot + cambios
 * incrementales del primario (100 escaneos, una revocación, config, usuarios,
 * dispositivos), se promueve y acepta eventos nuevos.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultConfig, generateKeyPair, type ScanEvent } from '@tatami/core';
import { buildApp } from '../src/server.js';
import { seedCredentials } from '../src/seed-data.js';

const key = generateKeyPair('kshared');
let primary: Awaited<ReturnType<typeof buildApp>>;
let standby: Awaited<ReturnType<typeof buildApp>>;
let adminToken = '';
let deviceToken = '';
let deviceId = '';
const REPLICA_KEY = 'clave-replica';

beforeAll(async () => {
  primary = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, configPath: null, replicaKey: REPLICA_KEY, mode: 'primary' });
  primary.ctx.users.create('admin', 'admin123', 'ADMIN');
  seedCredentials(primary.ctx, 40);
  adminToken = (await primary.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
  const t = (await primary.inject({ method: 'POST', url: '/devices/enroll-token', headers: { authorization: `Bearer ${adminToken}` }, payload: { name: 'Puerta T1', zone: 'T' } })).json();
  const e = (await primary.inject({ method: 'POST', url: '/devices/enroll', payload: { token: t.token, pin: '123456' } })).json();
  deviceToken = e.deviceToken; deviceId = e.deviceId;

  // el standby habla con el primario por inject (sin red)
  standby = await buildApp({
    dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, configPath: null, mode: 'standby', primaryUrl: 'http://primario.local:8787',
    replicaFetch: async (path) => {
      const r = await primary.inject({ method: 'GET', url: path, headers: { 'x-tatami-replica-key': REPLICA_KEY } });
      if (r.statusCode !== 200) throw new Error(`el principal respondió ${r.statusCode}`);
      return r.json();
    }
  });
});

afterAll(async () => { await primary.close(); await standby.close(); });

const ev = (seq: number, credentialId: string, at: string): ScanEvent => ({
  id: `${deviceId}:${seq}`, deviceId, seq, credentialId, zone: 'T', direction: 'IN', decision: 'ALLOW', reasonCode: 'OK', at
});

describe('replicación', () => {
  it('los endpoints de replicación exigen la clave compartida', async () => {
    expect((await primary.inject({ method: 'GET', url: '/replication/snapshot' })).statusCode).toBe(401);
    expect((await primary.inject({ method: 'GET', url: '/replication/snapshot', headers: { 'x-tatami-replica-key': 'mala' } })).statusCode).toBe(401);
    expect((await primary.inject({ method: 'GET', url: '/replication/snapshot', headers: { authorization: `Bearer ${adminToken}` } })).statusCode).toBe(200);
  });

  it('snapshot inicial: credenciales, personas (recifradas), usuarios, dispositivos y auditoría', async () => {
    const counts = await standby.ctx.replica.syncOnce();
    expect(counts.credentials).toBe(40);
    expect(standby.ctx.credentials.count()).toBe(40);
    expect(standby.ctx.persons.count()).toBe(primary.ctx.persons.count());
    // PII recifrada con la clave del standby pero legible
    const p = primary.ctx.persons.all()[0];
    const q = standby.ctx.persons.byId(p.id)!;
    expect(q.documentNumber).toBe(p.documentNumber);
    expect(q.birthDate).toBe(p.birthDate);
    expect(standby.ctx.persons.byDocument(p.documentNumber!)[0].id).toBe(p.id);
    // el usuario y el dispositivo del primario sirven en el standby
    expect((await standby.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } })).statusCode).toBe(200);
    expect((await standby.inject({ method: 'GET', url: '/sync/snapshot', headers: { authorization: `Bearer ${deviceToken}` } })).statusCode).toBe(200);
    expect(standby.ctx.audit.verify()).toEqual(primary.ctx.audit.verify());
    const h = (await standby.inject({ method: 'GET', url: '/health' })).json();
    expect(h.mode).toBe('standby');
    expect(h.lagSeconds).toBeGreaterThanOrEqual(0);
    expect(h.standby.message).toMatch(/Replicando del principal/);
  });

  it('en standby no se aceptan escrituras (409) pero sí lecturas', async () => {
    const sToken = (await standby.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
    const c = standby.ctx.credentials.all()[0];
    const r = await standby.inject({ method: 'POST', url: `/credentials/${c.id}/revoke`, headers: { authorization: `Bearer ${sToken}` }, payload: { reason: 'x' } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/equipo es el de respaldo/);
    expect((await standby.inject({ method: 'GET', url: '/live', headers: { authorization: `Bearer ${sToken}` } })).statusCode).toBe(200);
  });

  it('incremental: 100 escaneos, una revocación, un cambio de config, un usuario nuevo y un cambio de zona', async () => {
    const creds = primary.ctx.credentials.all();
    const base = Date.now() - 200_000;
    const events = Array.from({ length: 100 }, (_, i) => ev(i + 1, creds[i % creds.length].id, new Date(base + i * 1000).toISOString()));
    const up = await primary.inject({ method: 'POST', url: '/sync/events', headers: { authorization: `Bearer ${deviceToken}` }, payload: { events } });
    expect(up.json().accepted).toBe(100);
    await primary.inject({ method: 'POST', url: `/credentials/${creds[5].id}/revoke`, headers: { authorization: `Bearer ${adminToken}` }, payload: { reason: 'perdida' } });
    const cfg = (await primary.inject({ method: 'GET', url: '/config', headers: { authorization: `Bearer ${adminToken}` } })).json().config;
    await primary.inject({ method: 'PUT', url: '/config', headers: { authorization: `Bearer ${adminToken}` }, payload: { config: { ...cfg, name: 'Nacional 2026 (editado)' } } });
    await primary.inject({ method: 'POST', url: '/users', headers: { authorization: `Bearer ${adminToken}` }, payload: { username: 'coord2', password: 'coord2-2026', role: 'COORDINATOR' } });
    await primary.inject({ method: 'PATCH', url: `/devices/${deviceId}`, headers: { authorization: `Bearer ${adminToken}` }, payload: { zone: 'W' } });

    const counts = await standby.ctx.replica.syncOnce();
    expect(counts.scans).toBe(100);
    expect(standby.ctx.scans.count()).toBe(100);
    expect(standby.ctx.credentials.byId(creds[5].id)!.status).toBe('REVOKED');
    expect(standby.ctx.credentials.revocations().length).toBe(1);
    expect(standby.ctx.config.name).toBe('Nacional 2026 (editado)');
    expect(standby.ctx.config.configVersion).toBe(primary.ctx.config.configVersion);
    expect(standby.ctx.config.signingKeys[0].kid).toBe('kshared');
    expect(standby.ctx.users.findByUsername('coord2')).toBeTruthy();
    expect(standby.ctx.devices.byId(deviceId)!.zone).toBe('W');
    expect(standby.ctx.audit.last()!.seq).toBe(primary.ctx.audit.last()!.seq);
    expect(standby.ctx.audit.verify().ok).toBe(true);
    // un segundo ciclo sin cambios no duplica nada
    const again = await standby.ctx.replica.syncOnce();
    expect(again.scans).toBe(0);
    expect(standby.ctx.scans.count()).toBe(100);
    // la lista de revocación que verían los scanners desde el standby coincide
    const snap = (await standby.inject({ method: 'GET', url: '/sync/snapshot', headers: { authorization: `Bearer ${deviceToken}` } })).json();
    expect(snap.revocations[0].credentialId).toBe(creds[5].id);
  });

  it('si el primario cae, el standby lo reporta y sigue sirviendo', async () => {
    const broken = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, configPath: null, mode: 'standby', primaryUrl: 'http://x', replicaFetch: async () => { throw new Error('ECONNREFUSED'); } });
    await expect(broken.ctx.replica.syncOnce()).rejects.toThrow();
    const h = (await broken.inject({ method: 'GET', url: '/health' })).json();
    expect(h.standby.online).toBe(false);
    expect(h.standby.message).toMatch(/Sin conexión con el principal/);
    await broken.close();
  });

  it('promoción: pasa a primario, continúa la cadena de auditoría y acepta eventos nuevos', async () => {
    const sToken = (await standby.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token;
    const noConfirm = await standby.inject({ method: 'POST', url: '/system/promote', headers: { authorization: `Bearer ${sToken}` }, payload: {} });
    expect(noConfirm.statusCode).toBe(400);
    const r = await standby.inject({ method: 'POST', url: '/system/promote', headers: { authorization: `Bearer ${sToken}` }, payload: { confirm: 'PROMOVER' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().mode).toBe('primary');
    expect(standby.ctx.mode).toBe('primary');
    expect(standby.ctx.meta.get('hostMode')).toBe('primary');
    expect(standby.ctx.audit.last()!.action).toBe('PROMOTED');
    expect(standby.ctx.audit.verify().ok).toBe(true);
    expect((await standby.inject({ method: 'GET', url: '/health' })).json().mode).toBe('primary');

    // el scanner se apunta al nuevo host con su mismo token y sube eventos nuevos
    const creds = standby.ctx.credentials.all();
    const more = [ev(101, creds[7].id, new Date().toISOString()), ev(102, creds[8].id, new Date().toISOString())];
    const up = await standby.inject({ method: 'POST', url: '/sync/events', headers: { authorization: `Bearer ${deviceToken}` }, payload: { events: more } });
    expect(up.statusCode).toBe(200);
    expect(up.json().accepted).toBe(2);
    expect(standby.ctx.scans.count()).toBe(102);
    // y las escrituras del panel ya funcionan
    const rev = await standby.inject({ method: 'POST', url: `/credentials/${creds[9].id}/revoke`, headers: { authorization: `Bearer ${sToken}` }, payload: { reason: 'x' } });
    expect(rev.statusCode).toBe(200);
    // ya no replica
    await expect(standby.ctx.replica.syncOnce()).rejects.toThrow(/ya es el principal/);
    // promover de nuevo es idempotente
    expect((await standby.inject({ method: 'POST', url: '/system/promote', headers: { authorization: `Bearer ${sToken}` }, payload: { confirm: 'PROMOVER' } })).json().message).toMatch(/ya es el principal/);
  });
});
