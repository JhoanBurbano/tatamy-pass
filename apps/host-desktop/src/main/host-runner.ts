/**
 * Ejecuta el host (`apps/host`) dentro del proceso principal de Electron: pone
 * las variables de entorno que lee `createContext`, importa `buildApp`, escucha
 * en el puerto y arranca los programadores (copias, nube, purga o réplica).
 * También concentra las acciones que la ventana pide (copia ahora, traer de la
 * nube, promover, seed de demo).
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Settings } from '../shared/ipc.js';
import type { DataPaths } from './paths.js';
import { settingsToEnv } from './settings.js';

type HostModule = typeof import('@tatami/host/dist/server.js');
type BackupModule = typeof import('@tatami/host/dist/backup.js');
type ReplicationModule = typeof import('@tatami/host/dist/replication.js');
type SeedModule = typeof import('@tatami/host/dist/seed-data.js');
type AuthModule = typeof import('@tatami/host/dist/auth.js');
export type HostApp = Awaited<ReturnType<HostModule['buildApp']>>;
export type HostContext = HostApp['ctx'];

export interface HostRunnerDeps {
  log: (level: 'info' | 'warn' | 'error', m: string) => void;
  /** Para pruebas: módulos ya cargados. En producción se importan de `@tatami/host`. */
  modules?: { server: HostModule; backup: BackupModule; replication: ReplicationModule; seed: SeedModule; auth: AuthModule };
}

export class HostRunner {
  app: HostApp | null = null;
  starting = false;
  error: string | null = null;
  private mods: HostRunnerDeps['modules'] | null = null;

  constructor(private deps: HostRunnerDeps) {}

  get running(): boolean { return this.app !== null; }
  get ctx(): HostContext | null { return this.app?.ctx ?? null; }

  private async modules(): Promise<NonNullable<HostRunnerDeps['modules']>> {
    if (this.mods) return this.mods;
    if (this.deps.modules) { this.mods = this.deps.modules; return this.mods; }
    const [server, backup, replication, seed, auth] = await Promise.all([
      import('@tatami/host/dist/server.js'), import('@tatami/host/dist/backup.js'), import('@tatami/host/dist/replication.js'), import('@tatami/host/dist/seed-data.js'), import('@tatami/host/dist/auth.js')
    ]);
    this.mods = { server, backup, replication, seed, auth };
    return this.mods;
  }

