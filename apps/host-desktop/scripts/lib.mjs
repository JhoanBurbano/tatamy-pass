// Utilidades compartidas por los scripts de build: descargar (curl respeta
// HTTPS_PROXY; fetch de Node no), verificar checksums y extraer archivos.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RESOURCES = join(WORKSPACE, 'resources');

/** Objetivos electron-builder (`${os}-${arch}`) ↔ nombres de las descargas. */
export const TARGETS = {
  'linux-x64': { platform: 'linux', arch: 'x64', caddy: 'linux_amd64', ext: 'tar.gz' },
  'win-x64': { platform: 'win32', arch: 'x64', caddy: 'windows_amd64', ext: 'zip' },
  'mac-arm64': { platform: 'darwin', arch: 'arm64', caddy: 'mac_arm64', ext: 'tar.gz' },
  'mac-x64': { platform: 'darwin', arch: 'x64', caddy: 'mac_amd64', ext: 'tar.gz' }
};

export function currentTarget() {
  const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux';
  return `${os}-${process.arch}`;
}

/** `--all` → los cuatro; `--target a,b`; TP_TARGETS=...; por defecto el actual. */
export function targetsFromArgv(argv = process.argv.slice(2)) {
  if (argv.includes('--all')) return Object.keys(TARGETS);
  const i = argv.indexOf('--target');
  const list = i >= 0 ? argv[i + 1] : process.env.TP_TARGETS;
  if (list) return list.split(',').map((s) => s.trim()).filter((t) => t in TARGETS);
  return [currentTarget()];
}

export function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const r = spawnSync('curl', ['-fsSL', '--retry', '3', '-o', dest, url], { stdio: 'inherit' });
  if (r.status === 0 && existsSync(dest)) return true;
  // fallback sin curl (sin proxy)
  return fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  });
}

export function sha512(file) { return createHash('sha512').update(readFileSync(file)).digest('hex'); }
export function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

/** Extrae tar.gz o zip en `dir` (tar/bsdtar, unzip o python como respaldo). */
export function extract(archive, dir) {
  mkdirSync(dir, { recursive: true });
  const isZip = archive.endsWith('.zip');
  const tries = isZip
    ? [['unzip', ['-oq', archive, '-d', dir]], ['tar', ['-xf', archive, '-C', dir]], ['python3', ['-c', `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, archive, dir]]]
    : [['tar', ['-xzf', archive, '-C', dir]]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    if (r.status === 0) return true;
  }
  throw new Error(`No pude extraer ${archive} (instala tar/unzip).`);
}

export function log(m) { process.stdout.write(`${m}\n`); }
