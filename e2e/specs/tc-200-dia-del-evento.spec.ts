/**
 * TC-200 · Flujo maestro "día del evento" (@smoke): recorre el ecosistema completo como lo
 * haría el evento, en serie y con estado compartido entre pasos:
 *
 *   nube: inscripción con foto + 2 acompañantes → coordinador aprueba en /panel
 *   host: "Traer ahora" (POST /sync/cloud/pull) → credenciales emitidas → el host reporta IDs a la nube
 *   nube: el acompañante abre /credencial/<token> y ve el QR digital READY; el competidor ve "credencial física"
 *   host: operador imprime un lote en /admin (PDF descargado > 0 bytes) → enrola un scanner desde /admin (código)
 *   scanner: inicio de turno → competidor verde → rojo anti-passback → modo salida → salida OK → reingreso OK
 *            → acompañante digital: rojo en Tatamis, verde en Gradería
 *   host: coordinador anula al competidor desde /admin mientras el scanner está sin red (proxy caído)
 *   scanner: sigue dejando pasar y acumula pendientes → vuelve el host → pendientes a 0 → QR anulado rojo → cierre de turno
 *   host: /admin › Auditoría "cadena verificada" y reporte por puerta con los números de este scanner
 */
import { expect, test, type Browser, type BrowserContext, type Download, type Page } from '@playwright/test';
import { statSync } from 'node:fs';
import { adminGo, adminLogin, cloud, cloudLogin, endShift, enrollScanner, EXTERNAL, forceSync, host, proxy, scan, setMode, SKIP_REGISTRATION, supervisorPin, testPhoto, type E2EScanResult } from '../helpers.js';
import { REGISTRATION_URL, SCANNER_URL } from '../ports.js';

test.describe.configure({ mode: 'serial' });

const PARTICIPANT = { firstName: 'Valentina', lastName: 'Mosquera E2E', document: '1061E2E001', email: 'valentina@e2e.local', club: 'Academia Caucana' };
const COMPANIONS = ['Rosa Mosquera', 'Julián Mosquera'];
const DEVICE = 'Puerta T · tablet E2E';

// Estado compartido entre pasos (misma worker, modo serial).
let browser: Browser;
let ops: BrowserContext; // nube + panel del host
let scannerCtx: BrowserContext;
let scanner: Page;
let registrationCode = '';
let participantId = ''; // ID corto en el host
let participantToken = '';
let companionLinks: string[] = [];
let companionQr = '';
let companionId = '';
let deviceName = '';
const results: E2EScanResult[] = [];

test.describe('TC-200 día del evento @smoke', () => {
test.skip(SKIP_REGISTRATION, 'E2E_SKIP_REGISTRATION=1');
test.skip(EXTERNAL, 'Necesita el proxy controlable (host apagado) y acceso a los correos de la nube.');

test.beforeAll(async ({ browser: b }) => {
  browser = b;
  ops = await browser.newContext();
  scannerCtx = await browser.newContext({ baseURL: SCANNER_URL });
  scanner = await scannerCtx.newPage();
});
test.afterAll(async () => {
  await proxy.up();
  await ops.close();
  await scannerCtx.close();
});

test('1 · nube: inscripción con foto y 2 acompañantes', async () => {
  const page = await ops.newPage();
  await page.goto(`${REGISTRATION_URL}/`);
  await page.getByLabel('Tipo de inscripción').selectOption('COMP');
  await page.getByLabel('Nombre', { exact: true }).fill(PARTICIPANT.firstName);
  await page.getByLabel('Apellido').fill(PARTICIPANT.lastName);
  await page.getByLabel('Fecha de nacimiento').fill('2000-02-02');
  await page.getByLabel('Documento de identidad').fill(PARTICIPANT.document);
  await page.getByLabel('Club / delegación').fill(PARTICIPANT.club);
  await page.getByLabel('Correo (para avisos)').fill(PARTICIPANT.email);
  await page.getByRole('combobox', { name: /^Categoría/ }).selectOption('ADU');
  // Foto: el selector de archivos está oculto; se recorta en el navegador y viaja como JPEG.
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: testPhoto() });
  await expect(page.getByRole('button', { name: 'Cambiar foto' }).first()).toBeVisible();
  for (const name of COMPANIONS) {
    await page.getByRole('button', { name: 'Agregar acompañante' }).click();
    await page.getByLabel('Nombre completo').last().fill(name);
  }
  await expect(page.getByText('2 de 2')).toBeVisible();
  await page.getByRole('checkbox', { name: /aviso de privacidad/ }).check();
  await page.getByRole('button', { name: 'Enviar inscripción' }).click();
  await expect(page.getByRole('heading', { name: '¡Inscripción recibida!' })).toBeVisible();
  await expect(page.getByText(/Acompañantes registrados: Rosa Mosquera, Julián Mosquera/)).toBeVisible();
  registrationCode = (await page.locator('.code').first().textContent())?.trim() ?? '';
  expect(registrationCode).toMatch(/^N26-/);
  // Correo de confirmación en la bandeja de salida de la nube de pruebas.
  await expect.poll(() => cloud.outbox().some((m) => m.text.includes(PARTICIPANT.email) && m.text.includes(registrationCode))).toBe(true);
  await page.close();
});

