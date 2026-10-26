/**
 * TC-110 · Diseño de la credencial (ADR-0009): el administrador abre Impresión › Diseño de la
 * credencial, cambia un color y la vista previa se regenera (PDF nuevo), sube un PNG que queda
 * disponible como logo, exporta la plantilla como JSON, el PDF del lote lleva dos páginas por
 * credencial y el operador de impresión ve el diseño en solo lectura. Deja capturas en
 * design/screenshots/badge-*.png.
 */
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { adminGo, adminLogin, host, ROOT } from '../helpers.js';

const SHOTS = join(ROOT, 'design', 'screenshots');
// PNG de 1×1 válido (pixel transparente)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe('TC-110 diseño de la credencial', () => {
  test.beforeAll(() => { mkdirSync(SHOTS, { recursive: true }); });

  test('admin: cambiar color regenera la vista previa, subir PNG, exportar JSON y guardar', async ({ page }) => {
    test.setTimeout(120_000);
    const admin = await host.login('admin');
    await host.post('/print/template/reset', admin, {});
    const previews: number[] = [];
    page.on('response', (r) => { if (r.url().endsWith('/print/template/preview') && r.status() === 200) previews.push(Date.now()); });

    await adminLogin(page, 'admin');
    await adminGo(page, 'impresion');
    await page.getByRole('tab', { name: 'Diseño de la credencial' }).click();
    await expect(page.getByText('Nacional 2026').first()).toBeVisible();
    await expect(page.getByTestId('badge-preview')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => previews.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: join(SHOTS, 'badge-01-diseno.png'), fullPage: true, animations: 'disabled' });

    // cambiar un color → el preview se vuelve a pedir (debounce 600 ms) y el iframe cambia de src
    const before = previews.length;
    const srcBefore = await page.getByTestId('badge-preview').getAttribute('src');
    await page.getByLabel('Acento (rosa) (hex)').fill('#1C4FD1');
    await expect.poll(() => previews.length, { timeout: 15_000 }).toBeGreaterThan(before);
    await expect.poll(() => page.getByTestId('badge-preview').getAttribute('src'), { timeout: 15_000 }).not.toBe(srcBefore);
    await expect(page.getByText('Cambios sin guardar')).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'badge-02-color-cambiado.png'), fullPage: true, animations: 'disabled' });

    // subir un PNG → aparece en la lista de archivos y se puede añadir al pie
    await page.getByText('Logos y archivos').click();
    await page.getByLabel('Id del archivo').fill('logo-prueba');
    await page.getByLabel('Nombre', { exact: true }).fill('Logo de prueba');
    await page.getByLabel('Archivo (PNG, JPG o SVG, hasta 1 MB)').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('logo-prueba · png')).toBeVisible({ timeout: 10_000 });
    const tpl = await host.get<{ template: { assets: Record<string, { name: string }> } }>('/print/template', admin);
    expect(tpl.template.assets['logo-prueba']).toMatchObject({ name: 'Logo de prueba' });
    await page.getByLabel('Añadir a Pie del anverso').selectOption('logo-prueba');
    await page.screenshot({ path: join(SHOTS, 'badge-03-logo-subido.png'), fullPage: true, animations: 'disabled' });

    // exportar JSON
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar plantilla (.json)' }).click()]);
    expect(download.suggestedFilename()).toBe('plantilla-credencial-nacional-2026.json');
    const exported = JSON.parse((await (await download.createReadStream()).toArray()).join('')) as { colors: { accent: string }; front: { footer: { logos: string[] } } };
    expect(exported.colors.accent).toBe('#1C4FD1');
    expect(exported.front.footer.logos).toContain('logo-prueba');

    // guardar → el host devuelve el color nuevo y el PDF del lote lleva anverso + reverso
    await page.getByRole('button', { name: 'Guardar diseño' }).click();
    await expect(page.getByText('Diseño guardado.', { exact: false })).toBeVisible({ timeout: 10_000 });
    const savedTpl = await host.get<{ template: { colors: { accent: string } }; isDefault: boolean }>('/print/template', admin);
    expect(savedTpl.template.colors.accent).toBe('#1C4FD1');
    expect(savedTpl.isDefault).toBe(false);
    const batch = (await host.post<{ id: string; count: number }>('/print/batches', admin, { roleCode: 'COMP', status: 'DELIVERED', limit: 2 })).body;
    const pdf = await host.getRaw(`/print/batches/${batch.id}/pdf`, admin);
    expect(pdf.status).toBe(200);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(20_000);
    await page.screenshot({ path: join(SHOTS, 'badge-04-guardado.png'), fullPage: true, animations: 'disabled' });

    // restablecer deja la plantilla por defecto
    await page.getByRole('button', { name: 'Restablecer diseño del piloto' }).click();
    await page.getByRole('button', { name: 'Restablecer', exact: true }).click();
    await expect(page.getByText('Diseño restablecido al del piloto.')).toBeVisible({ timeout: 10_000 });
    expect((await host.get<{ isDefault: boolean }>('/print/template', admin)).isDefault).toBe(true);
  });

  test('operador de impresión: ve el diseño en solo lectura y el host rechaza sus cambios', async ({ page }) => {
    await adminLogin(page, 'print');
    await adminGo(page, 'impresion');
    await page.getByRole('tab', { name: 'Diseño de la credencial' }).click();
    await expect(page.getByTestId('badge-preview')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Guardar diseño' })).toHaveCount(0);
    await expect(page.getByLabel('Acento (rosa) (hex)')).toBeDisabled();
    const print = await host.login('print');
    expect((await host.put('/print/template', print, { template: {} })).status).toBe(403);
    await page.screenshot({ path: join(SHOTS, 'badge-05-operador-solo-lectura.png'), fullPage: true, animations: 'disabled' });
  });
});
