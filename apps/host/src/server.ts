/**
 * Host de Tatami Pass: API Fastify + SQLite. Aquí se arma el contexto (base,
 * repos, claves, nube, réplica, copias) y se registran las rutas, que viven en
 * `routes/*.ts` agrupadas por tema. El panel (`apps/host-admin`) se sirve
 * estático en `/admin` desde el mismo origen.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Device, EventConfig, KeyPair } from '@tatami/core';
import { openDb, type Db } from './db.js';
import { AlertRepo, AuditRepo, CredentialRepo, DeviceRepo, MetaRepo, PersonRepo, PrintBatchRepo, ScanEventRepo, UserRepo, type User } from './repos.js';
import { USER_ROLES, type UserRole } from './auth.js';
import { HOST_ROOT, loadEventConfig, loadSigningKey, passphrase } from './config.js';
import { CloudSync, cloudSettingsFromEnv, type CloudSettings } from './cloud-sync.js';
import { PiiCipher, encryptExistingPii } from './pii.js';
import { BackupScheduler, backupSettingsFromEnv } from './backup.js';
import { Replica, applyReplication, resolveMode, type FetchJson, type HostMode } from './replication.js';
import { PurgeScheduler } from './purge.js';
import { BadgeTemplateStore } from './badge-template.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerSyncRoutes } from './routes/sync.js';
import { registerCloudRoutes } from './routes/cloud.js';
import { registerCredentialRoutes } from './routes/credentials.js';
import { registerPrintRoutes } from './routes/print.js';
import { registerLiveRoutes } from './routes/live.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerRadioRoutes } from './routes/radio.js';
import { RadioHub } from './radio.js';
import type { Guards } from './routes/shared.js';

const ADMIN_DIR = join(HOST_ROOT, 'public', 'admin');

export interface AppOptions {
  dbPath?: string;
  config?: EventConfig;
  /** Ruta donde se persiste event.config.json al guardar desde el panel. `null` = no persistir (tests). */
  configPath?: string | null;
  signingKey?: KeyPair;
  backupsDir?: string;
  /** Segundo destino de copias (USB). Por defecto TP_BACKUPS_DIR_2. */
  backupsDir2?: string | null;
  logger?: boolean;
  /** Nube (apps/registration). Por defecto se lee de TP_CLOUD_URL / TP_CLOUD_KEY / TP_CLOUD_INTERVAL_MIN. */
  cloud?: CloudSettings;
  /** Modo del host. Por defecto `meta.hostMode` o TP_ROLE (primary). */
  mode?: HostMode;
  primaryUrl?: string;
  replicaKey?: string;
  /** Transporte alternativo hacia el primario (tests en memoria). */
  replicaFetch?: FetchJson;
  piiPassphrase?: string;
  /** Ruta de `badge-template.json`. Por defecto junto a la base (`data/`) o `TP_BADGE_TEMPLATE`; `null` = solo en memoria (tests). */
  templatePath?: string | null;
}

export interface AppContext {
  db: Db;
  config: EventConfig;
  key: KeyPair;
  cipher: PiiCipher;
  users: UserRepo;
  persons: PersonRepo;
  credentials: CredentialRepo;
  devices: DeviceRepo;
  scans: ScanEventRepo;
  audit: AuditRepo;
  alerts: AlertRepo;
  batches: PrintBatchRepo;
  meta: MetaRepo;
  /** Plantilla de la credencial impresa (ADR-0009). */
  badgeTemplate: BadgeTemplateStore;
  backupsDir: string;
  backupsDir2: string | null;
  configPath: string | null;
  cloud: CloudSync;
  backups: BackupScheduler;
  purge: PurgeScheduler;
  mode: HostMode;
  replica: Replica;
  /** Tatami Radio: señalización de voz por la LAN (ADR-0010). */
  radio: RadioHub;
  replicaKey: string | undefined;
  startedAt: string;
  /** Sustituye la config en memoria (misma referencia: los repos la comparten) y opcionalmente la persiste. */
  applyConfig(next: EventConfig, opts?: { persist?: boolean }): EventConfig;
}