  async start(settings: Settings, paths: DataPaths, passphrase: string, nativeBinding?: string): Promise<void> {
    if (this.app || this.starting) return;
    this.starting = true;
    this.error = null;
    let app: HostApp | null = null;
    try {
      for (const k of Object.keys(process.env)) if (k.startsWith('TP_')) delete process.env[k];
      Object.assign(process.env, settingsToEnv(settings, paths, passphrase, nativeBinding));
      for (const d of [join(paths.db, '..'), paths.keysDir, paths.backupsDir, join(paths.configFile, '..'), paths.logsDir]) mkdirSync(d, { recursive: true });
      const { server } = await this.modules();
      app = await server.buildApp({ logger: false });
      if (app.ctx.mode === 'standby') {
        this.deps.log('info', `Equipo de respaldo: replicando de ${app.ctx.replica.primaryUrl ?? '(sin dirección del principal)'} cada 10 s.`);
        app.ctx.replica.start();
      } else {
        app.ctx.cloud.startScheduler();
        app.ctx.backups.start((m) => this.deps.log('info', m));
        app.ctx.purge.start((m) => this.deps.log('info', m));
      }
      await app.listen({ port: settings.port, host: '0.0.0.0' });
      this.app = app;
      this.deps.log('info', `Host corriendo (${app.ctx.mode}) en el puerto ${settings.port} · evento "${app.ctx.config.name}".`);
      if (app.ctx.users.count() === 0 && app.ctx.mode === 'primary') this.deps.log('warn', 'Todavía no hay usuarios del panel. Abre el panel y crea el administrador, o usa el evento de demo.');
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      this.error = /EADDRINUSE/.test(msg) ? `El puerto ${settings.port} ya está en uso. Cierra el otro programa o cambia el puerto en Ajustes.` : `No pude arrancar el host: ${msg}`;
      this.deps.log('error', this.error);
      if (app) { try { await app.close(); app.ctx.db.close(); } catch { /* ya cerrado */ } }
      throw new Error(this.error);
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    const app = this.app;
    this.app = null;
    if (!app) return;
    try { await app.close(); } catch (e) { this.deps.log('warn', `Al cerrar el host: ${(e as Error).message}`); }
    try { app.ctx.db.close(); } catch { /* ya cerrada */ }
    this.deps.log('info', 'Host detenido.');
  }

  async backupNow(by = 'desktop'): Promise<string> {
    const ctx = this.requireCtx();
    const { backup } = await this.modules();
    const r = backup.takeSnapshot(ctx, by);
    backup.rotateBackups(ctx.backupsDir, ctx.backups.keep);
    backup.rotateBackups(ctx.backupsDir2, ctx.backups.keep);
    return r.secondary && !r.secondary.ok ? `Copia creada en ${ctx.backupsDir}, pero el segundo destino falló: ${r.secondary.error}` : `Copia de seguridad creada${r.secondary?.ok ? ' (también en el segundo destino)' : ''}: ${r.name}.`;
  }

  /** Copia ahora y la deja también en la carpeta elegida (USB). */
  async backupTo(dir: string): Promise<string> {
    const ctx = this.requireCtx();
    const { backup } = await this.modules();
    const r = backup.takeSnapshot(ctx, 'desktop');
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, basename(r.file));
    copyFileSync(r.file, dest);
    const v = backup.verifySnapshot(dest);
    if (!v.ok) throw new Error(`La copia en la USB no pasó la verificación (${v.integrity}). Prueba con otra USB.`);
    ctx.audit.append('desktop', 'BACKUP_COPIED_USB', { file: basename(dest), dir });
    return `Copia guardada en ${dest} y verificada: ${v.credentials} credenciales, ${v.scans} escaneos.`;
  }

  async cloudPullNow(): Promise<string> {
    const ctx = this.requireCtx();
    if (!ctx.cloud.configured) throw new Error('La nube no está configurada. Ponla en Ajustes (dirección y clave).');
    const r = await ctx.cloud.pull();
    if (!r.ok) throw new Error(r.error ?? 'No pude traer datos de la nube.');
    return `Nube al día: ${r.received} inscripciones recibidas, ${r.created} credenciales nuevas, ${r.updated} actualizadas.`;
  }

  async promote(): Promise<string> {
    const ctx = this.requireCtx();
    const { replication } = await this.modules();
    const r = replication.promote(ctx, 'desktop');
    ctx.cloud.startScheduler();
    ctx.backups.start((m) => this.deps.log('info', m));
    ctx.purge.start((m) => this.deps.log('info', m));
    this.deps.log('warn', `Equipo promovido a principal (${r.promotedAt}). Apunta los scanners a este equipo.`);
    return 'Este equipo ahora es el principal. Apunta cada scanner a la dirección de esta ventana (menú ⋯ › Cambiar dirección del host) y no vuelvas a encender el principal viejo como principal.';
  }

  /** Evento de demostración: usuarios por rol, 2.000 credenciales y 4 scanners (PIN 123456). */
  async seedDemo(): Promise<string> {
    const ctx = this.requireCtx();
    if (ctx.users.count() > 0) return 'La base ya tiene datos: no se vuelve a sembrar.';
    const { seed, auth } = await this.modules();
    for (const role of auth.USER_ROLES) { const u = seed.SEED_USERS[role]; ctx.users.create(u.username, u.password, role); }
    const { total, byRole } = seed.seedCredentials(ctx, 2000);
    seed.enrollDemoDevices(ctx);
    ctx.audit.append('seed', 'SEED_COMPLETED', { total, byRole });
    return `Evento de demo listo: ${total} credenciales, usuarios admin/admin123 y 4 scanners con PIN 123456.`;
  }

  private requireCtx(): HostContext {
    if (!this.app) throw new Error('El host no está corriendo. Revisa el error en los logs o reinícialo desde Ajustes.');
    return this.app.ctx;
  }
}

export function fileExists(p: string): boolean { return existsSync(p); }
