/**
 * TC-049 · Accesibilidad básica (axe-core, WCAG 2.x A/AA) en las dos pantallas que más gente ve:
 * el formulario público de inscripción (nube) y la pantalla Resultado del scanner (verde y rojo),
 * más los tamaños mínimos de los botones del scanner (≥ 48 px, guantes).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { enrollScanner, host, SKIP_REGISTRATION } from '../helpers.js';
import { REGISTRATION_URL } from '../ports.js';

/**
 * `meta-viewport`: el scanner bloquea el zoom a propósito (app de kiosk a una mano, con guantes; el
 * tamaño de texto lo dan "Modo guantes" y "Alto contraste"). Es una decisión documentada, no un
 * descuido, así que esa regla se excluye solo en el scanner.
 */
async function axe(page: Page, label: string, disable: string[] = []) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).disableRules(disable).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (vs: typeof r.violations) => vs.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`).join('\n');
  expect(serious, `${label}: violaciones serias/críticas\n${describe(serious)}`).toEqual([]);
  return r.violations;
}

test('TC-049 formulario de inscripción sin violaciones serias (axe)', async ({ page }) => {
  test.skip(SKIP_REGISTRATION, 'E2E_SKIP_REGISTRATION=1');
  await page.goto(`${REGISTRATION_URL}/`);
  await expect(page.getByRole('heading', { name: /Inscripción/ })).toBeVisible();
  await axe(page, 'inscripción (vacío)');
  // Con errores de validación visibles (menor sin acudiente) y acompañantes desplegados.
  await page.getByLabel('Nombre', { exact: true }).fill('Ana');
  await page.getByLabel('Apellido').fill('A11y');
  await page.getByLabel('Fecha de nacimiento').fill('2012-03-10');
  await page.getByRole('button', { name: 'Agregar acompañante' }).click();
  await page.getByRole('checkbox', { name: /aviso de privacidad/ }).check();
  await page.getByRole('button', { name: 'Enviar inscripción' }).click();
  await expect(page.getByText(/escribe el nombre del acudiente/i)).toBeVisible();
  await axe(page, 'inscripción (con errores)');
});

test('TC-049 scanner: pantalla Resultado verde y roja (axe) y botones ≥ 48 px', async ({ page }) => {
  await enrollScanner(page, { zone: 'G', name: 'E2E a11y' });
  await axe(page, 'scanner · escanear', ['meta-viewport']);
  const cred = await host.pick('COMP', 50);
  // Verde: el resultado queda abierto hasta que se toque "Siguiente".
  const r = await page.evaluate((t) => window.__tpScan!(t), cred.token);
  expect(r.decision).toBe('ALLOW');
  await expect(page.getByTestId('result')).toHaveAttribute('data-decision', 'ALLOW');
  await axe(page, 'scanner · resultado verde', ['meta-viewport']);
  await page.getByTestId('result-next').click();
  // Rojo (zona no permitida para GEN en… G sí entra; usamos una firma alterada).
  const bad = cred.token.slice(0, -1) + (cred.token.endsWith('A') ? 'B' : 'A');
  const r2 = await page.evaluate((t) => window.__tpScan!(t), bad);
  expect(r2.decision).toBe('DENY');
  await expect(page.getByTestId('result')).toHaveAttribute('data-decision', 'DENY');
  await axe(page, 'scanner · resultado rojo', ['meta-viewport']);
  // Botones táctiles del resultado ≥ 48 px (RF-048).
  for (const b of await page.getByTestId('result').getByRole('button').all()) {
    const box = await b.boundingBox();
    expect(box, 'botón visible').toBeTruthy();
    expect(Math.min(box!.width, box!.height), `botón "${await b.textContent()}" ≥ 48 px`).toBeGreaterThanOrEqual(48);
  }
  await page.getByTestId('result-next').click();
  // Teclado del PIN tras bloquear la pantalla: también ≥ 48 px.
  await page.getByTestId('menu-open').click();
  await page.getByTestId('menu-lock').click();
  await expect(page.getByTestId('pin-screen')).toBeVisible();
  const key = page.getByTestId('pin-screen').getByRole('button', { name: '5', exact: true });
  const box = (await key.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
  await axe(page, 'scanner · PIN', ['meta-viewport']);
});
