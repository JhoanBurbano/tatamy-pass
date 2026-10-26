/**
 * TC-072 · Matriz rol × página del panel del host (/admin): cada rol ve exactamente sus páginas,
 * cada página permitida carga sin error, y una página no permitida (enlace copiado a mano) no se
 * abre; el host responde 403 a los endpoints que el panel oculta.
 * TC-076 · Rol de acceso nuevo sin código: crear `VOL` (zonas G y S) en Evento y roles → el scanner lo
 * recibe tras el sync y una credencial `VOL` emitida en sitio pasa en G y no en T.
 */
import { expect, test, type Page } from '@playwright/test';
import { adminGo, adminLogin, enrollScanner, forceSync, host, scan } from '../helpers.js';
import { ADMIN_URL } from '../ports.js';

/** Misma matriz que apps/host-admin/src/App.tsx (PAGES) y docs/80 §2.1. */
const PAGES = ['puertas', 'credenciales', 'inscripciones', 'impresion', 'dispositivos', 'alertas', 'evento', 'nube', 'auditoria', 'sistema', 'usuarios'] as const;
const HEADINGS: Record<(typeof PAGES)[number], string> = {
  puertas: 'Puertas en vivo', credenciales: 'Credenciales', inscripciones: 'Inscripciones', impresion: 'Impresión', dispositivos: 'Dispositivos',
  alertas: 'Alertas', evento: 'Evento y roles', nube: 'Nube', auditoria: 'Auditoría', sistema: 'Sistema', usuarios: 'Usuarios'
};
const MATRIX: Record<string, (typeof PAGES)[number][]> = {
  admin: [...PAGES],
  coord: PAGES.filter((p) => p !== 'usuarios'),
  print: ['credenciales', 'inscripciones', 'impresion', 'nube'],
  super: ['puertas', 'credenciales', 'inscripciones', 'dispositivos', 'alertas'],
  audit: PAGES.filter((p) => p !== 'evento' && p !== 'usuarios')
};

async function pageLoads(page: Page, id: (typeof PAGES)[number]) {
  await adminGo(page, id);
  await expect(page.locator('.page h1, .page h2').first()).toContainText(HEADINGS[id]);
  await expect(page.locator('.page .error-box')).toHaveCount(0);
}

