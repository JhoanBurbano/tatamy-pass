/**
 * Puertos y URLs de la suite e2e (distintos de los de desarrollo para no chocar).
 *
 * Contra un ecosistema ya desplegado se pueden sobrescribir con variables de entorno;
 * entonces Playwright no levanta nada (`webServer` vacío) y las specs que necesitan el
 * proxy controlable o hosts extra se saltan solas (`EXTERNAL`):
 *
 *   E2E_BASE_HOST=https://host.tatamipass.co      (host; la API directa y el proxy son la misma URL)
 *   E2E_BASE_SCANNER=https://scanner.tatamipass.co
 *   E2E_BASE_REGISTRATION=https://inscripciones.tatamipass.co
 *   E2E_CLOUD_KEY=<x-tatami-key de la nube>       E2E_CLOUD_ADMIN_EMAIL / E2E_CLOUD_ADMIN_PASSWORD
 */
const env = (k: string): string | undefined => (process.env[k] ?? '').trim().replace(/\/$/, '') || undefined;

export const E2E = {
  hostPort: Number(process.env.E2E_HOST_PORT || 8790),
  proxyPort: Number(process.env.E2E_PROXY_PORT || 8797),
  controlPort: Number(process.env.E2E_CONTROL_PORT || 8798),
  scannerPort: Number(process.env.E2E_SCANNER_PORT || 5174),
  registrationPort: Number(process.env.E2E_REGISTRATION_PORT || 3100),
  cloudKey: process.env.E2E_CLOUD_KEY || 'e2e-secreto',
  replicaKey: 'e2e-replica',
  cloudAdmin: { email: process.env.E2E_CLOUD_ADMIN_EMAIL || 'admin@e2e.local', password: process.env.E2E_CLOUD_ADMIN_PASSWORD || 'E2e-admin-123456' }
} as const;

/** `true` cuando la suite corre contra URLs externas (no levanta servidores ni hay proxy). */
export const EXTERNAL = Boolean(env('E2E_BASE_HOST') || env('E2E_BASE_SCANNER') || env('E2E_BASE_REGISTRATION'));

/** Host visto por el scanner (en local, el proxy controlable). */
export const HOST_URL = env('E2E_BASE_HOST') ?? `http://localhost:${E2E.proxyPort}`;
/** Host directo (sin proxy), para la API de las specs. */
export const HOST_DIRECT_URL = env('E2E_BASE_HOST') ?? `http://127.0.0.1:${E2E.hostPort}`;
export const CONTROL_URL = `http://127.0.0.1:${E2E.controlPort}`;
export const SCANNER_URL = env('E2E_BASE_SCANNER') ?? `http://localhost:${E2E.scannerPort}`;
export const REGISTRATION_URL = env('E2E_BASE_REGISTRATION') ?? `http://localhost:${E2E.registrationPort}`;
/** Panel del host (misma app, servida en /admin). */
export const ADMIN_URL = `${HOST_DIRECT_URL}/admin/`;
