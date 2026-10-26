/**
 * TC-S06 · Purga de datos personales a N días del evento (Ley 1581): un host cuyo evento ya pasó y
 * `TP_RETENTION_DAYS=0` muestra la purga como pendiente; desde Sistema (doble confirmación con el
 * nombre del evento) se borran nombre, documento, fecha de nacimiento y foto; se conservan las
 * credenciales (rol, zonas, estado), los escaneos agregados, el resumen y la auditoría (`PII_PURGED`).
 */
import { expect, test } from '@playwright/test';
import { adminGo, adminLogin, EXTERNAL, spawnHost, type SpawnedHost } from '../helpers.js';

test.skip(EXTERNAL, 'Levanta un host propio con fecha de evento pasada.');

let past: SpawnedHost;
test.beforeAll(async () => {
  past = await spawnHost({ name: 'purga', seed: 40, configPatch: { startDate: '2020-01-01', endDate: '2020-01-03' }, env: { TP_RETENTION_DAYS: '0' } });
});
test.afterAll(async () => { await past?.stop(); });

test('TC-S06 purga: PII ausente, agregados y auditoría presentes', async ({ page }) => {
  const api = past.api;
  const admin = await api.login('admin');
  const cfg = await api.get<{ config: { name: string } }>('/config', admin);
  const creds = await api.credentials();
  expect(creds.length).toBeGreaterThan(0);
  const sample = creds[0];
  const before = await api.get<{ displayName: string; person: { documentNumber?: string; birthDate?: string; purgedAt?: string | null } }>(`/credentials/${sample.id}`, admin);
  expect(before.person.documentNumber).toBeTruthy();
  expect(before.person.birthDate).toBeTruthy();
  const healthBefore = await api.get<{ purge: { due: boolean; retentionDays: number; pending: number } }>('/system/health', admin);
  expect(healthBefore.purge).toMatchObject({ due: true, retentionDays: 0 });
  expect(healthBefore.purge.pending).toBeGreaterThan(0);

  // Simulación desde la API: no cambia nada.
  const dry = await api.post<{ due: boolean; dryRun: boolean; persons: number; message: string }>('/system/purge', admin, { dryRun: true });
  expect(dry.body).toMatchObject({ due: true, dryRun: true, persons: healthBefore.purge.pending });
  // Sin el nombre del evento no se ejecuta.
  const noConfirm = await api.post<{ error: string }>('/system/purge', admin, { dryRun: false, confirm: 'otro nombre' });
  expect(noConfirm.status).toBe(400);
  expect(noConfirm.body.error).toContain('nombre del evento');

  // Desde el panel: Sistema › Purgar datos personales ahora → Continuar → nombre exacto del evento.
  await adminLogin(page, 'admin', { base: past.url });
  await adminGo(page, 'sistema');
  await expect(page.locator('.card', { hasText: 'Datos personales (purga)' })).toContainText('pendiente');
  await page.getByRole('button', { name: 'Purgar datos personales ahora' }).click();
  await expect(page.getByRole('dialog')).toContainText(/Borrar los datos personales de \d+ personas/);
  await page.getByRole('dialog').getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('dialog')).toContainText('Última confirmación');
  await page.getByRole('dialog').getByRole('textbox').fill(cfg.config.name);
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar datos personales' }).click();
  await expect(page.locator('.toast')).toContainText(/Datos personales de \d+ personas borrados/);
  await expect(page.locator('.card', { hasText: 'Datos personales (purga)' })).toContainText(/purgados/);

  // PII ausente, credenciales y agregados presentes, auditoría íntegra con PII_PURGED.
  const after = await api.get<{ displayName: string; status: string; roleCode: string; zones: string[]; person: { firstName?: string; documentNumber?: string; birthDate?: string; purgedAt?: string | null } | null }>(`/credentials/${sample.id}`, admin);
  expect(after.displayName).toBe('Credencial purgada');
  expect(after.person?.documentNumber).toBeFalsy();
  expect(after.person?.birthDate).toBeFalsy();
  expect(after.person?.purgedAt).toBeTruthy();
  expect(after).toMatchObject({ roleCode: sample.roleCode, zones: sample.zones, status: sample.status });
  const snapshot = await api.credentials();
  expect(snapshot.length).toBe(creds.length);
  expect(snapshot.every((c) => c.displayName === 'Credencial purgada' && !c.photoUrl)).toBe(true);
  const health = await api.get<{ purge: { pending: number; lastSummary: { persons: number; credentialsByRole: Record<string, number> } }; audit: { ok: boolean } }>('/system/health', admin);
  expect(health.purge.pending).toBe(0);
  expect(health.purge.lastSummary.persons).toBe(healthBefore.purge.pending);
  expect(Object.values(health.purge.lastSummary.credentialsByRole).reduce((a, b) => a + b, 0)).toBe(creds.length);
  expect(health.audit.ok).toBe(true);
  const audit = await api.get<{ records: { action: string; payload: { persons?: number } }[] }>('/audit?all=1', await api.login('audit'));
  const purged = audit.records.find((r) => r.action === 'PII_PURGED');
  expect(purged?.payload.persons).toBe(healthBefore.purge.pending);
  // La búsqueda por nombre ya no encuentra a nadie; el reporte por puerta sigue funcionando.
  const search = await api.get<{ total: number }>(`/credentials?q=${encodeURIComponent(before.displayName.split(' ')[0])}`, admin);
  expect(search.total).toBe(0);
  const report = await api.get<{ credentialsByRole: Record<string, number> }>('/reports/gate-summary', admin);
  expect(report.credentialsByRole[sample.roleCode]).toBeGreaterThan(0);
  // Idempotente: una segunda purga no tiene nada que hacer.
  const again = await api.post<{ message: string }>('/system/purge', admin, { dryRun: false, confirm: cfg.config.name });
  expect(again.body.message).toContain('No queda nada por purgar');
});
