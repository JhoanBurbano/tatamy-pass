// Descarga el binario de better-sqlite3 compilado para Electron (los
// "prebuilds" oficiales del proyecto) y lo deja en
// resources/native/<os>-<arch>/better_sqlite3.node. Así no hay que recompilar
// el better-sqlite3 de Node del monorepo (los tests siguen en verde) ni tener
// toolchain de C++. La app lo carga con TP_SQLITE_NATIVE_BINDING.
//
// Uso: node scripts/fetch-native.mjs [--all | --target linux-x64,win-x64] [--force]
// Si no hay prebuild para esa versión de Electron: `npm run rebuild:native` (compila).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RESOURCES, TARGETS, WORKSPACE, download, extract, log, targetsFromArgv } from './lib.mjs';

const require = createRequire(join(WORKSPACE, 'package.json'));
const hostRequire = createRequire(require.resolve('@tatami/host/package.json'));
const electronVersion = require('electron/package.json').version;
const sqliteVersion = hostRequire('better-sqlite3/package.json').version;
const nodeAbi = createRequire(require.resolve('prebuild-install/package.json'))('node-abi');
const abi = nodeAbi.getAbi(electronVersion, 'electron');
const force = process.argv.includes('--force');

let failed = 0;
for (const t of targetsFromArgv()) {
  const { platform, arch } = TARGETS[t];
  const dest = join(RESOURCES, 'native', t, 'better_sqlite3.node');
  if (existsSync(dest) && !force) { log(`✓ ${t}: ya está (${dest})`); continue; }
  const name = `better-sqlite3-v${sqliteVersion}-electron-v${abi}-${platform}-${arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${sqliteVersion}/${name}`;
  const tmp = mkdtempSync(join(tmpdir(), 'tp-native-'));
  try {
    log(`↓ ${t}: ${url}`);
    await download(url, join(tmp, name));
    extract(join(tmp, name), tmp);
    const built = join(tmp, 'build', 'Release', 'better_sqlite3.node');
    if (!existsSync(built)) throw new Error('el paquete no trae build/Release/better_sqlite3.node');
    mkdirSync(join(RESOURCES, 'native', t), { recursive: true });
    copyFileSync(built, dest);
    log(`✓ ${t}: better-sqlite3 ${sqliteVersion} para Electron ${electronVersion} (ABI ${abi})`);
  } catch (e) {
    failed++;
    log(`✗ ${t}: ${e.message}. Sin prebuild para Electron ${electronVersion} (ABI ${abi}): usa \`npm run rebuild:native\` o cambia la versión de Electron (docs/86 §7).`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
process.exit(failed && !process.argv.includes('--soft') ? 1 : 0);
