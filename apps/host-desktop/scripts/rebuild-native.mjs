// Respaldo cuando no hay prebuild de better-sqlite3 para la versión de Electron:
// compila con @electron/rebuild (necesita Python 3 y un compilador de C++:
// Xcode Command Line Tools en Mac, Visual Studio Build Tools en Windows), copia
// el binario a resources/native/<os>-<arch>/ y vuelve a dejar el better-sqlite3
// del monorepo compilado para Node (para que `npm test` siga funcionando).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { RESOURCES, WORKSPACE, currentTarget, log } from './lib.mjs';

const require = createRequire(join(WORKSPACE, 'package.json'));
const electronVersion = require('electron/package.json').version;
const hostRequire = createRequire(require.resolve('@tatami/host/package.json'));
const pkgDir = dirname(hostRequire.resolve('better-sqlite3/package.json'));
const built = join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
const target = currentTarget();
const dest = join(RESOURCES, 'native', target, 'better_sqlite3.node');

const run = (cmd, args) => { log(`$ ${cmd} ${args.join(' ')}`); const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }); if (r.status !== 0) throw new Error(`${cmd} terminó con código ${r.status}`); };

try {
  run('npx', ['electron-rebuild', '-v', electronVersion, '-m', pkgDir, '--only', 'better-sqlite3']);
  if (!existsSync(built)) throw new Error(`no apareció ${built}`);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(built, dest);
  log(`✓ ${target}: binario para Electron ${electronVersion} en ${dest}`);
} finally {
  // Deja el paquete como estaba para Node (los tests del host lo usan).
  spawnSync('npm', ['rebuild', 'better-sqlite3'], { stdio: 'inherit', cwd: join(WORKSPACE, '..', '..'), shell: process.platform === 'win32' });
}
