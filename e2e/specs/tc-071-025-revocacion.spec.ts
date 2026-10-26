/**
 * TC-071 · Credencial revocada mientras el scanner está sin red: pasa (limitación L1
 * documentada) y, al reconectar, la revocación llega y el siguiente escaneo es rojo.
 * TC-025 · Re-emisión: el QR de la versión anterior queda rojo y el nuevo pasa.
 */
import { expect, test } from '@playwright/test';
import { enrollScanner, forceSync, host, proxy, scan } from '../helpers.js';

test.afterEach(async () => { await proxy.up(); });

test('TC-071 revocación llega al scanner tras reconectar', async ({ page }) => {
  await enrollScanner(page, { zone: 'G', name: 'E2E revoc' });
  const cred = await host.pick('COMP', 3);
  const admin = await host.login('admin');

  await proxy.down();
  await forceSync(page);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'offline');

  const rev = await host.post('/credentials/' + cred.id + '/revoke', admin, { reason: 'fraude confirmado' });
  expect(rev.status).toBe(200);

  // Sin red el scanner no conoce la revocación: verde (limitación aceptada de L1).
  const r1 = await scan(page, cred.token);
  expect(r1.decision).toBe('ALLOW');

  await proxy.up();
  const status = await forceSync(page);
  expect(status.state).toBe('online');
  expect(status.pending).toBe(0);

  const r2 = await scan(page, cred.token);
  expect(r2.decision).toBe('DENY');
  expect(r2.reasonCode).toBe('REVOKED');
  expect(r2.messageBody).toContain('anulada');
});

test('TC-025 versión anterior re-emitida → rojo; versión nueva → verde', async ({ page }) => {
  await enrollScanner(page, { zone: 'G', name: 'E2E reissue' });
  const cred = await host.pick('COMP', 4);
  const admin = await host.login('admin');
  const old = cred.token;

  const re = await host.post<{ credential: { version: number; token: string } }>('/credentials/' + cred.id + '/reissue', admin, { reason: 'pérdida' });
  expect(re.status).toBe(200);
  expect(re.body.credential.version).toBe(2);
  await forceSync(page);

  const r1 = await scan(page, old);
  expect(r1.decision).toBe('DENY');
  expect(r1.reasonCode).toBe('OLD_VERSION');
  const r2 = await scan(page, re.body.credential.token);
  expect(r2.decision).toBe('ALLOW');
});
