import { expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Credential, KeyPair } from '@tatami/core';
import { ADMIN_URL, CONTROL_URL, E2E, EXTERNAL, HOST_DIRECT_URL, HOST_URL, REGISTRATION_URL } from './ports.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const TMP = join(HERE, '.tmp');

export const PIN = '482913';

/** Las specs de inscripción se saltan cuando la suite corre con E2E_SKIP_REGISTRATION=1. */
export const SKIP_REGISTRATION = process.env.E2E_SKIP_REGISTRATION === '1';
/** Las specs que necesitan proxy controlable u hosts extra se saltan contra un ecosistema externo. */
export { EXTERNAL };

// ---------- host (API directa, sin pasar por el proxy) ----------

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T;
  return body;
}

export interface HostApi {
  url: string;
  login(username: string, password?: string): Promise<string>;
  get<T>(path: string, token: string): Promise<T>;
  getRaw(path: string, token: string): Promise<Response>;
  post<T>(path: string, token: string | undefined, body: unknown): Promise<{ status: number; body: T }>;
  put<T>(path: string, token: string | undefined, body: unknown): Promise<{ status: number; body: T }>;
  enrollToken(zone: string, role?: 'CONTROL' | 'SUPERVISOR', name?: string): Promise<string>;
  credentials(): Promise<Credential[]>;
  credential(id: string): Promise<Credential & { token: string }>;
  pick(roleCode: string, offset?: number): Promise<Credential & { token: string }>;
  health(): Promise<Record<string, unknown> & { ok: boolean; mode: string; lagSeconds: number | null; credentials: number; scans: number }>;
}

