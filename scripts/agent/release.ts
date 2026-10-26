/**
 * Prepara una versión (Keep a Changelog + SemVer):
 *   1. Mueve el bloque `[Sin publicar]` de docs/99-CHANGELOG.md a `[X.Y.Z] — AAAA-MM-DD`
 *      y actualiza los enlaces de comparación del pie.
 *   2. Sube `version` en package.json raíz y en todos los workspaces.
 *   3. Crea el commit `chore(release): vX.Y.Z` y la etiqueta `vX.Y.Z` (solo con --commit).
 *
 * Uso:  npx tsx scripts/agent/release.ts <X.Y.Z> [--dry-run] [--commit] [--repo https://github.com/org/repo]
 * Sin `--commit` deja los archivos modificados para revisarlos; no hace push nunca.
 * Antes de correrlo: `npm run check` en verde y `git status` limpio.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..');
const args = process.argv.slice(2);
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const dry = args.includes('--dry-run');
const commit = args.includes('--commit');
const repoArg = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : undefined;
if (!version) { console.error('Uso: release.ts <X.Y.Z> [--dry-run] [--commit] [--repo URL]'); process.exit(1); }

const sh = (cmd: string) => execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim();
const today = new Date().toISOString().slice(0, 10);

// ---- changelog ----
const CHANGELOG = join(ROOT, 'docs', '99-CHANGELOG.md');
let log = readFileSync(CHANGELOG, 'utf8');
const unreleased = log.match(/## \[Sin publicar\]\n([\s\S]*?)(?=\n## \[)/);
if (!unreleased) { console.error('No encuentro la sección "## [Sin publicar]" en docs/99-CHANGELOG.md'); process.exit(1); }
const body = unreleased[1].trim();
if (!body) { console.error('"[Sin publicar]" está vacío: no hay nada que publicar.'); process.exit(1); }
if (log.includes(`## [${version}]`)) { console.error(`La versión ${version} ya existe en el changelog.`); process.exit(1); }
const prevMatch = log.match(/## \[(\d+\.\d+\.\d+)\]/);
const prev = prevMatch?.[1];
log = log.replace(/## \[Sin publicar\]\n[\s\S]*?(?=\n## \[)/, `## [Sin publicar]\n\n_Nada todavía._\n\n## [${version}] — ${today}\n\n${body}\n`);
// enlaces del pie
const repo = repoArg ?? (() => { try { return sh('git remote get-url origin').replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/'); } catch { return ''; } })();
if (repo) {
  log = log.replace(/\[Sin publicar\]: .*/, `[Sin publicar]: ${repo}/compare/v${version}...HEAD`);
  const newLink = prev ? `[${version}]: ${repo}/compare/v${prev}...v${version}` : `[${version}]: ${repo}/releases/tag/v${version}`;
  if (!log.includes(`[${version}]: `)) log = log.replace(/(\[Sin publicar\]: .*\n)/, `$1${newLink}\n`);
}

// ---- versiones ----
const pkgFiles = [join(ROOT, 'package.json')];
const rootPkg = JSON.parse(readFileSync(pkgFiles[0], 'utf8')) as { version: string; workspaces: string[] };
for (const ws of rootPkg.workspaces) {
  if (ws.endsWith('/*')) {
    const dir = join(ROOT, ws.slice(0, -2));
    if (existsSync(dir)) for (const d of readdirSync(dir)) { const p = join(dir, d, 'package.json'); if (existsSync(p)) pkgFiles.push(p); }
  } else { const p = join(ROOT, ws, 'package.json'); if (existsSync(p)) pkgFiles.push(p); }
}
const bumped: string[] = [];
for (const f of pkgFiles) {
  const txt = readFileSync(f, 'utf8');
  const next = txt.replace(/("version":\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`);
  if (next !== txt) { bumped.push(f.replace(ROOT + '/', '')); if (!dry) writeFileSync(f, next); }
}

if (dry) {
  console.log(`[release] dry-run · versión ${version} · fecha ${today} · anterior ${prev ?? '—'}`);
  console.log(`[release] bloque que se publicaría:\n${body}\n`);
  console.log(`[release] package.json a subir: ${bumped.join(', ')}`);
  process.exit(0);
}
writeFileSync(CHANGELOG, log);
console.log(`✔ docs/99-CHANGELOG.md: [${version}] — ${today}`);
console.log(`✔ versión ${version} en: ${bumped.join(', ')}`);
try { sh('npm install --package-lock-only --ignore-scripts --no-audit --no-fund'); console.log('✔ package-lock.json actualizado'); } catch { console.log('· package-lock.json no se pudo actualizar (sin red); hazlo con npm install'); }

if (commit) {
  sh('git add -A docs/99-CHANGELOG.md package.json package-lock.json ' + bumped.join(' '));
  sh(`git commit -m "chore(release): v${version}" -m "Changelog y versiones de los workspaces."`);
  sh(`git tag -a v${version} -m "Tatami Pass v${version}"`);
  console.log(`✔ commit y etiqueta v${version} creados. Pendiente (manual): git push --follow-tags`);
} else {
  console.log(`· Sin --commit: revisa el diff y luego:  git add -A && git commit -m "chore(release): v${version}" && git tag -a v${version} -m "Tatami Pass v${version}"`);
}
