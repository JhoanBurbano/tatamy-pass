/**
 * TC-094 (parte automatizable) · Copia de seguridad y restauración en un host nuevo:
 * Sistema › "Hacer copia ahora" (VACUUM INTO) → "Verificar" (integrity_check + conteos) →
 * restauración en frío con `npm run restore -- <copia> --yes` sobre una base vacía de otro host →
 * ese host arranca con los mismos datos (credenciales, escaneos, usuarios, auditoría íntegra y PII legible).
 */
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { adminGo, adminLogin, enrollScanner, EXTERNAL, forceSync, host, ROOT, scan, spawnHost, TMP, type SpawnedHost } from '../helpers.js';

test.skip(EXTERNAL, 'Levanta un segundo host en local y usa la carpeta de copias del principal.');

let restored: SpawnedHost | undefined;
test.afterAll(async () => { await restored?.stop(); });

test('TC-094 copia → verificar → restaurar en un host nuevo → datos presentes', async ({ page }) => {
  test.setTimeout(150_000);
  // Actividad propia para que haya algo que restaurar.
  await enrollScanner(page, { zone: 'P', name: 'E2E backup' });
  const cred = await host.pick('COMP', 30);
  expect((await scan(page, cred.token)).decision).toBe('ALLOW');
  expect((await forceSync(page)).pending).toBe(0);
  const admin = await host.login('admin');
  const before = await host.health();
  const detail = await host.get<{ person: { documentNumber?: string; birthDate?: string } }>(`/credentials/${cred.id}`, admin);
  expect(detail.person.documentNumber).toBeTruthy();

  // 1. Copia desde el panel.
  const panel = await page.context().newPage();
  await adminLogin(panel, 'admin');
  await adminGo(panel, 'sistema');
  await panel.getByRole('button', { name: 'Hacer copia ahora' }).click();
  await expect(panel.locator('.toast')).toContainText('Copia de seguridad creada');
  const row = panel.locator('table tbody tr').filter({ hasText: /^tatami-/ }).first();
  await expect(row).toBeVisible();
  const name = (await row.locator('td').first().textContent())!.trim();
  expect(name).toMatch(/^tatami-.*\.db$/);

  // 2. Verificar: íntegra y con los conteos actuales.
  await row.getByRole('button', { name: 'Verificar' }).click();
  await expect(panel.locator('.ok-box')).toContainText(/Copia íntegra: \d+ credenciales, \d+ personas, \d+ escaneos y \d+ registros de auditoría/);
  await expect(panel.locator('.ok-box')).toContainText(`${before.credentials} credenciales`);
  await panel.close();
  const list = await host.get<{ snapshots: { name: string }[]; dir: string }>('/backup/list', admin);
  expect(list.snapshots.map((s) => s.name)).toContain(name);

  // 3. Restauración en frío en un host nuevo (base vacía): `npm run restore -- <copia> --yes`.
  const dir = join(TMP, 'hosts', 'restaurado');
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, 'tatami.db');
  const out = execFileSync('npx', ['tsx', 'src/restore-cli.ts', name, '--yes'], {
    cwd: join(ROOT, 'apps', 'host'), encoding: 'utf8',
    env: { ...process.env, TP_DB_PATH: dbPath, TP_BACKUPS_DIR: list.dir }
  });
  expect(out).toContain('Copia:');
  expect(out).toContain('Base restaurada');
  restored = await spawnHost({ name: 'restaurado', dbPath, keepDir: true, seed: 0 });

  // 4. El host nuevo tiene los datos: usuarios, credenciales, escaneos, auditoría íntegra y PII descifrable.
  const h = await restored.api.health();
  expect(h.mode).toBe('primary');
  expect(h.credentials).toBe(before.credentials);
  expect(h.scans).toBeGreaterThanOrEqual(before.scans);
  expect(h.audit).toMatchObject({ ok: true });
  const admin2 = await restored.api.login('admin');
  const same = await restored.api.get<{ id: string; displayName: string; token: string; person: { documentNumber?: string } }>(`/credentials/${cred.id}`, admin2);
  expect(same.displayName).toBe(cred.displayName);
  expect(same.token).toBe(cred.token); // misma clave de firma → mismo QR
  expect(same.person.documentNumber).toBe(detail.person.documentNumber);
  const devices = await restored.api.get<{ name: string; lastSeq: number }[]>('/devices', admin2);
  expect(devices.find((d) => d.name === 'E2E backup')!.lastSeq).toBe(2);
  // El host restaurado también sirve el panel y queda operativo.
  await adminLogin(page, 'audit', { base: restored.url });
  await adminGo(page, 'sistema');
  await expect(page.getByText(/íntegro \(/)).toBeVisible();
});
