/**
 * TC-080 · Enrolamiento (token inválido/usado, enrolamiento correcto y PIN)
 * TC-074 · PIN incorrecto 5 veces → bloqueo 15 min; pendientes intactos
 */
import { expect, test } from '@playwright/test';
import { enrollScanner, forceSync, host, PIN, proxy, scan, startShift, unlockWithPin } from '../helpers.js';
import { HOST_URL } from '../ports.js';

test.describe('TC-080 enrolamiento', () => {
  test('código inexistente o ya usado: mensaje claro y sin dispositivo', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('enroll-host').fill(HOST_URL);
    await page.getByTestId('enroll-token').fill('codigo-que-no-existe');
    await page.getByTestId('enroll-pin').fill(PIN);
    await page.getByTestId('enroll-pin2').fill(PIN);
    await page.getByTestId('enroll-submit').click();
    await expect(page.getByTestId('enroll-error')).toContainText('no es válido o ya caducó');

    // Un código válido se puede canjear una sola vez (celular A ok, celular B no).
    const token = await host.enrollToken('G', 'CONTROL', 'E2E usado');
    const direct = await host.post<{ deviceId: string }>('/devices/enroll', undefined, { token, pin: '111111' });
    expect(direct.status).toBe(200);
    await page.getByTestId('enroll-token').fill(token);
    await page.getByTestId('enroll-submit').click();
    await expect(page.getByTestId('enroll-error')).toContainText('no es válido o ya caducó');
    await expect(page.getByTestId('enroll-screen')).toBeVisible();

    // Validaciones locales: PIN de 6 dígitos y PIN repetido.
    await page.getByTestId('enroll-pin2').fill('000000');
    await page.getByTestId('enroll-submit').click();
    await expect(page.getByTestId('enroll-error')).toContainText('no coinciden');
  });

  test('enrola, descarga el snapshot y la sesión sobrevive a una recarga', async ({ page }) => {
    await enrollScanner(page, { zone: 'G', name: 'E2E enrol' });
    await expect(page.getByTestId('device-pill')).toContainText('zona G');
    await expect(page.getByTestId('conn-status')).toHaveAttribute('data-state', 'online');
    const status = await forceSync(page);
    expect(status.credentials).toBeGreaterThan(100);
    await page.reload();
    await expect(page.getByTestId('scan-screen')).toBeVisible();
    // Terminar turno cierra la sesión: vuelve a pedir el PIN.
    await page.getByTestId('menu-open').click();
    await page.getByTestId('menu-end-shift').click();
    await expect(page.getByTestId('shift-summary')).toContainText('Turno terminado');
    await page.getByTestId('summary-close').click();
    await expect(page.getByTestId('pin-screen')).toBeVisible();
    await unlockWithPin(page);
    await startShift(page, 'Ana');
  });
});

test.describe('TC-074 bloqueo de PIN', () => {
  test('5 PIN incorrectos bloquean 15 min; el correcto no entra durante el bloqueo; los pendientes siguen', async ({ page }) => {
    await enrollScanner(page, { zone: 'T', name: 'E2E pin' });
    // Un escaneo pendiente (host apagado) antes del bloqueo.
    const cred = await host.pick('COMP', 40);
    await proxy.down();
    await forceSync(page);
    await scan(page, cred.token);
    await expect(page.getByTestId('pending-count')).toHaveText('1');

    // Cerrar turno con el host apagado: el resumen muestra 1 pendiente.
    await page.getByTestId('menu-open').click();
    await page.getByTestId('menu-end-shift').click();
    await expect(page.getByTestId('sum-pending')).toHaveText('1');
    await page.getByTestId('summary-close').click();
    await expect(page.getByTestId('pin-screen')).toBeVisible();

    for (let i = 1; i <= 4; i++) {
      await unlockWithPin(page, '000000');
      await expect(page.getByTestId('pin-error')).toContainText(`Te queda${5 - i === 1 ? '' : 'n'} ${5 - i} intento`);
    }
    await unlockWithPin(page, '000000');
    await expect(page.getByTestId('pin-locked')).toBeVisible();
    await expect(page.getByTestId('pin-countdown')).toHaveText(/^1[45]:[0-5]\d$/);
    await expect(page.getByTestId('pin-screen').getByRole('button', { name: '1', exact: true })).toBeDisabled();

    // El bloqueo sobrevive a una recarga y el PIN correcto no entra.
    await page.reload();
    await expect(page.getByTestId('pin-locked')).toBeVisible();
    await expect(page.getByTestId('pin-screen').getByRole('button', { name: PIN[0], exact: true })).toBeDisabled();

    // Avanzar el reloj 15 min: se desbloquea y el PIN correcto entra.
    await page.clock.install();
    await page.clock.fastForward('15:01');
    await expect(page.getByTestId('pin-locked')).toBeHidden();
    await unlockWithPin(page);
    await startShift(page);
    // El pendiente anterior al bloqueo sigue en IndexedDB (más el `shift_end` del cierre y el `shift_start` nuevo) y se envía al volver el host.
    await expect(page.getByTestId('pending-count')).toHaveText('3');
    await proxy.up();
    const status = await forceSync(page);
    expect(status.pending).toBe(0);
  });
});
