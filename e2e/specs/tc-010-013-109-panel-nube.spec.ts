/**
 * Panel de coordinación de la nube (/panel):
 *   TC-010 · Lista de espera: "Liberar un cupo" ofrece el cupo al primero con correo → correo con enlace
 *            /confirmar/<token> (48 h) en la bandeja de salida → al abrirlo pasa a pendiente.
 *   TC-013 · Duplicados: dos inscripciones con el mismo documento aparecen en la cola y "Fusionar" deja una sola.
 *   TC-109 · Exportación: CSV de aprobados con las columnas esperadas; `GET /api/export` 401 sin clave y 200 con ella.
 * (La rotación de la clave está en specs/zz-ultimo/, porque deja la nube con otra clave.)
 */
import { expect, test } from '@playwright/test';
import { cloud, cloudLogin, SKIP_REGISTRATION } from '../helpers.js';
import { REGISTRATION_URL } from '../ports.js';

test.use({ baseURL: REGISTRATION_URL });
test.skip(SKIP_REGISTRATION, 'E2E_SKIP_REGISTRATION=1');

const press = (n: number, extra: Record<string, unknown> = {}) => ({ firstName: `Espera${n}`, lastName: 'E2E', birthDate: '1988-01-01', roleCode: 'PRESS', club: 'Medio E2E', privacyConsent: true, ...extra });

test('TC-010 lista de espera: liberar un cupo manda el correo y el enlace confirma', async ({ page }) => {
  // Llenar PRESS (cupo 2 en la config de pruebas) y dejar a Lupe en lista de espera con correo.
  const st = await cloud.status<{ roles: { code: string; remaining: number | null }[] }>();
  const remaining = st.roles.find((r) => r.code === 'PRESS')!.remaining ?? 0;
  for (let i = 0; i < remaining; i++) expect((await cloud.post('/api/register', press(i))).status).toBe(201);
  const wait = await cloud.post<{ status: string }>('/api/register', { firstName: 'Lupe', lastName: 'Espera E2E', birthDate: '1989-05-05', roleCode: 'PRESS', club: 'Medio E2E', email: 'espera@e2e.local', privacyConsent: true, acceptWaitlist: true });
  expect(wait.status).toBe(201);
  expect(wait.body.status).toBe('WAITLIST');

  await cloudLogin(page);
  await page.goto('/panel/lista-espera');
  const card = page.locator('.card', { hasText: 'Prensa' });
  await expect(card).toContainText('Lupe Espera E2E');
  // Quienes estaban antes sin correo pasan directo a pendiente; al llegar a Lupe sale la oferta por correo.
  let flash = '';
  for (let i = 0; i < 6 && !flash.includes('Lupe Espera E2E'); i++) {
    await page.goto('/panel/lista-espera');
    await page.locator('.card', { hasText: 'Prensa' }).getByRole('button', { name: /Liberar un cupo/ }).click();
    await page.waitForURL(/[?&](ok|error)=/);
    const u = new URL(page.url());
    flash = u.searchParams.get('ok') ?? u.searchParams.get('error') ?? '';
  }
  expect(flash).toBe('Cupo ofrecido a Lupe Espera E2E (correo enviado). Tiene 48 h para confirmar.');
  await expect(page.locator('.notice', { hasText: 'Cupo ofrecido a Lupe Espera E2E' })).toBeVisible();
  await expect(page.locator('.card', { hasText: 'Prensa' })).toContainText(/Cupo ofrecido|vence/);
  const mail = cloud.outbox().find((m) => m.text.includes('espera@e2e.local') && m.text.includes('/confirmar/'));
  expect(mail, 'correo de oferta en la bandeja de salida').toBeTruthy();
  const token = /\/confirmar\/([A-Za-z0-9_-]+)/.exec(mail!.text)![1];
  await page.goto(`/confirmar/${token}`);
  await expect(page.getByRole('heading', { name: 'Cupo confirmado' })).toBeVisible();
  await page.goto('/panel/inscripciones?status=PENDING&q=Espera');
  await expect(page.locator('table tbody tr').filter({ hasText: 'Lupe Espera E2E' })).toContainText(/Pendiente|Validada/);
  // El enlace no se puede usar dos veces.
  await page.goto(`/confirmar/${token}`);
  await expect(page.getByRole('heading', { name: 'Este enlace no sirve' })).toBeVisible();
});

