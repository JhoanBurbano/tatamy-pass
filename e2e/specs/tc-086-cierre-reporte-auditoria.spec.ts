/**
 * Cierre del evento: reporte por puerta/zona con los escaneos de las specs anteriores y
 * cadena de auditoría verificada (TC-086 parte automática: verify OK y detección de alteración
 * se cubre en packages/core; aquí se comprueba el endpoint del host).
 */
import { expect, test } from '@playwright/test';
import { enrollScanner, forceSync, host, scan } from '../helpers.js';

test('cierre: reporte por puerta y auditoría verificada', async ({ page }) => {
  // Asegura actividad propia aunque esta spec corra sola.
  await enrollScanner(page, { zone: 'P', name: 'E2E cierre' });
  const comp = await host.pick('COMP', 10);
  expect((await scan(page, comp.token)).decision).toBe('ALLOW');
  expect((await scan(page, comp.token)).reasonCode).toBe('ANTI_PASSBACK');
  expect((await scan(page, comp.token, { direction: 'OUT' })).reasonCode).toBe('OK_EXIT');
  expect((await forceSync(page)).pending).toBe(0);

  const admin = await host.login('admin');
  const report = await host.get<{
    total: number; byZone: Record<string, Record<string, number>>; byDevice: Record<string, Record<string, number>>; byReason: Record<string, number>;
    devices: { id: string; name: string; zone: string; lastSeq: number }[]; credentialsByRole: Record<string, number>; generatedAt: string;
  }>('/reports/gate-summary', admin);
  expect(report.total).toBeGreaterThanOrEqual(3);
  expect(report.byZone.P).toMatchObject({ ALLOW: expect.any(Number), DENY: expect.any(Number) });
  expect(report.byReason.ANTI_PASSBACK).toBeGreaterThanOrEqual(1);
  expect(report.byReason.OK_EXIT).toBeGreaterThanOrEqual(1);
  const me = report.devices.find((d) => d.name === 'E2E cierre')!;
  expect(me.lastSeq).toBe(4); // seq 1 = shift_start
  expect(report.byDevice[me.id]).toMatchObject({ ALLOW: 2, DENY: 1 }); // + EVENT: 1 (shift_start)
  expect(report.credentialsByRole.COMP).toBeGreaterThan(0);
  // El total del reporte coincide con la suma de lo subido por cada dispositivo.
  const sum = Object.values(report.byDevice).reduce((a, d) => a + Object.values(d).reduce((x, y) => x + y, 0), 0);
  expect(sum).toBe(report.total);

  // Auditoría encadenada por hash: íntegra, con las acciones de las specs anteriores.
  const audit = await host.login('audit');
  // `?all=1` devuelve la cadena completa (sin paginar) si el host la soporta; si no, la primera página.
  const { records: raw, verification } = await host.get<{ records: { seq: number; action: string; prevHash: string; hash: string }[]; verification: { ok: boolean; length: number } }>('/audit?all=1', audit);
  expect(verification.ok).toBe(true);
  expect(verification.length).toBeGreaterThan(0);
  const records = [...raw].sort((a, b) => a.seq - b.seq);
  const actions = new Set(records.map((r) => r.action));
  expect(actions.has('DEVICE_ENROLLED')).toBe(true);
  expect(actions.has('ENROLL_TOKEN_CREATED')).toBe(true);
  for (let i = 1; i < records.length; i++) {
    if (records[i].seq === records[i - 1].seq + 1) expect(records[i].prevHash).toBe(records[i - 1].hash);
  }

  // Backup de cierre (VACUUM INTO) y health con auditoría OK.
  const backup = await host.post<{ file: string }>('/backup/snapshot', admin, {});
  expect(backup.status).toBe(200);
  expect(backup.body.file).toMatch(/tatami-.*\.db$/);
  const health = await host.get<{ ok: boolean; audit: { ok: boolean } }>('/health', admin);
  expect(health.audit.ok).toBe(true);
});