export function createContext(opts: AppOptions = {}): AppContext {
  const dbPath = opts.dbPath ?? process.env.TP_DB_PATH ?? join(process.cwd(), 'data', 'tatami.db');
  const db = openDb(dbPath);
  const templatePath = opts.templatePath !== undefined ? opts.templatePath : (process.env.TP_BADGE_TEMPLATE ?? (dbPath === ':memory:' ? null : join(dirname(dbPath), 'badge-template.json')));
  const key = opts.signingKey ?? loadSigningKey();
  const configPath = opts.configPath === undefined ? (process.env.TP_EVENT_CONFIG ?? join(HOST_ROOT, 'event.config.json')) : opts.configPath;
  const base = opts.config ?? loadEventConfig(configPath ?? undefined);
  const withKey = (c: EventConfig): EventConfig => ({ ...c, signingKeys: [{ kid: key.kid, publicKeyHex: key.publicKeyHex }, ...c.signingKeys.filter((k) => k.kid !== key.kid)] });
  const config: EventConfig = withKey(base);
  const cipher = PiiCipher.forDb(db, opts.piiPassphrase ?? passphrase());
  const meta = new MetaRepo(db);
  const ctx = {
    db, config, key, cipher,
    users: new UserRepo(db), persons: new PersonRepo(db, cipher), credentials: new CredentialRepo(db, config, key),
    devices: new DeviceRepo(db), scans: new ScanEventRepo(db), audit: new AuditRepo(db), alerts: new AlertRepo(db), batches: new PrintBatchRepo(db), meta,
    badgeTemplate: new BadgeTemplateStore(templatePath),
    backupsDir: opts.backupsDir ?? process.env.TP_BACKUPS_DIR ?? join(process.cwd(), 'backups'),
    backupsDir2: opts.backupsDir2 === undefined ? backupSettingsFromEnv().dir2 : opts.backupsDir2,
    configPath, replicaKey: opts.replicaKey ?? process.env.TP_REPLICA_KEY, startedAt: new Date().toISOString(),
    applyConfig(next: EventConfig, o: { persist?: boolean } = {}) {
      const merged = withKey(next);
      for (const k of Object.keys(ctx.config)) delete (ctx.config as unknown as Record<string, unknown>)[k];
      Object.assign(ctx.config, merged);
      if (o.persist && ctx.configPath) {
        const { signingKeys: _s, ...toFile } = merged;
        writeFileSync(ctx.configPath, JSON.stringify({ ...toFile, signingKeys: base.signingKeys }, null, 2) + '\n');
      }
      return ctx.config;
    }
  } as AppContext;
  ctx.mode = opts.mode ?? resolveMode(ctx);
  if (opts.mode) ctx.meta.set('hostMode', opts.mode);
  const cloudSettings = opts.cloud ?? cloudSettingsFromEnv();
  const storedInterval = ctx.meta.get('cloudIntervalMinutes');
  if (!opts.cloud && storedInterval !== undefined && Number.isFinite(Number(storedInterval))) cloudSettings.intervalMinutes = Number(storedInterval);
  ctx.cloud = new CloudSync(ctx, cloudSettings);
  ctx.replica = new Replica(ctx, opts.primaryUrl ?? process.env.TP_PRIMARY_URL?.replace(/\/$/, '') ?? null, ctx.replicaKey, opts.replicaFetch);
  ctx.backups = new BackupScheduler(ctx);
  ctx.purge = new PurgeScheduler(ctx);
  ctx.radio = new RadioHub(ctx);
  const mig = encryptExistingPii(db, cipher);
  if (mig.encrypted > 0) ctx.audit.append('system', 'PII_ENCRYPTED', { persons: mig.encrypted });
  return ctx;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
    device?: Device;
  }
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return undefined;
  return h.slice(7).trim();
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance & { ctx: AppContext }> {
  const ctx = createContext(opts);
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 4 * 1024 * 1024 }) as unknown as FastifyInstance & { ctx: AppContext };
  app.ctx = ctx;
  await app.register(cors, { origin: true, exposedHeaders: ['x-content-sha256', 'content-disposition'] });
  // Radio: el token viaja como subprotocolo; el servidor responde siempre `tatami-radio`.
  await app.register(websocket, { options: { handleProtocols: (protocols) => (protocols.has('tatami-radio') ? 'tatami-radio' : false), maxPayload: 256 * 1024 } });

  // ---- panel estático (/admin) ----
  if (existsSync(join(ADMIN_DIR, 'index.html'))) {
    await app.register(fastifyStatic, { root: ADMIN_DIR, prefix: '/admin/', decorateReply: true, index: ['index.html'] });
    app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/admin/') && req.method === 'GET') return reply.type('text/html').send(readFileSync(join(ADMIN_DIR, 'index.html')));
      return reply.code(404).send({ error: 'No existe esa ruta.' });
    });
  } else {
    app.get('/admin', async (_req, reply) => reply.code(503).type('text/plain').send('El panel no está compilado. Ejecuta: npm run build -w apps/host-admin'));
  }
  app.get('/panel', async (_req, reply) => reply.redirect('/admin/'));
  app.get('/', async (_req, reply) => reply.redirect('/admin/'));

  // ---- autenticación ----
  app.decorateRequest('user', undefined);
  app.decorateRequest('device', undefined);
  app.addHook('onRequest', async (req, reply) => {
    const token = bearer(req);
    if (!token) return;
    const user = ctx.users.bySession(token);
    if (user) { req.user = user; return; }
    const dev = ctx.devices.byToken(token);
    if (dev) {
      if (dev.disabledAt) return reply.code(401).send({ error: 'Este scanner está desactivado. Pide el scanner de reserva.' });
      const { token: _t, ...d } = dev;
      req.device = d;
      const pendingHeader = req.headers['x-tatami-pending'];
      const pending = typeof pendingHeader === 'string' && pendingHeader !== '' ? Number(pendingHeader) : undefined;
      ctx.devices.seen(dev.id, Number.isFinite(pending) ? pending : undefined);
    }
  });

  // En standby solo se aceptan lecturas, login y promoción: los cambios se hacen en el principal.
  const STANDBY_ALLOWED = new Set(['/auth/login', '/system/promote', '/devices/enroll']);
  app.addHook('preHandler', async (req, reply) => {
    if (ctx.mode !== 'standby' || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const path = req.url.split('?')[0];
    if (STANDBY_ALLOWED.has(path)) return;
    return reply.code(409).send({ error: `Este equipo es el de respaldo: los cambios se hacen en el principal${ctx.replica.primaryUrl ? ` (${ctx.replica.primaryUrl})` : ''}. Si el principal no responde, promueve este equipo desde Sistema.`, mode: 'standby' });
  });

  const guards: Guards = {
    requireUser: (roles: UserRole[]) => async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) return reply.code(401).send({ error: 'Inicia sesión para continuar.' });
      if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'Tu rol no tiene permiso para esta acción.' });
    },
    requireDeviceOrUser: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.device && !req.user) return reply.code(401).send({ error: 'Dispositivo no enrolado o sesión vencida.' });
    },
    requireReplica: async (req: FastifyRequest, reply: FastifyReply) => {
      const k = req.headers['x-tatami-replica-key'];
      if (ctx.replicaKey && typeof k === 'string' && k === ctx.replicaKey) return;
      if (req.user?.role === 'ADMIN') return;
      return reply.code(401).send({ error: 'Clave de replicación incorrecta.' });
    },
    audit: (actor: string, action: string, payload: unknown) => { if (ctx.mode === 'primary') ctx.audit.append(actor, action, payload); },
    hostUrl: (req: FastifyRequest) => `${req.protocol}://${req.headers.host ?? req.hostname}`,
    allRoles: USER_ROLES
  };

  registerAuthRoutes(app, ctx, guards);
  registerDeviceRoutes(app, ctx, guards);
  registerSyncRoutes(app, ctx, guards);
  registerCloudRoutes(app, ctx, guards);
  registerCredentialRoutes(app, ctx, guards);
  registerPrintRoutes(app, ctx, guards);
  registerLiveRoutes(app, ctx, guards);
  registerConfigRoutes(app, ctx, guards);
  registerReportRoutes(app, ctx, guards);
  registerAuditRoutes(app, ctx, guards);
  registerSystemRoutes(app, ctx, guards);
  registerRadioRoutes(app, ctx, guards);

  app.addHook('onClose', async () => { ctx.radio.stop(); ctx.cloud.stopScheduler(); ctx.replica.stop(); ctx.backups.stop(); ctx.purge.stop(); });
  return app;
}

export { applyReplication };