/** Cliente de la API del host para una URL dada (el principal de la suite o un host extra). */
export function hostApi(base: string): HostApi {
  const api: HostApi = {
    url: base,
    async login(username, password = `${username}123`) {
      const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      expect(res.ok, `login ${username} en ${base}`).toBeTruthy();
      return (await json<{ token: string }>(res)).token;
    },
    async getRaw(path, token) {
      return fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
    },
    async get<T>(path: string, token: string): Promise<T> {
      const res = await api.getRaw(path, token);
      expect(res.ok, `GET ${path} → ${res.status}`).toBeTruthy();
      return json<T>(res);
    },
    async post<T>(path: string, token: string | undefined, body: unknown) {
      const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return { status: res.status, body: await json<T>(res) };
    },
    async put<T>(path: string, token: string | undefined, body: unknown) {
      const res = await fetch(`${base}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      return { status: res.status, body: await json<T>(res) };
    },
    async enrollToken(zone, role = 'CONTROL', name = `E2E ${zone} ${Date.now().toString(36)}`) {
      const admin = await api.login('admin');
      const r = await api.post<{ token: string }>('/devices/enroll-token', admin, { name, zone, role });
      expect(r.status).toBe(200);
      return r.body.token;
    },
    /** Credenciales públicas del snapshot (como admin). */
    async credentials() {
      const admin = await api.login('admin');
      return (await api.get<{ credentials: Credential[] }>('/sync/snapshot', admin)).credentials;
    },
    /** Credencial con su token firmado (como admin). */
    async credential(id) {
      const admin = await api.login('admin');
      return api.get(`/credentials/${id}`, admin);
    },
    /**
     * Credencial n.º `offset` de un rol (orden estable por seq, incluidas las revocadas).
     * Cada spec usa offsets distintos para no pisarse (anti-passback y alerta de duplicado son reales).
     */
    async pick(roleCode, offset = 0) {
      const all = (await api.credentials()).filter((c) => c.roleCode === roleCode).sort((a, b) => a.seq - b.seq);
      const c = all[offset];
      expect(c, `credencial ${roleCode}[${offset}]`).toBeTruthy();
      return api.credential(c.id);
    },
    async health() {
      return (await fetch(`${base}/health`)).json();
    }
  };
  return api;
}

/** API del host principal de la suite. */
export const host = hostApi(HOST_DIRECT_URL);

export function signingKey(): KeyPair {
  return JSON.parse(readFileSync(join(TMP, 'signing-key.json'), 'utf8')) as KeyPair;
}

export function seedInfo(): { photoCredentialId: string; total: number } {
  return JSON.parse(readFileSync(join(TMP, 'seed.json'), 'utf8'));
}

// ---------- hosts extra por spec (standby, restaurado, purga) ----------

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

export interface SpawnedHost {
  /** URL directa del host (127.0.0.1). */
  url: string;
  port: number;
  dir: string;
  api: HostApi;
  proc: ChildProcess;
  log: string[];
  stop(): Promise<void>;
}

export interface SpawnHostOptions {
  name: string;
  mode?: 'primary' | 'standby';
  primaryUrl?: string;
  seed?: number;
  /** Base ya existente (p. ej. restaurada) en vez de una nueva. */
  dbPath?: string;
  backupsDir?: string;
  keepDir?: boolean;
  configPatch?: Record<string, unknown>;
  env?: Record<string, string>;
  cloud?: { url: string; key: string };
}

/**
 * Levanta otro host (`e2e/scripts/host.ts`) en un puerto libre con su propia carpeta en
 * `e2e/.tmp/hosts/<name>` y espera a que `/health` responda. Comparte la clave de firma de la
 * suite. Llama a `stop()` en `afterAll`.
 */
export async function spawnHost(opts: SpawnHostOptions): Promise<SpawnedHost> {
  const port = await freePort();
  const dir = join(TMP, 'hosts', opts.name);
  mkdirSync(dir, { recursive: true });
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    E2E_HOST_PORT: String(port), E2E_PROXY_PORT: '', E2E_CONTROL_PORT: '',
    E2E_HOST_DIR: dir, E2E_SIGNING_KEY: join(TMP, 'signing-key.json'), E2E_SEED_INFO: join(dir, 'seed.json'),
    E2E_SEED: String(opts.seed ?? 0), E2E_HOST_MODE: opts.mode ?? 'primary',
    E2E_PRIMARY_URL: opts.primaryUrl ?? '', E2E_REPLICA_KEY: E2E.replicaKey,
    E2E_DB_PATH: opts.dbPath ?? '', E2E_BACKUPS_DIR: opts.backupsDir ?? '', E2E_KEEP_DIR: opts.keepDir ? '1' : '',
    E2E_CONFIG_PATCH: opts.configPatch ? JSON.stringify(opts.configPatch) : '',
    E2E_CLOUD_URL: opts.cloud?.url ?? '', E2E_CLOUD_KEY: opts.cloud?.key ?? '',
    ...(opts.env ?? {})
  };
  const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
  const proc = spawn(tsx, [join(HERE, 'scripts', 'host.ts')], { cwd: HERE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log: string[] = [];
  proc.stdout?.on('data', (d: Buffer) => log.push(d.toString()));
  proc.stderr?.on('data', (d: Buffer) => log.push(d.toString()));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`El host "${opts.name}" terminó antes de arrancar:\n${log.join('')}`);
    try { const r = await fetch(`${url}/health`); if (r.ok) break; } catch { /* todavía no */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (proc.exitCode !== null) throw new Error(`El host "${opts.name}" no arrancó:\n${log.join('')}`);
  return {
    url, port, dir, proc, log, api: hostApi(url),
    stop: () => new Promise<void>((resolve) => {
      if (proc.exitCode !== null) return resolve();
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); resolve(); }, 5000).unref();
    })
  };
}

// ---------- proxy controlable (host "apagado") ----------

export const proxy = {
  async down() { await fetch(`${CONTROL_URL}/__e2e/down`); },
  async up() { await fetch(`${CONTROL_URL}/__e2e/up`); },
  async status(): Promise<{ down: boolean; dropped: number }> { return (await fetch(`${CONTROL_URL}/__e2e/status`)).json(); }
};

// ---------- nube (apps/registration) ----------

export const cloud = {
  async post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const res = await fetch(`${REGISTRATION_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
  },
  async get<T>(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
    const res = await fetch(`${REGISTRATION_URL}${path}`, { headers });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
  },
  async status<T = Record<string, unknown>>(): Promise<T> {
    return (await fetch(`${REGISTRATION_URL}/api/status`)).json();
  },
  /** Cabecera que usa el host (`x-tatami-key`). */
  key: { 'x-tatami-key': E2E.cloudKey },
  /** Correos escritos por la nube de pruebas (`.eml` en MAIL_OUTBOX_DIR), del más reciente al más antiguo. */
  outbox(): Array<{ file: string; text: string }> {
    const dir = join(TMP, 'registration', 'outbox');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.eml')).map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') })).reverse();
  }
};