test('2 · nube: el coordinador aprueba en /panel y salen los enlaces digitales de los acompañantes', async () => {
  const page = await ops.newPage();
  await cloudLogin(page);
  await page.goto(`${REGISTRATION_URL}/panel/inscripciones?status=PENDING&q=${encodeURIComponent(PARTICIPANT.lastName)}`);
  const row = page.locator('table tbody tr').filter({ hasText: `${PARTICIPANT.firstName} ${PARTICIPANT.lastName}` });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('2'); // acompañantes
  await row.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.getByText(/aprobada y correo enviado/)).toBeVisible();
  // El correo de aprobación trae un enlace /credencial/<token> por acompañante (el competidor usa credencial física).
  await expect.poll(() => cloud.outbox().find((m) => m.text.includes(PARTICIPANT.email) && /aprobada/i.test(m.text))?.text ?? '').toContain('/credencial/');
  const mail = cloud.outbox().find((m) => m.text.includes(PARTICIPANT.email) && /aprobada/i.test(m.text))!.text;
  companionLinks = [...new Set([...mail.matchAll(/\/credencial\/([A-Za-z0-9_-]{20,64})/g)].map((m) => m[1]))];
  expect(companionLinks).toHaveLength(2);
  // Los acompañantes heredan el estado aprobado (ficha del participante).
  await page.goto(`${REGISTRATION_URL}/panel/inscripciones?status=APPROVED&q=Mosquera`);
  await page.locator('table tbody tr').filter({ hasText: PARTICIPANT.lastName }).getByRole('link').first().click();
  const companionRows = page.locator('.card', { hasText: 'Acompañantes (2 de 2)' }).locator('table tbody tr');
  await expect(companionRows).toHaveCount(2);
  for (const name of COMPANIONS) await expect(companionRows.filter({ hasText: name })).toContainText(/Aprobad/);
  // Antes de que el host reporte, la credencial digital está "en preparación".
  const before = await cloud.get<{ state: string }>(`/api/credencial/${companionLinks[0]}`);
  expect(before.body.state).toBe('WAITING_HOST');
  await page.close();
});

test('3 · host: "Traer ahora" emite las credenciales y reporta los IDs a la nube', async () => {
  const page = await ops.newPage();
  await adminLogin(page, 'coord');
  await adminGo(page, 'nube');
  await page.getByRole('button', { name: 'Traer ahora' }).click();
  // Puede haber otras aprobadas (p. ej. importadas de SportData por TC-016): lo fijo son los 2 acompañantes.
  await expect(page.locator('.toast')).toContainText(/Listo: \d+ recibidas · \d+ nuevas .* 2 acompañantes/);
  await expect(page.getByText(/Última actualización/).first()).toBeVisible();
  // El host asignó IDs cortos al competidor y a los dos acompañantes, y los reportó a la nube.
  const admin = await host.login('admin');
  const found = await host.get<{ items: { id: string; displayName: string; roleCode: string; status: string }[] }>(`/credentials?q=${encodeURIComponent('Mosquera E2E')}`, admin);
  const comp = found.items.find((c) => c.roleCode === 'COMP')!;
  expect(comp).toMatchObject({ displayName: `${PARTICIPANT.firstName} ${PARTICIPANT.lastName}`, status: 'ISSUED' });
  participantId = comp.id;
  participantToken = (await host.credential(participantId)).token;
  const companions = await host.get<{ companions: { id: string; displayName: string }[] }>(`/credentials/${participantId}/companions`, admin);
  expect(companions.companions.map((c) => c.displayName).sort()).toEqual([...COMPANIONS].sort());
  const status = await host.get<{ lastReport: { ok: boolean; sent: number; applied: number; unknown: string[] } }>('/sync/cloud/status', admin);
  expect(status.lastReport).toMatchObject({ ok: true, unknown: [] });
  expect(status.lastReport.sent).toBeGreaterThanOrEqual(3);
  expect(status.lastReport.applied).toBe(status.lastReport.sent);
  // La ficha de la nube muestra el estado reportado por el host.
  await page.close();
});

