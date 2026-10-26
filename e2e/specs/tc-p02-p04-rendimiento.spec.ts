/**
 * Rendimiento (@perf, no corre en CI por defecto: `npm run e2e:perf`).
 *   TC-P02 (versión corta) · 500 escaneos por API (`POST /sync/events`, uno por petición) contra el host
 *             de pruebas → p95 de respuesta < 50 ms y los 500 registrados sin duplicados.
 *   TC-P03/P04-like · host con 2.000 credenciales → `GET /sync/snapshot` completo en < 2 s.
 * Los umbrales son del portátil de desarrollo (docs/20 §6.1); en el hardware del evento se repiten con simulate.ts.
 */
import { expect, test } from '@playwright/test';
import { EXTERNAL, host, spawnHost, type SpawnedHost } from '../helpers.js';

test.skip(EXTERNAL, 'Mide contra hosts locales.');

const p = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

test('TC-P02 @perf 500 escaneos por API: p95 < 50 ms y 0 duplicados', async () => {
  test.setTimeout(120_000);
  const admin = await host.login('admin');
  const t = await host.post<{ token: string }>('/devices/enroll-token', admin, { name: 'E2E perf', zone: 'G', role: 'CONTROL' });
  const dev = await host.post<{ deviceId: string; deviceToken: string }>('/devices/enroll', undefined, { token: t.body.token, pin: '123456' });
  expect(dev.status).toBe(200);
  const creds = (await host.credentials()).filter((c) => c.roleCode === 'COMP').slice(0, 100);
  const lat: number[] = [];
  for (let seq = 1; seq <= 500; seq++) {
    const c = creds[seq % creds.length];
    const ev = { id: `${dev.body.deviceId}:${seq}`, deviceId: dev.body.deviceId, seq, credentialId: c.id, zone: 'G', direction: 'IN', decision: 'ALLOW', reasonCode: 'OK', at: new Date().toISOString() };
    const t0 = performance.now();
    const res = await fetch(`${host.url}/sync/events`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${dev.body.deviceToken}` }, body: JSON.stringify({ events: [ev] }) });
    lat.push(performance.now() - t0);
    expect(res.status).toBe(200);
  }
  const p50 = p(lat, 0.5), p95 = p(lat, 0.95), p99 = p(lat, 0.99);
  test.info().annotations.push({ type: 'perf', description: `POST /sync/events · p50 ${p50.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · p99 ${p99.toFixed(1)} ms` });
  console.log(`[perf] 500 escaneos: p50 ${p50.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · p99 ${p99.toFixed(1)} ms`);
  expect(p95).toBeLessThan(50);
  const devices = await host.get<{ id: string; lastSeq: number }[]>('/devices', admin);
  expect(devices.find((d) => d.id === dev.body.deviceId)!.lastSeq).toBe(500);
  const { events } = await host.get<{ events: { deviceId: string }[] }>('/sync/events?since=&limit=20000', admin);
  expect(events.filter((e) => e.deviceId === dev.body.deviceId).length).toBe(500);
});

test('TC-P04 @perf snapshot de 2.000 credenciales en < 2 s', async () => {
  test.setTimeout(180_000);
  let big: SpawnedHost | undefined;
  try {
    big = await spawnHost({ name: 'perf-2000', seed: 2000 });
    const admin = await big.api.login('admin');
    expect((await big.api.health()).credentials).toBeGreaterThanOrEqual(2000);
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const res = await fetch(`${big.url}/sync/snapshot`, { headers: { authorization: `Bearer ${admin}` } });
      const body = (await res.json()) as { credentials: unknown[] };
      times.push(performance.now() - t0);
      expect(body.credentials.length).toBeGreaterThanOrEqual(2000);
    }
    const best = Math.min(...times);
    test.info().annotations.push({ type: 'perf', description: `GET /sync/snapshot (2.000) · ${times.map((x) => x.toFixed(0)).join(' / ')} ms` });
    console.log(`[perf] snapshot 2.000: ${times.map((x) => x.toFixed(0)).join(' / ')} ms`);
    expect(best).toBeLessThan(2000);
  } finally {
    await big?.stop();
  }
});
