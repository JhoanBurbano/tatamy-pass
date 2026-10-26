/**
 * TC-016 · Reimportación SportData idempotente: 3 creadas; mismo archivo → 0 creadas;
 * fila cambiada → 1 actualizada; duplicado interno se importa una sola vez.
 * La importación vive en el panel (`/import` redirige a `/panel/importar`) y su API exige
 * sesión de admin/coordinador: sin sesión responde 403.
 */
import { expect, test } from '@playwright/test';
import { cloud, cloudLogin, SKIP_REGISTRATION } from '../helpers.js';
import { E2E, REGISTRATION_URL } from '../ports.js';

const E2E_ADMIN = E2E.cloudAdmin.email;

test.use({ baseURL: REGISTRATION_URL });
test.skip(SKIP_REGISTRATION, 'E2E_SKIP_REGISTRATION=1');

const CSV = `Nombre,Apellido,Fecha de nacimiento,Club,Documento
Ana,Importada,01/05/2012,Academia Caucana,2001
Luis,Importado,2000-01-01,Academia Internacional de Taekwondo ITF,2002
Sara,Importada,1999-07-07,Academia ITF Bogotá,2003
`;

interface ImportResult { ok: boolean; created: number; updated: number; unchanged: number; duplicatesInFile: number; errors: unknown[] }

test('TC-016 importación idempotente (solo con sesión de coordinación)', async ({ page }) => {
  // Sin sesión: la API del panel no deja importar.
  const anon = await cloud.post<{ error: string }>('/api/import/preview', { csv: CSV });
  expect(anon.status).toBe(403);
  expect(anon.body.error).toMatch(/Inicia sesión/);

  // `/import` (ruta antigua) redirige al panel y, sin sesión, al login.
  await page.goto('/import');
  await expect(page).toHaveURL(/\/panel\/login/);

  await cloudLogin(page);
  // `page.request` comparte las cookies de la sesión (misma política que el navegador).
  const api = async <T>(path: string, body: unknown) => {
    const res = await page.request.post(path, { data: body });
    return { status: res.status(), body: (await res.json().catch(() => ({}))) as T };
  };

  const preview = await api<{ mapping: Record<string, string>; summary: { created: number } }>('/api/import/preview', { csv: CSV });
  expect(preview.status).toBe(200);
  expect(preview.body.mapping.birthDate).toBe('Fecha de nacimiento');
  expect(preview.body.summary.created).toBe(3);

  const first = await api<ImportResult>('/api/import/confirm', { csv: CSV, mapping: preview.body.mapping });
  expect(first.body).toMatchObject({ ok: true, created: 3, updated: 0, duplicatesInFile: 0 });

  const second = await api<ImportResult>('/api/import/confirm', { csv: CSV, mapping: preview.body.mapping });
  expect(second.body).toMatchObject({ ok: true, created: 0, updated: 0, unchanged: 3 });

  // Cambia el documento de una fila y añade una nueva; una fila repetida dentro del archivo.
  const edited = CSV.replace('2003', '2003B') + 'Nuevo,Importado,1995-02-02,Academia ITF Nariño · Pasto,2004\nNuevo,Importado,1995-02-02,Academia ITF Nariño · Pasto,2004\n';
  const third = await api<ImportResult>('/api/import/confirm', { csv: edited, mapping: preview.body.mapping });
  expect(third.body).toMatchObject({ ok: true, created: 1, updated: 1, duplicatesInFile: 1 });

  // La página del panel existe, carga con sesión y lleva el historial de lotes.
  await page.goto('/import');
  await expect(page).toHaveURL(/\/panel\/importar/);
  await expect(page.getByRole('heading', { name: 'Importar SportData' })).toBeVisible();
  // Historial de lotes: los 3 de esta prueba, el último con 1 nuevo / 1 actualizado / 1 repetido.
  const rows = page.locator('table tbody tr').filter({ hasText: E2E_ADMIN });
  await expect(rows).toHaveCount(3);
});
