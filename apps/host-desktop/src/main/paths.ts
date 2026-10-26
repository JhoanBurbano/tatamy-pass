/**
 * Rutas de datos de la app: todo vive bajo `<userData>/tatami` (base, claves,
 * copias, config, logs, Caddy). Función pura: recibe la carpeta y devuelve rutas.
 */
import { join } from 'node:path';

export interface DataPaths {
  root: string;
  db: string;
  keysDir: string;
  backupsDir: string;
  configFile: string;
  logsDir: string;
  logFile: string;
  settingsFile: string;
  secretsFile: string;
  caddyDir: string;
  caddyfile: string;
  /** XDG_DATA_HOME de Caddy: aquí deja su CA (`caddy/pki/authorities/local/root.crt`). */
  caddyHome: string;
  rootCert: string;
}

export function dataPaths(userData: string): DataPaths {
  const root = join(userData, 'tatami');
  const caddyDir = join(root, 'caddy');
  const caddyHome = join(caddyDir, 'home');
  return {
    root,
    db: join(root, 'db', 'tatami.db'),
    keysDir: join(root, 'keys'),
    backupsDir: join(root, 'backups'),
    configFile: join(root, 'config', 'event.config.json'),
    logsDir: join(root, 'logs'),
    logFile: join(root, 'logs', 'host.log'),
    settingsFile: join(root, 'config', 'settings.json'),
    secretsFile: join(root, 'keys', 'passphrase.enc'),
    caddyDir,
    caddyfile: join(caddyDir, 'Caddyfile'),
    caddyHome,
    rootCert: join(caddyHome, 'caddy', 'pki', 'authorities', 'local', 'root.crt')
  };
}

/** Carpeta de recursos empaquetados: `process.resourcesPath` en producción, `resources/` del workspace en dev. */
export function resourcesDir(isPackaged: boolean, resourcesPath: string, workspaceRoot: string): string {
  return isPackaged ? resourcesPath : join(workspaceRoot, 'resources');
}

/** Nombre de carpeta por plataforma (coincide con `${os}-${arch}` de electron-builder). */
export function platformDir(platform: NodeJS.Platform, arch: string): string {
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
  return `${os}-${arch}`;
}

export function nativeBindingPath(resources: string, platform: NodeJS.Platform, arch: string): string {
  return join(resources, 'native', platformDir(platform, arch), 'better_sqlite3.node');
}

export function caddyBinaryPath(resources: string, platform: NodeJS.Platform, arch: string): string {
  return join(resources, 'caddy', platformDir(platform, arch), platform === 'win32' ? 'caddy.exe' : 'caddy');
}
