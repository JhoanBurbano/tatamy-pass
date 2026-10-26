/**
 * TC-044 · Host apagado → modo local: los escaneos siguen, la bandeja de pendientes
 * crece; host vuelve → se vacían y el host tiene todos los eventos (0 perdidos, 0 duplicados).
 */
import { expect, test } from '@playwright/test';
import { enrollScanner, forceSync, host, proxy, scan } from '../helpers.js';

test.afterEach(async () => { await proxy.up(); });

test('TC-044 sin host: pendientes; vuelve el host: se vacían y llegan completos', async ({ page }) => {
  await enrollScanner(page, { zone: 'W', name: 'E2E offline' });
  const creds = await Promise.all([5, 6, 7].map((i) => host.pick('COMP', i)));

  await proxy.down();
  await forceSync(page);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'offline');
  await expect(page.getByTestId('conn-status')).toContainText('Sin conexión');

  const results = [];
  for (const c of creds) results.push(await scan(page, c.token));
  results.push(await scan(page, creds[0].token)); // anti-passback local en W
  expect(results.map((r) => r.reasonCode)).toEqual(['OK_PHOTO_CHECK', 'OK_PHOTO_CHECK', 'OK_PHOTO_CHECK', 'ANTI_PASSBACK']);
  await expect(page.getByTestId('pending-count')).toHaveText('4');

  await page.getByTestId('pending-pill').click();
  await expect(page.getByTestId('pending-screen')).toBeVisible();
  await expect(page.getByTestId('pending-total')).toHaveText('4');
  await expect(page.getByTestId('pending-screen').locator('li')).toHaveCount(4);

  // Reintentar con el host aún apagado: siguen pendientes.
  await page.getByTestId('pending-retry').click();
  await expect(page.getByTestId('pending-total')).toHaveText('4');

  await proxy.up();
  await page.getByTestId('pending-retry').click();
  await expect(page.getByTestId('pending-total')).toHaveText('0', { timeout: 15_000 });
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'online');

  const admin = await host.login('admin');
  const devices = await host.get<{ id: string; name: string; lastSeq: number }[]>('/devices', admin);
  const me = devices.find((d) => d.name === 'E2E offline')!;
  expect(me.lastSeq).toBe(5); // seq 1 = shift_start (evento de dispositivo), 2–5 = escaneos
  const { events } = await host.get<{ events: { deviceId: string; seq: number }[] }>('/sync/events?since=&limit=20000', admin);
  const mine = events.filter((e) => e.deviceId === me.id).map((e) => e.seq).sort();
  expect(mine).toEqual([1, 2, 3, 4, 5]);

  // Un segundo sync no duplica nada (idempotente por device_id + seq).
  await forceSync(page);
  const again = await host.get<{ events: { deviceId: string }[] }>('/sync/events?since=&limit=20000', admin);
  expect(again.events.filter((e) => e.deviceId === me.id).length).toBe(5);
});
