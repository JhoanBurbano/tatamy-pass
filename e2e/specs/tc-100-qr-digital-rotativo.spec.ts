/**
 * TC-100 · QR digital rotativo: pantallazo de hace 4 min pasa (tolerancia ±5 min),
 * de hace 6 min "Código vencido", futuro fuera de tolerancia rechazado, en vivo pasa.
 * Un rol físico (COMP) con QR rotativo se rechaza.
 */
import { expect, test } from '@playwright/test';
import { signRotatingToken } from '@tatami/core';
import { enrollScanner, host, scan, signingKey } from '../helpers.js';

test('TC-100 QR rotativo vencido, dentro de tolerancia y en vivo', async ({ page }) => {
  await enrollScanner(page, { zone: 'G', name: 'E2E digital' });
  const gen = await host.pick('GEN', 0);
  const comp = await host.pick('COMP', 8);
  const key = signingKey();
  const MIN = 60_000;
  const now = Date.now();

  const expired6 = await scan(page, signRotatingToken(gen, key, now - 7 * MIN, 60)); // exp = −6 min
  expect(expired6.decision).toBe('DENY');
  expect(expired6.reasonCode).toBe('DIGITAL_TOKEN_EXPIRED');
  expect(expired6.messageBody).toContain('caducó');

  const future = await scan(page, signRotatingToken(gen, key, now + 7 * MIN, 60)); // iat = +7 min
  expect(future.reasonCode).toBe('DIGITAL_TOKEN_EXPIRED');

  const within = await scan(page, signRotatingToken(gen, key, now - 5 * MIN, 60)); // exp = −4 min
  expect(within.decision).toBe('ALLOW');

  const live = await scan(page, signRotatingToken(gen, key, Date.now(), 60));
  expect(live.decision).toBe('ALLOW');

  const physicalRole = await scan(page, signRotatingToken(comp, key, Date.now(), 60));
  expect(physicalRole.decision).toBe('DENY');
  expect(physicalRole.reasonCode).toBe('DIGITAL_NOT_ALLOWED');
});
