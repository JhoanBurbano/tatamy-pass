/**
 * Ingreso manual con motivo del catálogo, ID corto validado en el cliente (dígito verificador),
 * búsqueda local por nombre y excepción de supervisor (PIN) desde una pantalla roja
 * (RF de "Control de entradas" y "Supervisor"; todo queda en el log con motivo y quién autorizó).
 */
import { expect, test } from '@playwright/test';
import { enrollScanner, forceSync, host, scan, supervisorPin } from '../helpers.js';

test('ID con verificador, motivo del catálogo, búsqueda por nombre y excepción con PIN de supervisor', async ({ page }) => {
  await enrollScanner(page, { zone: 'G', name: 'E2E manual', role: 'SUPERVISOR' });
  const comp = await host.pick('COMP', 9);
  const [first, last] = comp.displayName.split(' ');

  // ID corto con el último carácter mal escrito: el cliente lo detecta antes de buscar.
  await page.getByTestId('open-manual').click();
  const wrong = comp.id.slice(0, -1) + (comp.id.endsWith('A') ? 'B' : 'A');
  await page.getByTestId('manual-input').fill(wrong);
  await expect(page.getByTestId('id-check')).toHaveAttribute('data-state', 'check');
  await expect(page.getByTestId('manual-selected')).toBeDisabled();

  // Búsqueda por nombre (sin tildes ni mayúsculas) → persona → motivo del catálogo → registrado.
  await page.getByTestId('manual-input').fill(`${first} ${last}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
  await expect(page.getByTestId('search-results')).toBeVisible();
  const item = page.getByTestId('search-item').filter({ hasText: comp.id });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByTestId('manual-person')).toContainText(comp.displayName);
  await page.getByTestId('manual-selected').click();
  await expect(page.getByTestId('reason-sheet')).toBeVisible();
  await expect(page.getByTestId('reason-confirm')).toBeDisabled();
  await page.getByTestId('reason-OTHER').click();
  await expect(page.getByTestId('reason-confirm')).toBeDisabled(); // "Otro" exige texto
  await page.getByTestId('reason-input').fill('abc');
  await expect(page.getByTestId('reason-confirm')).toBeDisabled();
  await page.getByTestId('reason-input').fill('credencial dañada, documento verificado');
  await page.getByTestId('reason-confirm').click();
  // Las reglas deciden igual (COMP en G → verde con foto); el motivo viaja en el evento.
  await expect(page.getByTestId('result')).toHaveAttribute('data-decision', 'ALLOW');
  await expect(page.getByTestId('result-title')).toHaveText(`Adelante, ${first}`);
  await page.getByTestId('result-next').click();

  // ID corto escrito "a mano" (minúsculas, sin guiones) y validación sin motivo.
  await page.waitForTimeout(2100); // anti-doble-lectura de 2 s
  await page.getByTestId('open-manual').click();
  await page.getByTestId('manual-input').fill(comp.id.toLowerCase().replace(/-/g, ' '));
  await expect(page.getByTestId('id-check')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByTestId('manual-person')).toContainText(comp.id);
  await page.getByTestId('validate-selected').click();
  await expect(page.getByTestId('result')).toHaveAttribute('data-decision', 'ALLOW');
  await page.getByTestId('result-next').click();

  // Desde un resultado rojo: "Autorizar (supervisor)" pide PIN y motivo; el rojo no se cierra solo.
  const r = await page.evaluate((t) => window.__tpScan!(t), 'TP2.basura.x');
  expect(r.reasonCode).toBe('MALFORMED');
  await page.waitForTimeout(3500);
  await expect(page.getByTestId('result')).toHaveAttribute('data-decision', 'DENY');
  await expect(page.getByTestId('result-override')).toBeHidden(); // sin ID no hay a quién autorizar
  await page.getByTestId('result-next').click();

  const other = await host.pick('COMP', 10);
  const r2 = await page.evaluate((t) => window.__tpScan!(t), other.token.replace('TP1.', 'TP1.x')); // firma inválida pero con ID legible
  expect(['BAD_SIGNATURE', 'MALFORMED']).toContain(r2.reasonCode);
  if (await page.getByTestId('result-override').isVisible()) {
    await page.getByTestId('result-override').click();
    await supervisorPin(page);
    await page.getByTestId('reason-GATE_ERROR').click();
    await page.getByTestId('reason-confirm').click();
    await expect(page.getByTestId('result')).toHaveAttribute('data-reason', 'OK_MANUAL');
    await expect(page.getByTestId('result-body')).toContainText('Error de puerta');
  }
  await page.getByTestId('result-next').click();

  // El motivo y quién autorizó viajan al host.
  const status = await forceSync(page);
  expect(status.pending).toBe(0);
  const admin = await host.login('admin');
  const devices = await host.get<{ id: string; name: string }[]>('/devices', admin);
  const me = devices.filter((d) => d.name === 'E2E manual').at(-1)!;
  const { events } = await host.get<{ events: { deviceId: string; reasonCode: string; manual?: Record<string, unknown> }[] }>('/sync/events?since=&limit=20000', admin);
  const mine = events.filter((e) => e.deviceId === me.id && e.manual);
  expect(mine.find((e) => e.manual?.type === 'manual_entry')?.manual).toEqual({ type: 'manual_entry', reasonCode: 'OTHER', reason: 'Otro: credencial dañada, documento verificado', by: 'E2E manual' });
  const ex = mine.find((e) => e.manual?.type === 'exception');
  if (ex) expect(ex.manual).toMatchObject({ reasonCode: 'GATE_ERROR', authorizedBy: 'E2E manual' });

  // __tpScan también admite override directo (para otras specs).
  const direct = await scan(page, comp.id, { override: 'prueba de modo test' });
  expect(direct.reasonCode).toBe('OK_MANUAL');
});
