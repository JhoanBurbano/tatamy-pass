/**
 * TC-007 · Cupo lleno (PRESS = 2 en la config de pruebas): la tercera inscripción recibe
 * "cupo lleno" y, aceptando, queda en lista de espera sin contar para el cupo.
 */
import { expect, test } from '@playwright/test';
import { cloud, SKIP_REGISTRATION } from '../helpers.js';
import { REGISTRATION_URL } from '../ports.js';

test.use({ baseURL: REGISTRATION_URL });
test.skip(SKIP_REGISTRATION, 'E2E_SKIP_REGISTRATION=1');

const press = (n: number) => ({ firstName: `Prensa${n}`, lastName: 'E2E', birthDate: '1990-01-01', roleCode: 'PRESS', club: `Medio ${n}` });

test('TC-007 cupo lleno → lista de espera', async ({ page }) => {
  const a = await cloud.post<{ ok: boolean; status: string }>('/api/register', press(1));
  const b = await cloud.post<{ ok: boolean; status: string }>('/api/register', press(2));
  expect([a.status, b.status]).toEqual([201, 201]);
  expect([a.body.status, b.body.status]).toEqual(['PENDING', 'PENDING']);

  const full = await cloud.post<{ ok: boolean; code: string; message: string }>('/api/register', press(3));
  expect(full.status).toBe(409);
  expect(full.body.code).toBe('CAPACITY_FULL');
  expect(full.body.message).toMatch(/cupo .* lleno/i);

  const wait = await cloud.post<{ ok: boolean; status: string; message: string }>('/api/register', { ...press(3), acceptWaitlist: true });
  expect(wait.status).toBe(201);
  expect(wait.body.status).toBe('WAITLIST');
  expect(wait.body.message).toContain('lista de espera');

  const status = await cloud.status<{ roles: { code: string; used: number; remaining: number | null }[] }>();
  const p = status.roles.find((r) => r.code === 'PRESS')!;
  expect(p).toMatchObject({ used: 2, remaining: 0 }); // la lista de espera no cuenta

  // En el formulario: chip "cupo lleno" y botón "Entrar en lista de espera".
  await page.goto('/');
  await page.getByLabel('Tipo de inscripción').selectOption('PRESS');
  await expect(page.getByText('Prensa: cupo lleno')).toBeVisible();
  await expect(page.getByText(/Cupo lleno para Prensa/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar en lista de espera' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /lista de espera/ }).check();
  await page.getByRole('checkbox', { name: /aviso de privacidad/ }).check();
  await page.getByLabel('Nombre', { exact: true }).fill('Prensa4');
  await page.getByLabel('Apellido').fill('E2E');
  await page.getByLabel('Fecha de nacimiento').fill('1991-01-01');
  await page.getByRole('button', { name: 'Entrar en lista de espera' }).click();
  await expect(page.getByRole('heading', { name: 'Quedaste en lista de espera' })).toBeVisible();
});