/** Entra al panel de coordinación de la nube (`/panel/login`) con el admin de la suite. */
export async function cloudLogin(page: Page, creds = E2E.cloudAdmin): Promise<void> {
  await page.goto(`${REGISTRATION_URL}/panel/login`);
  await page.getByLabel('Correo').fill(creds.email);
  await page.getByLabel('Contraseña').fill(creds.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/panel\/inscripciones/);
}

// ---------- panel del host (/admin) ----------

/** Entra al panel del host con un usuario del seed. `base` permite otro host (standby, restaurado). */
export async function adminLogin(page: Page, username: string, opts: { password?: string; base?: string } = {}): Promise<void> {
  const base = opts.base ? `${opts.base}/admin/` : ADMIN_URL;
  await page.goto(base);
  await page.getByLabel('Usuario').fill(username);
  await page.getByLabel('Contraseña').fill(opts.password ?? `${username}123`);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('aside.sb')).toBeVisible({ timeout: 15_000 });
}

/** Navega a una página del panel por su id de hash (`#/credenciales`). */
export async function adminGo(page: Page, id: string): Promise<void> {
  await page.locator(`aside.sb a[href="#/${id}"]`).click();
  await expect(page.locator(`aside.sb a[href="#/${id}"]`)).toHaveAttribute('aria-current', 'page');
}

// ---------- scanner ----------

export interface E2EScanResult { decision: 'ALLOW' | 'DENY' | 'ALERT'; reasonCode: string; messageTitle: string; messageBody: string; credentialId: string | null; elapsedMs: number }

declare global {
  interface Window {
    __tpScan?: (raw: string, opts?: { direction?: 'IN' | 'OUT'; override?: string }) => Promise<E2EScanResult>;
    __tpSync?: () => Promise<{ state: string; pending: number; credentials: number; skewMs?: number }>;
    __tpStatus?: () => { state: string; pending: number; credentials: number };
  }
}

