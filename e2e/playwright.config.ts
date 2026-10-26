import { defineConfig, devices } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair } from '@tatami/core';
import { E2E, EXTERNAL, HOST_URL, REGISTRATION_URL, SCANNER_URL } from './ports.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TMP = join(HERE, '.tmp');

const CI = !!process.env.CI;
/** E2E_SKIP_REGISTRATION=1 corre solo host + scanner (las specs de inscripción se saltan). El proyecto `perf` tampoco la necesita. */
const PROJECT = process.argv[process.argv.findIndex((a) => a === '--project') + 1];
const SKIP_REGISTRATION = process.env.E2E_SKIP_REGISTRATION === '1' || PROJECT === 'perf';
if (SKIP_REGISTRATION) process.env.E2E_SKIP_REGISTRATION = '1';

// ---- datos frescos por ejecución (solo cuando levantamos nosotros los servidores) ----
// Este archivo se evalúa en el proceso principal y otra vez en cada worker: la limpieza
// se hace una sola vez (el worker hereda E2E_PREPARED del principal).
if (!EXTERNAL && process.env.E2E_PREPARED !== '1') {
  process.env.E2E_PREPARED = '1';
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'registration'), { recursive: true });
  // Clave de firma compartida: host (firma QR), nube (QR digital rotativo) y specs (tokens de prueba).
  const key = generateKeyPair('k1');
  writeFileSync(join(TMP, 'signing-key.json'), JSON.stringify(key));
  // Config de la nube de pruebas: cupo pequeño en PRESS para "cupo lleno → lista de espera" (TC-007).
  // Las fechas deben caer dentro de la vigencia del host de pruebas (2026-01-01 → 2027-12-31) e incluir "hoy":
  // la nube firma el QR digital con SU startDate/endDate y el scanner lo rechaza fuera de vigencia.
  // 2026-10-01 mantiene las edades que comprueba TC-006 (nacida 2010-05-01 → 16; 2012-03-10 → 14).
  const eventConfig = JSON.parse(readFileSync(join(ROOT, 'apps', 'host', 'event.config.json'), 'utf8')) as { startDate: string; endDate: string; roles: { code: string; capacity: number | null }[] };
  eventConfig.startDate = '2026-10-01';
  eventConfig.endDate = '2027-12-31';
  for (const r of eventConfig.roles) if (r.code === 'PRESS') r.capacity = 2;
  writeFileSync(join(TMP, 'registration', 'event.config.json'), JSON.stringify(eventConfig, null, 2));
}
const SIGNING_KEY = EXTERNAL ? '' : readFileSync(join(TMP, 'signing-key.json'), 'utf8');

const built = (p: string) => existsSync(join(ROOT, p));
if (!EXTERNAL) {
  const missing = [
    ['apps/host/public/admin/index.html', 'npm run build -w apps/host-admin'],
    ['apps/scanner/dist-e2e/index.html', 'npm run build:e2e -w apps/scanner'],
    ...(SKIP_REGISTRATION ? [] : [['apps/registration/.next/BUILD_ID', 'npm run build -w apps/registration']])
  ].filter(([p]) => !built(p));
  if (missing.length) throw new Error(`Faltan builds para la suite e2e:\n${missing.map(([, c]) => `  ${c}`).join('\n')}\n(o usa npm run e2e / e2e:smoke, que los hacen antes).`);
}

/** Tatami Radio (TC-120): micrófono falso y permiso concedido sin diálogo. */
const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

export default defineConfig({
  testDir: './specs',
  // Las specs comparten un host con estado (anti-passback, revocaciones, reporte de cierre): en serie.
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: SCANNER_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    acceptDownloads: true
  },
  /**
   * Un solo navegador (Chromium) en tres "proyectos" que son filtros por etiqueta:
   *   full  → todo menos @perf (npm run e2e)             smoke → solo @smoke (npm run e2e:smoke, ≤ 3 min)
   *   perf  → solo @perf (npm run e2e:perf, no en CI por defecto)
   */
  projects: [
    { name: 'full', use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } }, grepInvert: /@perf/ },
    { name: 'smoke', use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } }, grep: /@smoke/ },
    { name: 'perf', use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } }, grep: /@perf/ }
  ],
  webServer: EXTERNAL ? [] : [
    {
      command: 'npx tsx scripts/host.ts',
      url: `${HOST_URL}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        E2E_HOST_PORT: String(E2E.hostPort), E2E_PROXY_PORT: String(E2E.proxyPort), E2E_CONTROL_PORT: String(E2E.controlPort),
        E2E_HOST_DIR: join(TMP, 'host'), E2E_SIGNING_KEY: join(TMP, 'signing-key.json'), E2E_SEED_INFO: join(TMP, 'seed.json'),
        E2E_REPLICA_KEY: E2E.replicaKey,
        E2E_CLOUD_URL: SKIP_REGISTRATION ? '' : REGISTRATION_URL, E2E_CLOUD_KEY: E2E.cloudKey
      }
    },
    {
      command: `npx vite preview --outDir dist-e2e --port ${E2E.scannerPort} --strictPort`,
      cwd: join(ROOT, 'apps', 'scanner'),
      url: SCANNER_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe'
    },
    ...(SKIP_REGISTRATION ? [] : [{
      command: `npx next start -p ${E2E.registrationPort}`,
      cwd: join(ROOT, 'apps', 'registration'),
      url: `${REGISTRATION_URL}/api/status`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        REGISTRATION_DB_PATH: join(TMP, 'registration', 'registration.db'),
        EVENT_CONFIG_PATH: join(TMP, 'registration', 'event.config.json'),
        MAIL_OUTBOX_DIR: join(TMP, 'registration', 'outbox'),
        PHOTOS_DIR: join(TMP, 'registration', 'photos'),
        TP_CLOUD_KEY: E2E.cloudKey,
        TP_SIGNING_KEY: SIGNING_KEY,
        SESSION_SECRET: 'e2e-session-secret-de-pruebas-con-mas-de-32-caracteres',
        ADMIN_EMAIL: E2E.cloudAdmin.email,
        ADMIN_PASSWORD: E2E.cloudAdmin.password,
        ADMIN_NAME: 'Coordinación E2E',
        APP_URL: REGISTRATION_URL,
        RATE_LIMIT_REGISTER: '1000',
        RATE_LIMIT_LOGIN: '1000'
      }
    } as const])
  ]
});
