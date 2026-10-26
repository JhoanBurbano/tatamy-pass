/**
 * Cola de pendientes (TC-044): los escaneos se guardan localmente con seq
 * monotónico, se suben en lote idempotente cuando hay host y se marcan
 * `synced=1`; sin host siguen en IndexedDB (fake-indexeddb) sin perderse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig, formatCredentialId, generateKeyPair, signCredentialToken, type Credential } from '@tatami/core';
import { db, nextLocalSeq, pendingCount, pendingScans, replaceSnapshot, resetDevice, setSetting, type DeviceSettings } from '../src/db.js';
import { SyncClient } from '../src/sync.js';
import { processInput } from '../src/scan-engine.js';

const key = generateKeyPair('ktest');
const config = { ...createDefaultConfig(), signingKeys: [{ kid: key.kid, publicKeyHex: key.publicKeyHex }] };
const device: DeviceSettings = { hostUrl: 'http://host.test', deviceId: 'dev_t', deviceToken: 'tok', name: 'Puerta T1', zone: 'T', role: 'CONTROL', pinHash: 'x', enrolledAt: '' };

function cred(seq: number, roleCode = 'COMP', zones = ['G', 'W', 'T', 'P']): Credential {
  return {
    id: formatCredentialId(config.idPrefix, seq), seq, eventId: config.eventId, personId: `p${seq}`, displayName: `Persona ${seq}`, roleCode, zones,
    validFrom: config.startDate, validTo: config.endDate, version: 1, status: 'DELIVERED', kid: key.kid, issuedAt: '', updatedAt: ''
  };
}

/** El evento es en noviembre de 2026: se simula el reloj del host con el desfase. */
const EVENT_NOW = Date.parse('2026-11-20T14:00:00.000Z');

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let hostUp = true;

function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  calls.push({ url, init });
  if (!hostUp) return Promise.reject(new TypeError('Failed to fetch'));
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (url.endsWith('/sync/events') && init?.method === 'POST') {
    const { events } = JSON.parse(String(init.body)) as { events: unknown[] };
    return json({ accepted: events.length, duplicates: 0, receivedAt: new Date().toISOString() });
  }
  if (url.includes('/sync/events?')) return json({ events: [], cursor: null });
  if (url.endsWith('/sync/snapshot')) return json({ config, credentials: [cred(1), cred(2)], revocations: [], serverTime: new Date(EVENT_NOW).toISOString() });
  return Promise.resolve(new Response('{}', { status: 404 }));
}

beforeEach(async () => {
  await resetDevice();
  calls = []; hostUp = true;
  vi.stubGlobal('fetch', fakeFetch);
  await setSetting('device', device);
  await replaceSnapshot({ config, credentials: [cred(1), cred(2)], revocations: [], serverTime: new Date(EVENT_NOW).toISOString() });
  await setSetting('clockSkewMs', EVENT_NOW - Date.now());
});

afterEach(() => vi.unstubAllGlobals());

describe('cola de pendientes', () => {
  it('asigna seq monotónico por dispositivo y guarda como pendiente', async () => {
    expect(await nextLocalSeq(device.deviceId)).toBe(1);
    const token = signCredentialToken(cred(1), key);
    const o = await processInput(token, device, config);
    expect(o.result.decision).toBe('ALLOW');
    expect(o.elapsedMs).toBeLessThan(300);
    expect(await nextLocalSeq(device.deviceId)).toBe(2);
    expect(await pendingCount()).toBe(1);
    const [p] = await pendingScans();
    expect(p.id).toBe('dev_t:1');
    expect(p.synced).toBe(0);
  });

  it('anti-passback y salida se resuelven con el estado local (sin host)', async () => {
    hostUp = false;
    const token = signCredentialToken(cred(1), key);
    expect((await processInput(token, device, config)).result.reasonCode).toBe('OK_PHOTO_CHECK');
    expect((await processInput(token, device, config)).result.reasonCode).toBe('ANTI_PASSBACK');
    expect((await processInput(token, device, config, { direction: 'OUT' })).result.reasonCode).toBe('OK_EXIT');
    expect((await processInput(token, device, config)).result.decision).toBe('ALLOW');
    expect(await pendingCount()).toBe(4);
  });

  it('firma alterada → BAD_SIGNATURE; ID manual → se busca localmente', async () => {
    const token = signCredentialToken(cred(1), key);
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    expect((await processInput(tampered, device, config)).result.reasonCode).toBe('BAD_SIGNATURE');
    expect((await processInput('basura', device, config)).result.reasonCode).toBe('MALFORMED');
    const manual = await processInput(cred(2).id, device, config);
    expect(manual.credential?.seq).toBe(2);
  });

  it('ingreso manual con motivo queda registrado como OK_MANUAL con el motivo', async () => {
    const o = await processInput(cred(2).id, device, config, { override: { reason: 'credencial dañada, documento verificado', by: device.name } });
    expect(o.result.reasonCode).toBe('OK_MANUAL');
    const [p] = await pendingScans();
    expect(p.manual).toEqual({ reason: 'credencial dañada, documento verificado', by: device.name });
  });

  it('sin host los pendientes se conservan; al volver se suben en lote y quedan synced', async () => {
    const client = new SyncClient();
    const token = signCredentialToken(cred(1), key);
    await processInput(token, device, config);
    await processInput(token, device, config, { direction: 'OUT' });

    hostUp = false;
    await client.tick(true);
    expect(client.status.state).toBe('offline');
    expect(client.status.pending).toBe(2);
    expect(client.status.lastError).toBeTruthy();
    expect(await pendingCount()).toBe(2);

    hostUp = true;
    await client.tick(true);
    expect(client.status.state).toBe('online');
    expect(client.status.pending).toBe(0);
    const push = calls.find((c) => c.url.endsWith('/sync/events') && c.init?.method === 'POST');
    expect(push).toBeTruthy();
    const body = JSON.parse(String(push!.init!.body)) as { events: { seq: number; synced?: number }[] };
    expect(body.events.map((e) => e.seq)).toEqual([1, 2]);
    expect(body.events.every((e) => e.synced === undefined)).toBe(true);
    expect(push!.init!.headers).toMatchObject({ authorization: 'Bearer tok' });
    expect((await db.scans.toArray()).every((s) => s.synced === 1)).toBe(true);
    // Tras reconectar se refresca el snapshot (para traer revocaciones nuevas).
    expect(calls.filter((c) => c.url.endsWith('/sync/snapshot')).length).toBeGreaterThanOrEqual(1);
  });

  it('respeta el backoff tras un fallo y lo ignora con force', async () => {
    const client = new SyncClient();
    hostUp = false;
    await client.tick();
    const n = calls.length;
    await client.tick();
    expect(calls.length).toBe(n); // en backoff: no llama
    await client.tick(true);
    expect(calls.length).toBeGreaterThan(n);
  });

  it('sube en lotes de 200', async () => {
    const client = new SyncClient();
    const rows = Array.from({ length: 450 }, (_, i) => ({
      id: `dev_t:${i + 1}`, deviceId: device.deviceId, seq: i + 1, credentialId: null, zone: 'T', direction: 'IN' as const, decision: 'DENY' as const,
      reasonCode: 'MALFORMED' as const, at: new Date(EVENT_NOW + i).toISOString(), synced: 0 as const
    }));
    await db.scans.bulkPut(rows);
    await client.pushPending(device);
    const pushes = calls.filter((c) => c.url.endsWith('/sync/events') && c.init?.method === 'POST');
    expect(pushes.length).toBe(3);
    expect(await pendingCount()).toBe(0);
  });
});