test('4 · nube: el acompañante ve su QR digital READY; el competidor, credencial física', async () => {
  const page = await ops.newPage();
  await page.goto(`${REGISTRATION_URL}/credencial/${companionLinks[0]}`);
  await expect(page.getByText('Tu credencial digital')).toBeVisible();
  await expect(page.locator('.qr svg')).toBeVisible();
  await expect(page.getByText(/Vence en \d+ s/)).toBeVisible();
  const data = await cloud.get<{ state: string; credentialId: string; qr: { token: string } }>(`/api/credencial/${companionLinks[0]}`);
  expect(data.body.state).toBe('READY');
  companionId = data.body.credentialId;
  companionQr = data.body.qr.token;
  expect(companionQr).toMatch(/^TP1\./);
  await expect(page.locator('.status-hero .code')).toHaveText(companionId);
  // Estado público del competidor: credencial emitida.
  await page.goto(`${REGISTRATION_URL}/estado/${registrationCode}`);
  await expect(page.locator('.timeline li.done', { hasText: 'Credencial emitida' })).toBeVisible();
  await page.close();
});

test('5 · host: el operador imprime un lote en /admin (PDF descargado)', async () => {
  const page = await ops.newPage();
  await adminLogin(page, 'print');
  await adminGo(page, 'impresion');
  await page.getByLabel('Rol').selectOption('COMP');
  await page.getByLabel('Club').selectOption(PARTICIPANT.club);
  await page.getByLabel('Máximo por lote').fill('5');
  await expect(page.getByText(/credenciales entrarían en el lote/)).toBeVisible();
  await page.getByRole('button', { name: 'Crear lote' }).click();
  await expect(page.locator('.toast')).toContainText(/Lote .* creado con \d+ credenciales/);
  const batchRow = page.locator('table tbody tr').filter({ hasText: 'Competidor' }).filter({ hasText: PARTICIPANT.club }).first();
  const [download] = await Promise.all([page.waitForEvent('download'), batchRow.getByRole('button', { name: 'Descargar PDF' }).click()]) as [Download, void];
  const file = await download.path();
  expect(file).toBeTruthy();
  expect(statSync(file!).size).toBeGreaterThan(0);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await batchRow.getByRole('button', { name: 'Marcar como impreso' }).click();
  await expect(page.locator('.toast').last()).toContainText('impreso');
  await page.close();
});

test('6 · host → scanner: enrolar desde /admin con el código e iniciar turno', async () => {
  const page = await ops.newPage();
  await adminLogin(page, 'admin');
  await adminGo(page, 'dispositivos');
  await page.getByLabel('Nombre de la puerta').fill(DEVICE);
  await page.getByRole('combobox', { name: 'Zona', exact: true }).selectOption('T');
  await page.getByLabel('Rol del scanner').selectOption('SUPERVISOR');
  await page.getByRole('button', { name: 'Generar código' }).click();
  await expect(page.getByText(/Escanea con el celular. Vence en/)).toBeVisible();
  const codes = await page.locator('.qr-box code').allTextContents();
  const token = codes[1];
  expect(token).toBeTruthy();
  await page.close();
  deviceName = DEVICE;
  await enrollScanner(scanner, { zone: 'T', token });
  await expect(scanner.getByTestId('device-pill')).toContainText('zona T');
  await expect(scanner.getByTestId('conn-status')).toHaveAttribute('data-state', 'online');
});

test('7 · scanner: competidor verde → anti-passback → salida → reingreso', async () => {
  const r1 = await scan(scanner, participantToken);
  expect(r1).toMatchObject({ decision: 'ALLOW', reasonCode: 'OK_PHOTO_CHECK', credentialId: participantId });
  expect(r1.messageTitle).toBe(`Adelante, ${PARTICIPANT.firstName}`);
  const r2 = await scan(scanner, participantToken);
  expect(r2).toMatchObject({ decision: 'DENY', reasonCode: 'ANTI_PASSBACK' });
  await setMode(scanner, 'OUT');
  const r3 = await scan(scanner, participantToken);
  expect(r3).toMatchObject({ decision: 'ALLOW', reasonCode: 'OK_EXIT' });
  await setMode(scanner, 'IN');
  const r4 = await scan(scanner, participantToken);
  expect(r4).toMatchObject({ decision: 'ALLOW', reasonCode: 'OK_PHOTO_CHECK' });
  results.push(r1, r2, r3, r4);
});

