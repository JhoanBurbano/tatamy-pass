/**
 * Host de pruebas e2e: `buildApp` de apps/host sobre una base SQLite temporal, con
 * seed reducido y clave de firma conocida, y (opcional) un proxy controlable delante
 * para simular "host apagado / host vuelve".
 *
 * Lo usa `playwright.config.ts` (host principal, vía webServer) y `helpers.spawnHost()`
 * (hosts extra por spec: standby, restaurado, purga). Todo se configura por entorno:
 *
 *   E2E_HOST_PORT       puerto del host real (127.0.0.1)                         [8790]
 *   E2E_PROXY_PORT      puerto del proxy controlable; vacío = sin proxy            [8797]
 *   E2E_CONTROL_PORT    puerto de control del proxy (/__e2e/{down,up,status})     [8798]
 *   E2E_HOST_DIR        carpeta de datos (base, copias); se borra al arrancar      [e2e/.tmp/host]
 *   E2E_DB_PATH         base a usar en vez de <dir>/tatami.db (p. ej. una restaurada)
 *   E2E_BACKUPS_DIR     carpeta de copias (por defecto <dir>/backups)
 *   E2E_KEEP_DIR=1      no borrar la carpeta al arrancar
 *   E2E_SIGNING_KEY     ruta a un JSON {kid, privateKeyHex, publicKeyHex}; si no existe se genera y escribe
 *   E2E_SEED            credenciales del seed (0 = ninguna)                      [300]
 *   E2E_HOST_MODE       primary | standby                                         [primary]
 *   E2E_PRIMARY_URL     (standby) URL del principal
 *   E2E_REPLICA_KEY     clave de replicación (principal y respaldo)
 *   E2E_CLOUD_URL/KEY   nube (apps/registration) para `POST /sync/cloud/pull`
 *   E2E_CONFIG_PATCH    JSON que se mezcla sobre event.config.json (p. ej. {"endDate":"2020-01-01"})
 *   E2E_SEED_INFO       ruta donde escribir seed.json                             [<dir>/../seed.json]
 *   TP_RETENTION_DAYS   lo lee el propio host (purga)
 *
 *   host real   → http://127.0.0.1:${E2E_HOST_PORT}
 *   proxy       → http://localhost:${E2E_PROXY_PORT}   (lo que usa el scanner)
 *   control     → http://127.0.0.1:${E2E_CONTROL_PORT}/__e2e/{down,up,status}
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultConfig, generateKeyPair, type EventConfig, type KeyPair } from '@tatami/core';
import { buildApp } from '../../apps/host/src/server.js';
import { USER_ROLES } from '../../apps/host/src/auth.js';
import { enrollDemoDevices, seedCredentials, SEED_USERS } from '../../apps/host/src/seed-data.js';
import { loadEventConfig } from '../../apps/host/src/config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const env = (k: string, d = ''): string => (process.env[k] ?? d).trim();
const num = (k: string, d: number): number => (env(k) === '' ? d : Number(env(k)));

const HOST_PORT = num('E2E_HOST_PORT', 8790);
const PROXY_PORT = env('E2E_PROXY_PORT') === '' ? (env('E2E_HOST_PORT') === '' ? 8797 : 0) : num('E2E_PROXY_PORT', 0);
const CONTROL_PORT = env('E2E_CONTROL_PORT') === '' ? (PROXY_PORT ? PROXY_PORT + 1 : 0) : num('E2E_CONTROL_PORT', 0);
const DIR = env('E2E_HOST_DIR') || join(HERE, '..', '.tmp', 'host');
const MODE = (env('E2E_HOST_MODE') || 'primary') as 'primary' | 'standby';
const SEED = num('E2E_SEED', 300);

if (env('E2E_KEEP_DIR') !== '1') rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

// El evento real es en noviembre de 2026; para que los QR sean válidos "hoy"
// el host de pruebas usa una vigencia amplia. Todo lo demás es la config real.
const base = loadEventConfig(join(ROOT, 'apps', 'host', 'event.config.json'));
const patch = env('E2E_CONFIG_PATCH') ? (JSON.parse(env('E2E_CONFIG_PATCH')) as Partial<EventConfig>) : {};
const config: EventConfig = { ...createDefaultConfig(), ...base, startDate: '2026-01-01', endDate: '2027-12-31', ...patch };

// Clave de firma: compartida entre hosts (standby/restaurado) y con las specs (QR rotativos).
const keyFile = env('E2E_SIGNING_KEY') || join(DIR, '..', 'signing-key.json');
let key: KeyPair;
if (existsSync(keyFile)) key = JSON.parse(readFileSync(keyFile, 'utf8')) as KeyPair;
else { key = generateKeyPair('k1'); mkdirSync(dirname(keyFile), { recursive: true }); writeFileSync(keyFile, JSON.stringify(key)); }

const app = await buildApp({
  dbPath: env('E2E_DB_PATH') || join(DIR, 'tatami.db'),
  config, signingKey: key, configPath: join(DIR, 'event.config.json'),
  backupsDir: env('E2E_BACKUPS_DIR') || join(DIR, 'backups'), backupsDir2: null,
  logger: false,
  cloud: { url: env('E2E_CLOUD_URL') || undefined, key: env('E2E_CLOUD_KEY') || undefined, intervalMinutes: 0 },
  mode: MODE, primaryUrl: env('E2E_PRIMARY_URL') || undefined, replicaKey: env('E2E_REPLICA_KEY') || undefined
});

let total = 0;
let photoCredentialId: string | null = null;
let byRole: Record<string, number> = {};
if (MODE === 'primary' && app.ctx.users.count() === 0) {
  for (const role of USER_ROLES) app.ctx.users.create(SEED_USERS[role].username, SEED_USERS[role].password, role);
}
if (MODE === 'primary' && SEED > 0 && app.ctx.credentials.count() === 0) {
  const seeded = seedCredentials(app.ctx, SEED);
  byRole = seeded.byRole;
  // Una credencial con foto (data URI) para probar que el scanner la muestra.
  const photoUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="92" height="116"><rect width="92" height="116" fill="#1C4FD1"/><circle cx="46" cy="44" r="20" fill="#C8F560"/></svg>');
  const withPhoto = app.ctx.persons.upsert({ id: 'p_e2e_photo', firstName: 'Foto', lastName: 'Prueba', birthDate: '1990-01-01', photoUrl, source: 'seed' });
  const photoCred = app.ctx.credentials.issue({ person: withPhoto, roleCode: 'GEN' });
  app.ctx.credentials.setStatus(photoCred.id, 'DELIVERED');
  photoCredentialId = photoCred.id;
  const devices = enrollDemoDevices(app.ctx);
  total = seeded.total + 1;
  app.ctx.audit.append('e2e', 'SEED_COMPLETED', { total, devices: devices.length });
}
writeFileSync(env('E2E_SEED_INFO') || join(DIR, '..', 'seed.json'), JSON.stringify({ photoCredentialId, total, byRole }));

if (MODE === 'standby') app.ctx.replica.start();
await app.listen({ port: HOST_PORT, host: '127.0.0.1' });
console.log(`[e2e] host ${MODE} en http://127.0.0.1:${HOST_PORT} · ${app.ctx.credentials.count()} credenciales · datos en ${DIR}`);

// ---- proxy controlable (solo si hay puerto) ----
let down = false;
let dropped = 0;
let proxy: http.Server | undefined;
let control: http.Server | undefined;
if (PROXY_PORT) {
  proxy = http.createServer((req, res) => {
    if (down) { dropped++; req.socket.destroy(); return; }
    const upstream = http.request(
      { host: '127.0.0.1', port: HOST_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${HOST_PORT}` } },
      (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); }
    );
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  // WebSocket (Tatami Radio): se reenvía el upgrade al host como túnel TCP; con el proxy "apagado"
  // se cortan también los sockets vivos (como si el host se hubiera ido).
  const tunnels = new Set<import('node:stream').Duplex>();
  proxy.on('upgrade', (req, socket, head) => {
    if (down) { dropped++; socket.destroy(); return; }
    const upstream = http.request({ host: '127.0.0.1', port: HOST_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${HOST_PORT}` } });
    upstream.on('upgrade', (res, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage}`, ...Object.entries(res.headers).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`))];
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (upHead.length) socket.write(upHead);
      upSocket.pipe(socket); socket.pipe(upSocket);
      tunnels.add(socket);
      const bye = () => { tunnels.delete(socket); socket.destroy(); upSocket.destroy(); };
      socket.on('close', bye); upSocket.on('close', bye); socket.on('error', bye); upSocket.on('error', bye);
    });
    upstream.on('response', (res) => { socket.write(`HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\nconnection: close\r\n\r\n`); socket.destroy(); });
    upstream.on('error', () => socket.destroy());
    if (head.length) upstream.write(head);
    upstream.end();
  });
  proxy.keepAliveTimeout = 1000;
  proxy.listen(PROXY_PORT, '127.0.0.1', () => console.log(`[e2e] proxy del host en http://localhost:${PROXY_PORT}`));

  control = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/__e2e/down')) { down = true; proxy!.closeAllConnections(); for (const t of tunnels) t.destroy(); tunnels.clear(); }
    else if (url.startsWith('/__e2e/up')) down = false;
    else if (!url.startsWith('/__e2e/status')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ down, dropped }));
  });
  control.listen(CONTROL_PORT, '127.0.0.1', () => console.log(`[e2e] control del proxy en http://localhost:${CONTROL_PORT}/__e2e/{down,up,status}`));
}

const shutdown = () => { control?.close(); proxy?.close(); void app.close().then(() => process.exit(0)); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
