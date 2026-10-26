/**
 * Acompañantes por participante (decisión 2026-10-13): hasta `perParticipant` (2) por API y
 * en el formulario; el tercero se rechaza con el mensaje de límite.
 */
import { expect, test } from '@playwright/test';
import { cloud, SKIP_REGISTRATION } from '../helpers.js';
import { REGISTRATION_URL } from '../ports.js';

test.use({ baseURL: REGISTRATION_URL });
test.skip(SKIP_REGISTRATION, 'E2E_SKIP_REGISTRATION=1');

test('acompañantes hasta el límite por participante', async ({ page }) => {
  const base = { firstName: 'Carla', lastName: 'Acomp E2E', birthDate: '2000-05-01', roleCode: 'COMP', categoryCode: 'ADU', club: 'Academia Caucana' };
  const tooMany = await cloud.post<{ ok: boolean; errors: Record<string, string> }>('/api/register', { ...base, companions: [{ name: 'Uno' }, { name: 'Dos' }, { name: 'Tres' }] });
  expect(tooMany.status).toBe(400);
  expect(tooMany.body.errors.companions).toMatch(/máximo|acompañantes/i);

  const ok = await cloud.post<{ ok: boolean; companions: { firstName: string; roleCode: string; companionOf: string }[]; registration: { id: string } }>('/api/register', {
    ...base, companions: [{ name: 'Pedro Ruiz', document: '9', relationship: 'Padre' }, { name: 'Lina Ruiz' }]
  });
  expect(ok.status).toBe(201);
  expect(ok.body.companions.length).toBe(2);
  expect(ok.body.companions.every((c) => c.roleCode === 'ACOMP' && c.companionOf === ok.body.registration.id)).toBe(true);

  // Formulario: el botón se desactiva al llegar a 2 con el mensaje de límite.
  await page.goto('/');
  const add = page.getByRole('button', { name: 'Agregar acompañante' });
  await add.click();
  await add.click();
  await expect(page.getByText('2 de 2')).toBeVisible();
  await expect(add).toBeDisabled();
  await expect(page.getByText(/ya tiene 2 acompañantes, el máximo permitido/)).toBeVisible();
});