test('8 · scanner: acompañante con QR digital, rojo en Tatamis y verde en Gradería', async () => {
  const r1 = await scan(scanner, companionQr);
  expect(r1).toMatchObject({ decision: 'DENY', reasonCode: 'ZONE_NOT_ALLOWED', credentialId: companionId });
  expect(r1.messageBody).toContain('no tiene acceso a Tatamis');
  // Cambiar a Gradería (PIN del supervisor del propio dispositivo).
  await scanner.getByTestId('menu-open').click();
  await scanner.getByTestId('menu-zone').click();
  await scanner.getByTestId('zone-G').click();
  await scanner.getByTestId('zone-confirm').click();
  await supervisorPin(scanner);
  await expect(scanner.getByTestId('device-pill')).toContainText('zona G');
  const r2 = await scan(scanner, companionQr);
  expect(r2, JSON.stringify(r2)).toMatchObject({ decision: 'ALLOW', credentialId: companionId });
  results.push(r1, r2);
  expect((await forceSync(scanner)).pending).toBe(0);
});

test('9 · host sin red: el coordinador anula desde /admin; el scanner sigue dejando pasar y acumula pendientes', async () => {
  await proxy.down();
  await forceSync(scanner);
  await expect(scanner.getByTestId('conn-status')).toHaveAttribute('data-state', 'offline');

  const page = await ops.newPage();
  await adminLogin(page, 'coord');
  await adminGo(page, 'credenciales');
  await page.getByLabel('Nombre, ID corto o club').fill(participantId);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.locator('table tbody tr').filter({ hasText: participantId }).click();
  await page.getByRole('button', { name: 'Anular' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('uso fraudulento detectado en puerta');
  await page.getByRole('dialog').getByRole('button', { name: 'Anular' }).click();
  await expect(page.locator('.toast')).toContainText(`Credencial ${participantId} anulada`);
  await expect(page.getByRole('heading', { name: 'Anulaciones' })).toBeVisible();
  await page.close();

  // Sin red el scanner no conoce la anulación (limitación aceptada de L1): verde, y queda pendiente.
  const r1 = await scan(scanner, participantToken);
  expect(r1.decision).toBe('ALLOW');
  const r2 = await scan(scanner, companionQr);
  expect(r2.decision).toBe('ALLOW');
  results.push(r1, r2);
  await expect(scanner.getByTestId('pending-count')).toHaveText('2');
});

test('10 · vuelve el host: pendientes a 0, la anulación llega y el QR viejo es rojo; cierre de turno', async () => {
  await proxy.up();
  const status = await forceSync(scanner);
  expect(status.state).toBe('online');
  expect(status.pending).toBe(0);
  await expect(scanner.getByTestId('pending-count')).toHaveText('0');
  const r = await scan(scanner, participantToken);
  expect(r).toMatchObject({ decision: 'DENY', reasonCode: 'REVOKED' });
  results.push(r);
  const summary = await endShift(scanner);
  expect(summary).toContain('Turno terminado');
});

test('11 · host: auditoría verificada y reporte por puerta con los números de este scanner', async () => {
  const page = await ops.newPage();
  await adminLogin(page, 'audit');
  await adminGo(page, 'auditoria');
  await page.getByRole('button', { name: 'Verificar cadena' }).click();
  await expect(page.locator('.ok-box')).toContainText(/Registro íntegro hasta el número \d+/);
  // Las acciones de este flujo quedaron en la cadena.
  await page.getByLabel('Acción').selectOption('CREDENTIAL_REVOKED');
  await expect(page.locator('table tbody tr').first()).toContainText(participantId);

  // Reporte por puerta: coincide con lo que este scanner decidió.
  const admin = await host.login('admin');
  const devices = await host.get<{ id: string; name: string; lastSeq: number }[]>('/devices', admin);
  const me = devices.find((d) => d.name === deviceName)!;
  expect(me).toBeTruthy();
  const report = await host.get<{ byDevice: Record<string, Record<string, number>>; byZone: Record<string, Record<string, number>>; byReason: Record<string, number> }>('/reports/gate-summary', admin);
  const mine = report.byDevice[me.id];
  const expected = { ALLOW: results.filter((x) => x.decision === 'ALLOW').length, DENY: results.filter((x) => x.decision === 'DENY').length };
  expect(mine).toMatchObject(expected);
  expect(mine.EVENT).toBeGreaterThanOrEqual(5); // shift_start, mode_change ×2, zone_change, shift_end
  expect(report.byReason.ANTI_PASSBACK).toBeGreaterThanOrEqual(1);
  expect(report.byReason.REVOKED).toBeGreaterThanOrEqual(1);
  expect(report.byReason.OK_EXIT).toBeGreaterThanOrEqual(1);
  expect(me.lastSeq).toBe(results.length + mine.EVENT);
  // Puertas en vivo muestra el scanner con sus rechazos.
  await adminGo(page, 'puertas');
  const row = page.locator('table tbody tr').filter({ hasText: deviceName });
  await expect(row).toBeVisible();
  await expect(row.locator('td').nth(4)).toHaveText(String(expected.DENY));
  await page.close();
});
});
