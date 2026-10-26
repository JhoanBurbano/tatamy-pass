#!/usr/bin/env node
/**
 * Compila lo que la suite e2e necesita (panel del host, scanner en modo prueba y la nube).
 * Se salta con E2E_SKIP_BUILD=1 (si ya compilaste) o cuando la suite apunta a URLs externas.
 * Uso: node scripts/build.mjs [--no-registration]
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const external = ['E2E_BASE_HOST', 'E2E_BASE_SCANNER', 'E2E_BASE_REGISTRATION'].some((k) => (process.env[k] ?? '').trim());
if (process.env.E2E_SKIP_BUILD === '1' || external) {
  console.log(`[e2e] build omitido (${external ? 'ecosistema externo' : 'E2E_SKIP_BUILD=1'}).`);
  process.exit(0);
}
const skipRegistration = process.env.E2E_SKIP_REGISTRATION === '1' || process.argv.includes('--no-registration');
const steps = [
  ['panel del host', 'npm run build -w apps/host-admin'],
  ['scanner (modo prueba)', 'npm run build:e2e -w apps/scanner'],
  ...(skipRegistration ? [] : [['nube (next build)', 'npm run build -w apps/registration']])
];
const t0 = Date.now();
for (const [what, cmd] of steps) {
  const t = Date.now();
  process.stdout.write(`[e2e] compilando ${what}… `);
  execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  console.log(`${((Date.now() - t) / 1000).toFixed(0)} s`);
}
console.log(`[e2e] builds listos en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
