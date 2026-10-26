/**
 * TC-023 · QR válido de extremo a extremo: verde "Adelante, <nombre>" con foto/iniciales,
 * rol y zona en < 300 ms; en otra zona, rojo por zona no permitida.
 */
import { expect, test } from '@playwright/test';
import { enrollScanner, host, scan, seedInfo } from '../helpers.js';

test('TC-023 ingreso válido verde con foto o iniciales; zona no permitida en rojo', async ({ page }) => {
  await enrollScanner(page, { zone: 'T', name: 'E2E T válido' });
  const comp = await host.pick('COMP', 0);

  const r = await page.evaluate((t) => window.__tpScan!(t), comp.token);
  expect(r.decision).toBe('ALLOW');
  expect(r.reasonCode).toBe('OK_PHOTO_CHECK');
  expect(r.messageTitle).toBe(`Adelante, ${comp.displayName.split(' ')[0]}`);
  expect(r.credentialId).toBe(comp.id);
  expect(r.elapsedMs, 'validación offline < 300 ms').toBeLessThan(300);
  await expect(page.getByTestId('result')).toHaveClass(/ALLOW/);
  await expect(page.getByTestId('result-title')).toHaveText(`Adelante, ${comp.displayName.split(' ')[0]}`);
  await expect(page.getByTestId('result-person')).toContainText('Competidor');
  await expect(page.getByTestId('result-person')).toContainText(comp.id);
  // Sin foto → iniciales
  await expect(page.getByTestId('result-photo')).toHaveAttribute('data-has-photo', 'no');
  await page.getByTestId('result-next').click();

  // Credencial con photoUrl → se muestra la imagen (rol GEN no entra a T: rojo por zona, pero la foto se ve igual).
  const info = seedInfo();
  const withPhoto = await host.credential(info.photoCredentialId);
  const r2 = await scan(page, withPhoto.token);
  expect(r2.decision).toBe('DENY');
  expect(r2.reasonCode).toBe('ZONE_NOT_ALLOWED');
  expect(r2.messageBody).toContain('no tiene acceso a Tatamis');

  const r3 = await page.evaluate((t) => window.__tpScan!(t), withPhoto.token);
  expect(r3.reasonCode).toBe('ZONE_NOT_ALLOWED');
  await expect(page.getByTestId('result-photo')).toHaveAttribute('data-has-photo', 'yes');
  await expect(page.getByTestId('result-photo').locator('img')).toBeVisible();
});