test('TC-013 duplicados por documento: fusionar deja una sola inscripción', async ({ page }) => {
  const a = await cloud.post<{ ok: boolean; registration: { id: string } }>('/api/register', { firstName: 'Mateo', lastName: 'Duplicado E2E', birthDate: '2001-07-07', roleCode: 'COMP', categoryCode: 'ADU', documentNumber: '770077001', club: 'Academia Caucana', privacyConsent: true });
  const b = await cloud.post<{ ok: boolean; registration: { id: string } }>('/api/register', { firstName: 'Mateo A.', lastName: 'Duplicado E2E', birthDate: '2001-07-07', roleCode: 'COMP', categoryCode: 'ADU', documentNumber: '770.077.001', club: 'Caucana', email: 'mateo@e2e.local', privacyConsent: true });
  expect([a.status, b.status]).toEqual([201, 201]);

  await cloudLogin(page);
  await page.goto('/panel/duplicados');
  const pair = page.locator('.card', { hasText: 'Duplicado E2E' });
  await expect(pair).toContainText(/Mismo documento/);
  await expect(page.locator('aside nav a', { hasText: 'Duplicados' }).locator('.n')).toHaveText(/\d+/);
  await pair.getByRole('button', { name: 'Fusionar (conservar la primera)' }).click();
  await expect(page.locator('.notice').first()).toContainText('Fusionadas en una sola inscripción: Mateo Duplicado E2E');
  await expect(page.locator('.card', { hasText: 'Duplicado E2E' })).toHaveCount(0);
  await page.goto('/panel/inscripciones?status=ALL&q=Duplicado');
  const rows = page.locator('table tbody tr').filter({ hasText: 'Duplicado E2E' });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Mateo Duplicado E2E');
  // La fusión completó los datos que faltaban (el correo de la segunda).
  await rows.getByRole('link').first().click();
  await expect(page.getByLabel('Correo')).toHaveValue('mateo@e2e.local');
});

test('TC-109 exportar: CSV con columnas esperadas y API del host protegida por clave', async ({ page }) => {
  await cloudLogin(page);
  await page.goto('/panel/exportar');
  await expect(page.getByRole('heading', { name: 'Exportar' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Descargar CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^aprobados-\d{4}-\d{2}-\d{2}\.csv$/);
  const res = await page.request.get('/panel/exportar/csv');
  expect(res.status()).toBe(200);
  const csv = await res.text();
  const header = csv.split(/\r?\n/)[0].replace(/^﻿/, '');
  expect(header.split(',').map((h) => h.replace(/^"|"$/g, ''))).toEqual(['ID', 'Código', 'Nombre', 'Apellido', 'Fecha de nacimiento', 'Documento', 'Club', 'Correo', 'Rol', 'Categoría', 'Acompañante de', 'Parentesco', 'Acudiente', 'Doc. acudiente', 'Foto', 'Credencial', 'Estado credencial', 'Anulada', 'Motivo anulación', 'Actualizada']);
  // Sin sesión el CSV no sale: el middleware manda al login.
  const anon = await fetch(`${REGISTRATION_URL}/panel/exportar/csv`, { redirect: 'manual' });
  expect([302, 307]).toContain(anon.status);
  expect(anon.headers.get('location')).toContain('/panel/login');
  // API del host: 401 sin clave, 200 con la clave compartida (misma que muestra el panel al admin).
  expect((await cloud.get('/api/export')).status).toBe(401);
  expect((await cloud.get('/api/export', { 'x-tatami-key': 'otra' })).status).toBe(401);
  const ok = await cloud.get<{ count: number; cursor: string | null; registrations: unknown[] }>('/api/export?since=', cloud.key);
  expect(ok.status).toBe(200);
  expect(ok.body.count).toBe(ok.body.registrations.length);
  await expect(page.locator('code.mono')).toContainText(cloud.key['x-tatami-key']);
  await expect(page.getByText('Reporte del host')).toBeVisible();
});
