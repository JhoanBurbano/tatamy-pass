// Prueba de humo de la app completa con Playwright (_electron): primera
// ejecución por el asistente (demo), "Host corriendo", QR de enrolamiento y
// captura de pantalla. Sin pantalla (Linux CI) se relanza bajo xvfb-run.
//
//   npm run smoke -w apps/host-desktop            # app en dev (dist/ + electron del node_modules)
//   TP_SMOKE_BIN=release/linux-unpacked/tatami-pass-host npm run smoke   # binario empaquetado
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { WORKSPACE, log } from './lib.mjs';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.TP_SMOKE_INNER) {
  const r = spawnSync('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, TP_SMOKE_INNER: '1' } });
  process.exit(r.status ?? 1);
}

const { _electron: electron } = await import('playwright');
const userData = mkdtempSync(join(tmpdir(), 'tp-smoke-'));
const shots = join(WORKSPACE, 'release', 'smoke');
mkdirSync(shots, { recursive: true });
const bin = process.env.TP_SMOKE_BIN ?? createRequire(join(WORKSPACE, 'package.json'))('electron');
const args = process.env.TP_SMOKE_BIN ? [] : ['.'];
const env = { ...process.env, TP_DESKTOP_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
if (process.platform === 'linux') args.push('--no-sandbox');

const app = await electron.launch({ executablePath: bin, args, cwd: WORKSPACE, env, timeout: 60_000 });
let failed = false;
try {
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  log(`título: ${await page.title()}`);
  await page.waitForSelector('#wizard:not(.hidden)', { timeout: 20_000 });
  await page.screenshot({ path: join(shots, '01-asistente.png') });
  await page.fill('#wSite', 'Coliseo de prueba');
  await page.click('#wNext');
  await page.fill('#wPass', 'passphrase-humo-12345678');
  await page.fill('#wPass2', 'passphrase-humo-12345678');
  await page.click('#wNext');
  await page.check('input[name=wSource][value=demo]');
  await page.click('#wNext');
  await page.click('#wNext'); // terminar
  await page.waitForFunction(() => document.getElementById('statusText')?.textContent?.includes('Host corriendo'), null, { timeout: 60_000 });
  await page.waitForFunction(() => (document.getElementById('counts')?.textContent ?? '').includes('2000 credenciales'), null, { timeout: 30_000 });
  log(`estado: ${await page.textContent('#statusText')} · ${await page.textContent('#counts')}`);
  await page.fill('#enrollForm input[name=name]', 'Puerta humo');
  await page.click('#enrollForm button[type=submit]');
  await page.waitForSelector('#qrBox img', { timeout: 15_000 });
  log(`enrolamiento: ${await page.textContent('#enrollToken')}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, '02-host-corriendo.png') });
  const urls = await page.textContent('#urls');
  log(`urls: ${urls?.trim().split('\n')[0]}`);
  const https = await page.textContent('#httpsBadge');
  log(`https: ${https}`);
  log(`✓ smoke OK · capturas en ${shots}`);
} catch (e) {
  failed = true;
  log(`✗ smoke falló: ${e.message}`);
  try { const page = await app.firstWindow({ timeout: 5000 }); await page.screenshot({ path: join(shots, 'error.png') }); } catch { /* sin ventana */ }
} finally {
  try { await app.evaluate(({ app: a }) => { a.quit(); }); } catch { /* ya cerrada */ }
  try { await app.close(); } catch { /* */ }
  rmSync(userData, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
