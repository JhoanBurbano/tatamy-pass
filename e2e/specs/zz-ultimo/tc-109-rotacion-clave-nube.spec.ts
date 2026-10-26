/**
 * TC-109 (rotación) · Panel › Exportar › "Generar clave nueva": la clave anterior deja de valer al
 * instante (el host principal, que sigue con la vieja, recibe 401 al traer) y un host configurado con la
 * nueva funciona. Vive en `zz-ultimo/` porque deja la nube con otra clave: debe correr después de todas
 * las specs que usan la nube con la clave inicial (TC-200).
 */
import { expect, test } from '@playwright/test';
import { cloud, cloudLogin, EXTERNAL, host, SKIP_REGISTRATION, spawnHost, type SpawnedHost } from '../../helpers.js';
import { REGISTRATION_URL } from '../../ports.js';

test.use({ baseURL: REGISTRATION_URL });
test.skip(SKIP_REGISTRATION, 'E2E_SKIP_REGISTRATION=1');
test.skip(EXTERNAL, 'Rota la clave de la nube y levanta un host propio.');

let fresh: SpawnedHost | undefined;
test.afterAll(async () => { await fresh?.stop(); });

test('TC-109 rotación de clave: host con clave vieja → 401; con la nueva → funciona', async ({ page }) => {
  test.setTimeout(120_000);
  // Que haya algo aprobado que traer (si la spec corre sola): aprobar lo pendiente por API con la clave actual.
  const exp = await cloud.get<{ count: number }>('/api/export?since=', cloud.key);
  if (exp.body.count === 0) expect((await cloud.post('/api/approve', { all: true }, cloud.key)).status).toBe(200);
  const admin = await host.login('admin');
  const before = await host.post<{ ok: boolean }>('/sync/cloud/pull', admin, {});
  expect(before.status, JSON.stringify(before.body)).toBe(200);

  await cloudLogin(page);
  await page.goto('/panel/exportar');
  const oldKey = (await page.locator('code.mono').first().textContent())!.trim();
  expect(oldKey).toBe(cloud.key['x-tatami-key']);
  await page.getByRole('button', { name: /Generar clave nueva/ }).click();
  await expect(page.locator('.notice').first()).toContainText('Clave nueva generada. La anterior ya no vale');
  await expect(page.getByText(/generada en el panel/)).toBeVisible();
  const newKey = (await page.locator('code.mono').first().textContent())!.trim();
  expect(newKey).not.toBe(oldKey);
  expect(newKey.length).toBeGreaterThanOrEqual(32);

  // La API rechaza la vieja y acepta la nueva.
  expect((await cloud.get('/api/export', { 'x-tatami-key': oldKey })).status).toBe(401);
  expect((await cloud.get('/api/export', { 'x-tatami-key': newKey })).status).toBe(200);
  expect((await cloud.post('/api/host-report', { credentials: [] }, { 'x-tatami-key': oldKey })).status).toBe(401);

  // El host principal sigue con la clave vieja: 503 "la nube respondió 401", sin romper nada más.
  const stale = await host.post<{ ok: boolean; error: string; status: { online: boolean; message: string } }>('/sync/cloud/pull', admin, {});
  expect(stale.status).toBe(503);
  expect(stale.body.error).toContain('401');
  expect(stale.body.status.online).toBe(false);
  expect(stale.body.status.message).toContain('Sin conexión a la nube');
  expect((await host.health()).ok).toBe(true);

  // Un host con la clave nueva (TP_CLOUD_KEY actualizado y reiniciado) trae y reporta sin problema.
  fresh = await spawnHost({ name: 'clave-nueva', seed: 0, cloud: { url: REGISTRATION_URL, key: newKey } });
  const t = await fresh.api.login('admin');
  const pull = await fresh.api.post<{ ok: boolean; received: number; created: number; report: { ok: boolean; sent: number } }>('/sync/cloud/pull', t, {});
  expect(pull.status, JSON.stringify(pull.body)).toBe(200);
  expect(pull.body.ok).toBe(true);
  expect(pull.body.created).toBeGreaterThan(0);
  expect(pull.body.report).toMatchObject({ ok: true });
  expect(pull.body.report.sent).toBeGreaterThan(0);
  // El reporte del host nuevo aparece en la nube.
  await page.reload();
  await expect(page.getByText(/Reporte del host/).locator('..')).toContainText(/credenciales/);
});
