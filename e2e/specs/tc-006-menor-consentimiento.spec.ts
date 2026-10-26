/**
 * TC-006 · Inscripción de un menor: sin consentimiento/acudiente se bloquea con error en el
 * campo; completo crea la inscripción con guardian; por API sin acudiente → error.
 */
import { expect, test } from '@playwright/test';
import { cloud, SKIP_REGISTRATION } from '../helpers.js';
import { REGISTRATION_URL } from '../ports.js';

test.use({ baseURL: REGISTRATION_URL });
test.skip(SKIP_REGISTRATION, 'E2E_SKIP_REGISTRATION=1');

test('TC-006 menor sin consentimiento bloqueado; con acudiente queda inscrito @smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Inscripción/ })).toBeVisible();
  await page.getByLabel('Nombre', { exact: true }).fill('Ana');
  await page.getByLabel('Apellido').fill('Ruiz E2E');
  await page.getByLabel('Fecha de nacimiento').fill('2012-03-10');
  await page.getByLabel('Club / delegación').fill('Academia Caucana');
  await page.getByRole('combobox', { name: /^Categoría/ }).selectOption('JUV');
  await expect(page.getByText('Menor de edad.')).toBeVisible();
  // El aviso de privacidad es obligatorio para todos (TC-012): sin marcarlo el botón no se activa.
  const submit = page.getByRole('button', { name: 'Enviar inscripción' });
  await expect(submit).toBeDisabled();
  await page.getByRole('checkbox', { name: /aviso de privacidad/ }).check();
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page.getByText(/escribe el nombre del acudiente/i)).toBeVisible();
  await expect(page.getByText(/documento del acudiente/i).last()).toBeVisible();
  await expect(page.getByText(/Ley 1581/).last()).toBeVisible();

  await page.getByLabel('Nombre del acudiente').fill('Pedro Ruiz');
  await submit.click();
  await expect(page.getByText(/Escribe el documento del acudiente/)).toBeVisible();
  await page.getByLabel('Documento del acudiente').fill('1061000000');
  await submit.click();
  await expect(page.getByText(/El acudiente debe autorizar/)).toBeVisible();

  await page.getByRole('checkbox', { name: /Como acudiente autorizo/ }).check();
  await submit.click();
  await expect(page.getByRole('heading', { name: '¡Inscripción recibida!' })).toBeVisible();

  // Por API: menor sin bloque de acudiente → rechazado con errores específicos.
  const api = await cloud.post<{ ok: boolean; errors: Record<string, string> }>('/api/register', {
    firstName: 'Luis', lastName: 'Menor E2E', birthDate: '2012-03-10', roleCode: 'COMP', categoryCode: 'JUV', club: 'Academia Caucana', privacyConsent: true
  });
  expect(api.status).toBeGreaterThanOrEqual(400);
  expect(api.body.ok).toBe(false);
  expect(Object.keys(api.body.errors).sort()).toEqual(['guardianConsent', 'guardianDocument', 'guardianName']);

  // Edad fuera de categoría (TC-004) también bloquea.
  const age = await cloud.post<{ ok: boolean; errors: Record<string, string> }>('/api/register', {
    firstName: 'Mila', lastName: 'Edad E2E', birthDate: '2010-05-01', roleCode: 'COMP', categoryCode: 'ADU', guardianName: 'X', guardianDocument: '1', guardianConsent: true, privacyConsent: true
  });
  expect(age.body.ok).toBe(false);
  expect(age.body.errors.categoryCode).toMatch(/16 años/);
});
