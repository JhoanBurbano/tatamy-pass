// Descarga Caddy (versión fija, checksum SHA-512 verificado contra el
// checksums.txt oficial) y lo deja en resources/caddy/<os>-<arch>/caddy[.exe].
// La app lo usa como proceso auxiliar para HTTPS en la LAN (`tls internal`).
// Si falla la descarga, la app sigue funcionando en HTTP: no es bloqueante.
//
// Uso: node scripts/fetch-caddy.mjs [--all | --target mac-arm64,win-x64] [--force]
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RESOURCES, TARGETS, download, extract, log, sha512, targetsFromArgv } from './lib.mjs';

export const CADDY_VERSION = '2.10.2';
const BASE = `https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}`;
const force = process.argv.includes('--force');

let failed = 0;
const tmp = mkdtempSync(join(tmpdir(), 'tp-caddy-'));
try {
  let sums = null;
  try {
    await download(`${BASE}/caddy_${CADDY_VERSION}_checksums.txt`, join(tmp, 'checksums.txt'));
    sums = Object.fromEntries(readFileSync(join(tmp, 'checksums.txt'), 'utf8').split('\n').filter(Boolean).map((l) => { const [h, n] = l.trim().split(/\s+/); return [n, h]; }));
  } catch (e) {
    log(`✗ No pude bajar checksums.txt (${e.message}); no se instala Caddy. La app funcionará en HTTP.`);
    process.exit(process.argv.includes('--soft') ? 0 : 1);
  }
  for (const t of targetsFromArgv()) {
    const { caddy, ext, platform } = TARGETS[t];
    const dest = join(RESOURCES, 'caddy', t, platform === 'win32' ? 'caddy.exe' : 'caddy');
    if (existsSync(dest) && !force) { log(`✓ ${t}: ya está (${dest})`); continue; }
    const name = `caddy_${CADDY_VERSION}_${caddy}.${ext}`;
    try {
      log(`↓ ${t}: ${BASE}/${name}`);
      await download(`${BASE}/${name}`, join(tmp, name));
      const expected = sums[name];
      if (!expected) throw new Error(`${name} no aparece en checksums.txt`);
      const actual = sha512(join(tmp, name));
      if (actual !== expected) throw new Error(`checksum incorrecto (esperado ${expected.slice(0, 12)}…, obtenido ${actual.slice(0, 12)}…)`);
      const out = join(tmp, t);
      extract(join(tmp, name), out);
      const bin = join(out, platform === 'win32' ? 'caddy.exe' : 'caddy');
      if (!existsSync(bin)) throw new Error('el archivo no trae el binario caddy');
      mkdirSync(join(RESOURCES, 'caddy', t), { recursive: true });
      copyFileSync(bin, dest);
      if (platform !== 'win32') chmodSync(dest, 0o755);
      log(`✓ ${t}: Caddy ${CADDY_VERSION} verificado (SHA-512).`);
    } catch (e) {
      failed++;
      log(`✗ ${t}: ${e.message}. Sin Caddy la app sirve en HTTP; vuelve a intentarlo con \`npm run fetch:caddy -- --target ${t}\`.`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed && !process.argv.includes('--soft') ? 1 : 0);
