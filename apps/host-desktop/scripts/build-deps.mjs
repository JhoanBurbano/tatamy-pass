// Compila lo que esta app empaqueta del monorepo: core, print, host y el panel
// (host-admin → apps/host/public/admin). Se ejecuta desde la raíz del repo.
//   node scripts/build-deps.mjs [--no-admin]
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { WORKSPACE, log } from './lib.mjs';

const root = join(WORKSPACE, '..', '..');
const ws = ['@tatami/core', '@tatami/print', '@tatami/host'];
if (!process.argv.includes('--no-admin')) ws.push('@tatami/host-admin');
for (const w of ws) {
  log(`→ build ${w}`);
  const r = spawnSync('npm', ['run', 'build', '-w', w], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { log(`✗ falló el build de ${w}`); process.exit(r.status ?? 1); }
}
