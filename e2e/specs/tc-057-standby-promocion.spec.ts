/**
 * TC-057 / TC-058 · Equipo de respaldo: un segundo host arranca en modo standby replicando del
 * principal; con eventos nuevos el retraso (`lagSeconds`) baja; en standby no se aceptan cambios
 * (409); se promueve desde su propio panel (Sistema › PROMOVER); el scanner cambia la dirección del
 * host al nuevo principal y sigue escaneando; el evento llega al host promovido.
 */
import { expect, test } from '@playwright/test';
import { adminGo, adminLogin, enrollScanner, EXTERNAL, forceSync, host, hostApi, scan, spawnHost, type SpawnedHost } from '../helpers.js';
import { HOST_DIRECT_URL } from '../ports.js';

test.skip(EXTERNAL, 'Levanta un segundo host en local.');

let standby: SpawnedHost;
test.beforeAll(async () => { standby = await spawnHost({ name: 'standby', mode: 'standby', primaryUrl: HOST_DIRECT_URL }); });
test.afterAll(async () => { await standby?.stop(); });

test('TC-057 el respaldo replica, se promueve y el scanner se reconecta al nuevo principal', async ({ page }) => {
  test.setTimeout(150_000);
  // 1. Actividad en el principal: tres escaneos en W.
  await enrollScanner(page, { zone: 'W', name: 'E2E standby' });
  const creds = await Promise.all([20, 21, 22].map((i) => host.pick('COMP', i)));
  for (const c of creds) expect((await scan(page, c.token)).decision).toBe('ALLOW');
  expect((await forceSync(page)).pending).toBe(0);
  const primaryHealth = await host.health();

  // 2. El standby replica (cada 10 s): mismo número de credenciales y escaneos, retraso pequeño.
  await expect.poll(async () => (await standby.api.health()).scans, { timeout: 40_000, intervals: [1000] }).toBeGreaterThanOrEqual(primaryHealth.scans);
  const h = await standby.api.health();
  expect(h.mode).toBe('standby');
  expect(h.credentials).toBe(primaryHealth.credentials);
  expect(h.lagSeconds).not.toBeNull();
  expect(h.lagSeconds!).toBeLessThanOrEqual(15);
  const standbyAdmin = await standby.api.login('admin'); // usuarios replicados
  const sb = standby.api;
  // Los eventos del scanner están en el standby.
  const devices = await sb.get<{ id: string; name: string; lastSeq: number }[]>('/devices', standbyAdmin);
  const me = devices.find((d) => d.name === 'E2E standby')!;
  expect(me.lastSeq).toBe(4); // shift_start + 3 escaneos

  // 3. En standby no se aceptan cambios.
  const rev = await sb.post<{ error: string }>(`/credentials/${creds[0].id}/revoke`, standbyAdmin, { reason: 'x' });
  expect(rev.status).toBe(409);
  expect(rev.body.error).toMatch(/equipo es el de respaldo/);

  // 4. Promoción desde el panel del propio standby (Sistema › PROMOVER).
  const panel = await page.context().newPage();
  await adminLogin(panel, 'admin', { base: standby.url });
  await expect(panel.locator('.standby-banner')).toContainText('equipo de respaldo');
  await adminGo(panel, 'sistema');
  await expect(panel.getByText(/Replicando del principal/).first()).toBeVisible();
  await panel.getByRole('button', { name: 'Convertir este equipo en el principal' }).click();
  await panel.getByRole('dialog').getByRole('textbox').fill('PROMOVER');
  await panel.getByRole('dialog').getByRole('button', { name: 'Promover' }).click();
  await expect(panel.locator('.toast')).toContainText(/ahora es el principal/);
  await expect.poll(async () => (await sb.health()).mode).toBe('primary');
  await expect(panel.locator('.standby-banner')).toBeHidden({ timeout: 15_000 });
  await panel.close();
  const audit = await sb.get<{ records: { action: string }[] }>('/audit?all=1', await sb.login('audit'));
  expect(audit.records.some((r) => r.action === 'PROMOTED')).toBe(true);

  // 5. El scanner apunta al nuevo principal (menú › Cambiar dirección del host) y escanea.
  await page.getByTestId('menu-open').click();
  await page.getByTestId('menu-host').click();
  await page.getByTestId('host-input').fill(standby.url);
  await page.getByTestId('host-save').click();
  await expect(page.getByTestId('toast')).toContainText(`Host cambiado a ${standby.url}`);
  const status = await forceSync(page);
  expect(status.state).toBe('online');
  const extra = await host.pick('COMP', 23);
  expect((await scan(page, extra.token)).decision).toBe('ALLOW');
  expect((await forceSync(page)).pending).toBe(0);
  // El escaneo nuevo está en el host promovido (y no en el viejo principal).
  const after = await sb.get<{ id: string; name: string; lastSeq: number }[]>('/devices', standbyAdmin);
  expect(after.find((d) => d.name === 'E2E standby')!.lastSeq).toBe(5);
  const old = hostApi(HOST_DIRECT_URL);
  const oldDev = (await old.get<{ id: string; name: string; lastSeq: number }[]>('/devices', await old.login('admin'))).find((d) => d.name === 'E2E standby')!;
  expect(oldDev.lastSeq).toBe(4);
  expect((await sb.health()).audit).toMatchObject({ ok: true });
});
