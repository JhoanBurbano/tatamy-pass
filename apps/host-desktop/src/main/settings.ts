/**
 * Ajustes de la app (`config/settings.json`): carga tolerante con valores por
 * defecto, validación con mensajes humanos y traducción a las variables de
 * entorno que lee `apps/host`. Sin Electron: se prueba con Vitest.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FieldError, HostMode, Settings } from '../shared/ipc.js';
import type { DataPaths } from './paths.js';

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  setupDone: false,
  siteName: '',
  mode: 'primary',
  primaryUrl: '',
  replicaKey: '',
  port: 8787,
  httpsEnabled: true,
  httpsPort: 8443,
  cloudUrl: '',
  cloudKey: '',
  cloudIntervalMinutes: 5,
  backupsDir2: '',
  launchAtLogin: false,
  eventConfigPath: ''
};

export function loadSettings(file: string): Settings {
  if (!existsSync(file)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...pick(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function pick(raw: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = raw[k];
    if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function saveSettings(file: string, s: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

const URL_RE = /^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/i;

/** Valida un conjunto de ajustes. Devuelve errores por campo en español humano. */
export function validateSettings(s: Settings): FieldError[] {
  const errors: FieldError[] = [];
  if (!Number.isInteger(s.port) || s.port < 1024 || s.port > 65535) errors.push({ path: 'port', message: 'El puerto debe ser un número entre 1024 y 65535.' });
  if (!Number.isInteger(s.httpsPort) || s.httpsPort < 1 || s.httpsPort > 65535) errors.push({ path: 'httpsPort', message: 'El puerto HTTPS debe ser un número entre 1 y 65535.' });
  if (s.httpsEnabled && s.httpsPort === s.port) errors.push({ path: 'httpsPort', message: 'El puerto HTTPS no puede ser el mismo que el del host.' });
  if (s.mode === 'standby') {
    if (!s.primaryUrl.trim()) errors.push({ path: 'primaryUrl', message: 'Como equipo de respaldo necesitas la dirección del principal (p. ej. http://10.10.0.2:8787).' });
    else if (!URL_RE.test(s.primaryUrl.trim())) errors.push({ path: 'primaryUrl', message: 'La dirección del principal debe empezar por http:// o https://.' });
    if (!s.replicaKey.trim()) errors.push({ path: 'replicaKey', message: 'Falta la clave de replicación: es la misma que tiene el principal.' });
  }
  if (s.cloudUrl.trim() && !URL_RE.test(s.cloudUrl.trim())) errors.push({ path: 'cloudUrl', message: 'La dirección de la nube debe empezar por https://.' });
  if (s.cloudUrl.trim() && !s.cloudKey.trim()) errors.push({ path: 'cloudKey', message: 'Falta la clave de la nube (TP_CLOUD_KEY).' });
  if (!Number.isFinite(s.cloudIntervalMinutes) || s.cloudIntervalMinutes < 0 || s.cloudIntervalMinutes > 1440) errors.push({ path: 'cloudIntervalMinutes', message: 'El intervalo va de 0 (solo manual) a 1440 minutos.' });
  if (s.backupsDir2.trim() && !existsSync(s.backupsDir2.trim())) errors.push({ path: 'backupsDir2', message: 'No encuentro esa carpeta. Conecta la USB o elige otra.' });
  if (s.eventConfigPath.trim() && !existsSync(s.eventConfigPath.trim())) errors.push({ path: 'eventConfigPath', message: 'No encuentro ese archivo de evento.' });
  return errors;
}

/** Qué ajustes obligan a reiniciar el host para aplicarse. */
export const RESTART_KEYS: (keyof Settings)[] = ['mode', 'primaryUrl', 'replicaKey', 'port', 'cloudUrl', 'cloudKey', 'cloudIntervalMinutes', 'backupsDir2', 'eventConfigPath', 'httpsEnabled', 'httpsPort'];

export function needsRestart(before: Settings, after: Settings): boolean {
  return RESTART_KEYS.some((k) => before[k] !== after[k]);
}

/** Variables de entorno para `apps/host` (ver docs/80 §2). */
export function settingsToEnv(s: Settings, paths: DataPaths, passphrase: string, nativeBinding?: string): Record<string, string> {
  const env: Record<string, string> = {
    NODE_ENV: 'production',
    PORT: String(s.port),
    HOST: '0.0.0.0',
    TP_DB_PATH: paths.db,
    TP_KEYS_DIR: paths.keysDir,
    TP_BACKUPS_DIR: paths.backupsDir,
    TP_EVENT_CONFIG: s.eventConfigPath.trim() || paths.configFile,
    TP_KEY_PASSPHRASE: passphrase,
    TP_ROLE: s.mode,
    TP_CLOUD_INTERVAL_MIN: String(s.cloudIntervalMinutes)
  };
  if (s.backupsDir2.trim()) env.TP_BACKUPS_DIR_2 = s.backupsDir2.trim();
  if (s.cloudUrl.trim()) env.TP_CLOUD_URL = s.cloudUrl.trim();
  if (s.cloudKey.trim()) env.TP_CLOUD_KEY = s.cloudKey.trim();
  if (s.replicaKey.trim()) env.TP_REPLICA_KEY = s.replicaKey.trim();
  if (s.mode === 'standby' && s.primaryUrl.trim()) env.TP_PRIMARY_URL = s.primaryUrl.trim().replace(/\/$/, '');
  if (nativeBinding) env.TP_SQLITE_NATIVE_BINDING = nativeBinding;
  return env;
}

export function isMode(v: unknown): v is HostMode { return v === 'primary' || v === 'standby'; }
