/**
 * Eventos del dispositivo en la cola de sync: `zone_change`, `shift_start`,
 * `shift_end`, y los metadatos `manual_entry` / `exception` de los escaneos.
 * Viajan por `POST /sync/events` con la forma de ScanEvent (fake-indexeddb).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig, deviceEventMeta, deviceEventType, formatCredentialId, generateKeyPair, isDeviceEvent, type Credential, type ScanEvent } from '@tatami/core';
import { pendingScans, replaceSnapshot, resetDevice, setSetting, type DeviceSettings } from '../src/db.js';
import { recordDeviceEvent } from '../src/device-events.js';
import { processInput } from '../src/scan-engine.js';
import { SyncClient } from '../src/sync.js';

const key = generateKeyPair('kdev');
const config = { ...createDefaultConfig(), signingKeys: [{ kid: key.kid, publicKeyHex: key.publicKeyHex }] };
const device: DeviceSettings = { hostUrl: 'http://host.test', deviceId: 'dev_e', deviceToken: 'tok', name: 'P4-TATAMI', zone: 'T', mode: 'IN', role: 'CONTROL', pinHash: 'x', enrolledAt: '' };
const EVENT_NOW = Date.parse('2026-11-20T14:00:00.000Z');
function cred(seq: number): Credential {
  return { id: formatCredentialId(config.idPrefix, seq), seq, eventId: config.eventId, personId: `p${seq}`, displayName: `Persona ${seq}`, roleCode: 'COMP', zones: ['G', 'W', 'T', 'P'], validFrom: config.startDate, validTo: config.endDate, version: 1, status: 'DELIVERED', kid: key.kid, issuedAt: '', updatedAt: '' };
}

let uploaded: ScanEvent[] = [];
function fakeFetch(url: string, init?: RequestInit): Promise<Response> {
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  if (url.endsWith('/sync/events') && init?.method === 'POST') {
    const { events } = JSON.parse(String(init.body)) as { events: ScanEvent[] };
    // Misma validación que el host: deviceId, seq entero, zone, at.
    for (const e of events) if (typeof e.deviceId !== 'string' || !Number.isInteger(e.seq) || typeof e.zone !== 'string' || typeof e.at !== 'string') return Promise.resolve(new Response('{"error":"Evento inválido"}', { status: 400 }));
    uploaded.push(...events);
    return json({ accepted: events.length, duplicates: 0, receivedAt: new Date().toISOString() });
  }
  if (url.includes('/sync/events?')) return json({ events: [], cursor: null });
  if (url.endsWith('/sync/snapshot')) return json({ config, credentials: [cred(1)], revocations: [], serverTime: new Date(EVENT_NOW).toISOString() });
  return Promise.resolve(new Response('{}', { status: 404 }));
}

beforeEach(async () => {
  await resetDevice();
  uploaded = [];
  vi.stubGlobal('fetch', fakeFetch);
  await setSetting('device', device);
  await replaceSnapshot({ config, credentials: [cred(1)], revocations: [], serverTime: new Date(EVENT_NOW).toISOString() });
  await setSetting('clockSkewMs', EVENT_NOW - Date.now());
});
afterEach(() => vi.unstubAllGlobals());

describe('eventos de dispositivo en la cola', () => {
  it('zone_change / shift_start / shift_end se encolan con seq propio, decision EVENT y sin credencial', async () => {
    await recordDeviceEvent(device, { type: 'shift_start', by: 'Ana', gate: 'P4-TATAMI', zone: 'T', mode: 'IN' });
    await recordDeviceEvent(device, { type: 'zone_change', by: 'Ana', authorizedBy: 'super', from: 'T', to: 'W' });
    await recordDeviceEvent(device, { type: 'shift_end', by: 'Ana', gate: 'P4-TATAMI', zone: 'W', mode: 'IN', startedAt: new Date(EVENT_NOW).toISOString(), totals: { scans: 3, entries: 2, exits: 0, denied: 1, deniedByReason: { ANTI_PASSBACK: 1 }, alerts: 0, manual: 0, exceptions: 0, pending: 0 } });
    const q = await pendingScans();
    expect(q.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(q.every((e) => isDeviceEvent(e) && e.credentialId === null && e.synced === 0)).toBe(true);
    expect(q.map((e) => e.reasonCode)).toEqual(['SHIFT_START', 'ZONE_CHANGE', 'SHIFT_END']);
    expect(q[0].at).toBe(new Date(EVENT_NOW).toISOString().slice(0, 16) + q[0].at.slice(16)); // hora del host (skew aplicado)
    const zc = deviceEventMeta(q[1]);
    expect(zc).toMatchObject({ type: 'zone_change', from: 'T', to: 'W', by: 'Ana', authorizedBy: 'super' });
    expect(q[1].manual?.reason).toBe('Cambio de zona T → W autorizado por super');
    expect(deviceEventMeta(q[2])).toMatchObject({ type: 'shift_end', totals: { entries: 2, denied: 1 } });
  });

  it('manual_entry y exception quedan en `manual` del escaneo con tipo, catálogo y quién autorizó', async () => {
    const c = cred(1);
    const m = await processInput(c.id, device, config, { manual: { reason: 'QR no se lee', by: 'Ana', meta: { type: 'manual_entry', reasonCode: 'QR_UNREADABLE' } } });
    expect(m.result.decision).toBe('ALLOW');
    expect(deviceEventType(m.event)).toBe('manual_entry');
    expect(m.event.manual).toEqual({ type: 'manual_entry', reasonCode: 'QR_UNREADABLE', reason: 'QR no se lee', by: 'Ana' });

    const again = await processInput(c.id, device, config); // anti-passback en T
    expect(again.result.reasonCode).toBe('ANTI_PASSBACK');
    const ex = await processInput(c.id, device, config, { override: { reason: 'Error de puerta', by: 'Ana', meta: { type: 'exception', reasonCode: 'GATE_ERROR', authorizedBy: 'super', overrides: 'ANTI_PASSBACK' } } });
    expect(ex.result.reasonCode).toBe('OK_MANUAL');
    expect(ex.event.manual).toEqual({ type: 'exception', reasonCode: 'GATE_ERROR', authorizedBy: 'super', overrides: 'ANTI_PASSBACK', reason: 'Error de puerta', by: 'Ana' });
    expect(ex.result.messageBody).toContain('Error de puerta');
  });

  it('el host los acepta tal cual por POST /sync/events (sin cambios de API) y quedan synced', async () => {
    await recordDeviceEvent(device, { type: 'shift_start', by: 'Ana', gate: 'P4-TATAMI', zone: 'T', mode: 'BOTH' });
    await processInput(cred(1).id, device, config, { direction: 'IN', manual: { reason: 'Planilla (modo degradado)', by: 'Ana', meta: { type: 'manual_entry', reasonCode: 'SHEET' } } });
    const client = new SyncClient();
    await client.tick(true);
    expect(client.status.state).toBe('online');
    expect(client.status.pending).toBe(0);
    expect(uploaded.map((e) => [e.id, e.decision, e.reasonCode])).toEqual([['dev_e:1', 'EVENT', 'SHIFT_START'], ['dev_e:2', 'ALLOW', 'OK_PHOTO_CHECK']]);
    expect(uploaded[0].manual).toMatchObject({ type: 'shift_start', mode: 'BOTH', gate: 'P4-TATAMI' });
    expect((uploaded[0] as unknown as { synced?: number }).synced).toBeUndefined();
  });
});
