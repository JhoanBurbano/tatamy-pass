/**
 * Cambio de zona solo con autorización de supervisor validada por el host, y cambio de la
 * dirección del host (para apuntar al standby) desde el menú discreto (RF-057 / manual §Supervisor).
 */
import { expect, test } from '@playwright/test';
import { enrollScanner, forceSync, host, scan } from '../helpers.js';
import { HOST_DIRECT_URL } from '../ports.js';

test('cambiar de zona exige supervisor (lo valida el host) y cambiar host reconecta', async ({ page }) => {
  await enrollScanner(page, { zone: 'T', name: 'E2E zona' });
  await page.getByTestId('menu-open').click();
  await page.getByTestId('menu-zone').click();
  await expect(page.getByTestId('zone-screen')).toBeVisible();
  await page.getByTestId('zone-W').click();
  await page.getByTestId('zone-confirm').click();
  await expect(page.getByTestId('supervisor-auth')).toBeVisible();

  // Usuario que no es supervisor.
  await page.getByTestId('sup-user').fill('control');
  await page.getByTestId('sup-secret').fill('control123');
  await page.getByTestId('sup-confirm').click();
  await expect(page.getByTestId('sup-error')).toContainText('no es supervisor');

  // PIN/contraseña incorrectos.
  await page.getByTestId('sup-user').fill('super');
  await page.getByTestId('sup-secret').fill('000000');
  await page.getByTestId('sup-confirm').click();
  await expect(page.getByTestId('sup-error')).toContainText('incorrectos');

  // Supervisor válido.
  await page.getByTestId('sup-secret').fill('super123');
  await page.getByTestId('sup-confirm').click();
  await expect(page.getByTestId('scan-screen')).toBeVisible();
  await expect(page.getByTestId('device-pill')).toContainText('zona W');
  await expect(page.getByTestId('toast')).toContainText('Zona cambiada a W por super');

  // La nueva zona se aplica a los escaneos (GEN no entra a W).
  const gen = await host.pick('GEN', 1);
  const r = await scan(page, gen.token);
  expect(r.reasonCode).toBe('ZONE_NOT_ALLOWED');
  expect(r.messageBody).toContain('Área de calentamiento');

  // Cambiar la dirección del host: se valida con /health antes de guardar.
  await page.getByTestId('menu-open').click();
  await page.getByTestId('menu-host').click();
  await page.getByTestId('host-input').fill('http://localhost:1');
  await page.getByTestId('host-save').click();
  await expect(page.getByTestId('host-error')).toContainText('No se pudo conectar');
  await page.getByTestId('host-input').fill(HOST_DIRECT_URL);
  await page.getByTestId('host-save').click();
  await expect(page.getByTestId('toast')).toContainText(`Host cambiado a ${HOST_DIRECT_URL}`);
  await page.getByTestId('menu-open').click();
  await expect(page.getByTestId('menu')).toContainText(`host ${HOST_DIRECT_URL}`);
  await page.keyboard.press('Escape');
  const status = await forceSync(page);
  expect(status.state).toBe('online');
  expect(status.pending).toBe(0);
});