for (const [user, allowed] of Object.entries(MATRIX)) {
  test(`TC-072 ${user}: ve ${allowed.length} páginas y todas cargan; las demás no se abren`, async ({ page }) => {
    test.setTimeout(120_000);
    await adminLogin(page, user);
    const links = page.locator('aside.sb a[href^="#/"]');
    await expect(links).toHaveCount(allowed.length);
    expect((await links.evaluateAll((as) => as.map((a) => a.getAttribute('href')!.slice(2)))).sort()).toEqual([...allowed].sort());
    for (const id of allowed) await pageLoads(page, id);
    // Enlace copiado a mano a una página no permitida: el panel vuelve a la primera permitida.
    const forbidden = PAGES.find((p) => !allowed.includes(p));
    if (forbidden) {
      await page.goto(`${ADMIN_URL}#/${forbidden}`);
      await expect(page.locator('aside.sb a[aria-current="page"]')).toHaveAttribute('href', `#/${allowed[0]}`);
      await expect(page.locator('.page h1, .page h2').first()).not.toContainText(HEADINGS[forbidden]);
    }
    // El auditor no tiene botones de acción en Credenciales ni Sistema (solo lectura).
    if (user === 'audit') {
      await adminGo(page, 'sistema');
      await expect(page.getByRole('button', { name: 'Hacer copia ahora' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Purgar datos personales ahora' })).toHaveCount(0);
    }
  });
}

test('TC-072 el host aplica la matriz aunque el panel la oculte (403), y Control/Inscriptor no entran al panel', async ({ page }) => {
  const print = await host.login('print');
  expect((await host.getRaw('/users', print)).status).toBe(403);
  expect((await host.getRaw('/audit', print)).status).toBe(403);
  const audit = await host.login('audit');
  expect((await host.post('/backup/snapshot', audit, {})).status).toBe(403);
  expect((await host.post('/credentials/issue', audit, {})).status).toBe(403);
  const sup = await host.login('super');
  expect((await host.getRaw('/system/health', sup)).status).toBe(200);
  expect((await host.post('/sync/cloud/pull', sup, {})).status).toBe(403);
  expect((await host.getRaw('/users', await host.login('coord'))).status).toBe(403);
  // Sin sesión: 401.
  expect((await fetch(`${host.url}/credentials`)).status).toBe(401);
  // Control e Inscriptor pueden autenticarse pero no tienen páginas en el panel: aviso claro, sin pantalla rota.
  for (const u of ['control', 'club']) {
    await page.goto(ADMIN_URL);
    await page.getByLabel('Usuario').fill(u);
    await page.getByLabel('Contraseña').fill(`${u}123`);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('heading', { name: 'Este usuario no tiene páginas en el panel' })).toBeVisible();
    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await expect(page.locator('aside.sb a[href^="#/"]')).toHaveCount(0);
  }
});

test('TC-076 rol nuevo VOL creado en Evento y roles llega al scanner y decide por zona', async ({ page }) => {
  test.setTimeout(120_000);
  // Scanner enrolado antes del cambio: debe recibir el rol nuevo en el siguiente sync.
  await enrollScanner(page, { zone: 'G', name: 'E2E rol nuevo' });

  const panel = await page.context().newPage();
  await adminLogin(panel, 'admin');
  await adminGo(panel, 'evento');
  await panel.getByRole('button', { name: 'Nuevo rol' }).click();
  const row = panel.locator('table.cfg-table tbody tr').filter({ has: panel.getByLabel('Código de rol') }).last();
  await row.getByLabel('Código de rol').fill('VOL');
  await row.getByLabel('Nombre de rol').fill('Voluntario');
  // Zonas: G viene marcada por defecto; añadir S.
  await row.locator('.zones-pick').first().locator('label', { hasText: /^S$/ }).click();
  await row.getByLabel('Requiere foto').uncheck();
  await panel.getByRole('button', { name: 'Guardar' }).click();
  await expect(panel.locator('.toast')).toContainText(/guardad|Configuración/i);
  await expect(panel.locator('.error-box')).toHaveCount(0);
  await panel.close();
  const admin = await host.login('admin');
  const cfg = await host.get<{ config: { roles: { code: string; zones: string[]; name: string }[] } }>('/config', admin);
  expect(cfg.config.roles.find((r) => r.code === 'VOL')).toMatchObject({ name: 'Voluntario', zones: expect.arrayContaining(['G', 'S']) });

  // Emisión en sitio con el rol nuevo (sin reiniciar nada).
  const issued = await host.post<{ credential: { id: string; roleCode: string }; error?: string }>('/credentials/issue', admin, {
    firstName: 'Vale', lastName: 'Voluntaria E2E', birthDate: '1998-04-04', roleCode: 'VOL', documentNumber: 'VOL-E2E-1'
  });
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const cred = await host.credential(issued.body.credential.id);
  expect(cred.roleCode).toBe('VOL');

  // El scanner recibe config y credencial en el sync: verde en G, rojo en T.
  const st = await forceSync(page);
  expect(st.state).toBe('online');
  const ok = await scan(page, cred.token);
  expect(ok.decision, JSON.stringify(ok)).toBe('ALLOW');
  await expect(page.getByTestId('result-person')).toBeHidden(); // ya cerrada
  const admin2 = await host.login('admin');
  const devices = await host.get<{ id: string; name: string }[]>('/devices', admin2);
  const me = devices.find((d) => d.name === 'E2E rol nuevo')!;
  // Cambio de zona desde el panel (PATCH /devices/:id) queda en el host, pero HOY el snapshot del scanner no
  // trae la zona del dispositivo (RF-080 / TC-082 pendiente: ver docs/80 §9). La zona se cambia desde el scanner
  // con autorización de supervisor validada por el host.
  const patched = await fetch(`${host.url}/devices/${me.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin2}` }, body: JSON.stringify({ zone: 'T' }) });
  expect(patched.status).toBe(200);
  await page.getByTestId('menu-open').click();
  await page.getByTestId('menu-zone').click();
  await page.getByTestId('zone-T').click();
  await page.getByTestId('zone-confirm').click();
  await page.getByTestId('sup-user').fill('super');
  await page.getByTestId('sup-secret').fill('super123');
  await page.getByTestId('sup-confirm').click();
  await expect(page.getByTestId('device-pill')).toContainText('zona T');
  const no = await scan(page, cred.token);
  expect(no).toMatchObject({ decision: 'DENY', reasonCode: 'ZONE_NOT_ALLOWED' });
  expect(no.messageBody).toContain('Tatamis');
});