/** Enrola un scanner nuevo por la interfaz (host URL + código + PIN) y lo deja en la pantalla de escaneo. */
export async function enrollScanner(page: Page, opts: { zone: string; role?: 'CONTROL' | 'SUPERVISOR'; pin?: string; name?: string; hostUrl?: string; token?: string; api?: HostApi }): Promise<void> {
  const token = opts.token ?? await (opts.api ?? host).enrollToken(opts.zone, opts.role ?? 'CONTROL', opts.name);
  await page.goto('/');
  await expect(page.getByTestId('enroll-screen')).toBeVisible();
  await page.getByTestId('enroll-host').fill(opts.hostUrl ?? HOST_URL);
  await page.getByTestId('enroll-token').fill(token);
  await page.getByTestId('enroll-pin').fill(opts.pin ?? PIN);
  await page.getByTestId('enroll-pin2').fill(opts.pin ?? PIN);
  await page.getByTestId('enroll-submit').click();
  await expect(page.getByTestId('zone-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('zone-confirm').click();
  await expect(page.getByTestId('scan-screen')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__tpStatus?.().credentials ?? 0), { timeout: 20_000 }).toBeGreaterThan(0);
  await waitForScanner(page);
  // El inicio de turno deja un evento `shift_start` en la cola: se sube ya para que las specs cuenten solo sus escaneos.
  await forceSync(page);
}

/** Espera a que la pantalla Escanear haya registrado el modo prueba (`window.__tpScan`), p. ej. tras cambiar de zona. */
export async function waitForScanner(page: Page): Promise<void> {
  await expect(page.getByTestId('scan-screen')).toBeVisible();
  await page.waitForFunction(() => typeof window.__tpScan === 'function');
}

/** Inyecta una lectura (modo prueba) y devuelve la decisión. Cierra la pantalla de resultado. */
export async function scan(page: Page, raw: string, opts: { direction?: 'IN' | 'OUT'; override?: string } = {}): Promise<E2EScanResult> {
  await waitForScanner(page);
  const r = await page.evaluate(([raw, opts]) => window.__tpScan!(raw, opts), [raw, opts] as const);
  await expect(page.getByTestId('result')).toHaveAttribute('data-decision', r.decision);
  await page.getByTestId('result-next').click();
  await expect(page.getByTestId('scan-screen')).toBeVisible();
  return r;
}

export async function forceSync(page: Page) {
  return page.evaluate(() => window.__tpSync!());
}

export async function unlockWithPin(page: Page, pin = PIN) {
  await expect(page.getByTestId('pin-screen')).toBeVisible();
  for (const d of pin) await page.getByTestId('pin-screen').getByRole('button', { name: d, exact: true }).click();
}

/** Tras el PIN de un turno nuevo aparece "Inicio de turno" (quién, zona, modo): empieza sin cambios. */
export async function startShift(page: Page, operator?: string) {
  await expect(page.getByTestId('zone-screen')).toBeVisible();
  if (operator) await page.getByTestId('operator-input').fill(operator);
  await page.getByTestId('zone-confirm').click();
  await expect(page.getByTestId('scan-screen')).toBeVisible();
}

/** Escribe el PIN de supervisor en la hoja de autorización (dispositivo enrolado como SUPERVISOR). */
export async function supervisorPin(page: Page, pin = PIN) {
  await expect(page.getByTestId('supervisor-auth')).toBeVisible();
  for (const d of pin) await page.getByTestId(`sup-key-${d}`).click();
}

/** Cambia el modo de la puerta (Entrada / Salida / Entrada+Salida) con PIN de supervisor local. */
export async function setMode(page: Page, mode: 'IN' | 'OUT' | 'BOTH', pin = PIN) {
  await page.getByTestId('menu-open').click();
  await page.getByTestId('menu-zone').click();
  await page.getByTestId(`mode-${mode}`).click();
  await page.getByTestId('zone-confirm').click();
  await supervisorPin(page, pin);
  await expect(page.getByTestId('scan-screen')).toHaveAttribute('data-mode', mode);
}

/** Termina el turno desde el menú y vuelve a la pantalla de PIN; devuelve el texto del resumen. */
export async function endShift(page: Page): Promise<string> {
  await page.getByTestId('menu-open').click();
  await page.getByTestId('menu-end-shift').click();
  await expect(page.getByTestId('shift-summary')).toContainText('Turno terminado');
  const text = (await page.getByTestId('shift-summary').textContent()) ?? '';
  await page.getByTestId('summary-close').click();
  await expect(page.getByTestId('pin-screen')).toBeVisible();
  return text;
}

export function tamperSignature(token: string): string {
  const last = token[token.length - 1];
  return token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
}

/**
 * Foto de prueba para el formulario de inscripción: PNG de 400 × 500 px (el recorte exige ≥ 300 px por
 * lado) generado en memoria, fondo claro con un "rostro" de color, sin dependencias.
 */
export function testPhoto(width = 400, height = 500): Buffer {
  const crc = (buf: Buffer): number => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filtro none
    for (let x = 0; x < width; x++) {
      const o = y * (width * 3 + 1) + 1 + x * 3;
      const inFace = (x - width / 2) ** 2 / 120 ** 2 + (y - height / 2) ** 2 / 160 ** 2 < 1;
      raw[o] = inFace ? 0xc8 : 0xee; raw[o + 1] = inFace ? 0xf5 : 0xf2; raw[o + 2] = inFace ? 0x60 : 0xf6;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
