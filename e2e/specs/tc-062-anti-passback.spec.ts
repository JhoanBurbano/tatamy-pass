/**
 * TC-062 · Anti-passback: entrada / entrada (rojo) / salida / entrada (verde),
 * cambiando el modo de la puerta (Entrada → Salida → Entrada) con PIN de supervisor.
 */
import { expect, test } from '@playwright/test';
import { enrollScanner, host, scan, setMode } from '../helpers.js';

test('TC-062 entrada, re-entrada bloqueada, salida y re-ingreso', async ({ page }) => {
  await enrollScanner(page, { zone: 'T', name: 'E2E apb', role: 'SUPERVISOR' });
  const comp = await host.pick('COMP', 2);

  await expect(page.getByTestId('scan-screen')).toHaveAttribute('data-direction', 'IN');
  const r1 = await scan(page, comp.token);
  expect(r1.decision).toBe('ALLOW');

  const r2 = await scan(page, comp.token);
  expect(r2.decision).toBe('DENY');
  expect(r2.reasonCode).toBe('ANTI_PASSBACK');
  expect(r2.messageBody).toMatch(/ya entró a Tatamis a las \d{1,2}:\d{2}/);

  // Modo Salida (menú › Cambiar zona o modo › PIN de supervisor).
  await setMode(page, 'OUT');
  await expect(page.getByTestId('scan-screen')).toHaveAttribute('data-direction', 'OUT');
  const r3 = await scan(page, comp.token);
  expect(r3.decision).toBe('ALLOW');
  expect(r3.reasonCode).toBe('OK_EXIT');
  expect(r3.messageTitle).toMatch(/^Salida registrada/);

  await setMode(page, 'IN');
  const r4 = await scan(page, comp.token);
  expect(r4.decision).toBe('ALLOW');
  expect(r4.reasonCode).toBe('OK_PHOTO_CHECK');

  // Secuencia completa [ok, antipassback, ok_exit, ok] como pide el caso.
  expect([r1, r2, r3, r4].map((r) => r.reasonCode)).toEqual(['OK_PHOTO_CHECK', 'ANTI_PASSBACK', 'OK_EXIT', 'OK_PHOTO_CHECK']);
});
