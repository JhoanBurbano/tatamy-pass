/**
 * Sistema: salud, copias de seguridad (lista, crear, verificar, restaurar),
 * equipo de respaldo (promover) y purga de datos personales.
 */
import { diskInfo, findBackup, listBackups, restoreSnapshot, rotateBackups, takeSnapshot, verifySnapshot } from '../backup.js';
import { promote } from '../replication.js';
import { purgePii, retentionDaysFromEnv } from '../purge.js';
import { READERS, type RouteModule } from './shared.js';

export const registerSystemRoutes: RouteModule = (app, ctx, g) => {
  // ---- health público (sin sesión): lo usan scanners y el standby ----
  /** Salud pública (sin sesión): modo, retraso de réplica, conteos, integridad de la auditoría y último backup. La usan scanners y el respaldo. */
  app.get('/health', async () => {
    const lastBackupAt = ctx.meta.get('lastBackupAt') ?? listBackups(ctx.backupsDir)[0]?.at ?? null;
    const rep = ctx.replica.status();
    return {
      ok: true, event: ctx.config.eventId, mode: ctx.mode, role: ctx.mode, lagSeconds: ctx.mode === 'standby' ? rep.lagSeconds : 0, time: new Date().toISOString(),
      credentials: ctx.credentials.count(), scans: ctx.scans.count(), devices: ctx.devices.all().length, radio: ctx.radio.connected(),
      audit: ctx.audit.verify(), lastBackupAt, standby: ctx.mode === 'standby' ? rep : undefined
    };
  });

  /** Salud detallada para el panel: reloj, disco, copias, nube, respaldo, purga, cifrado y clave de firma. */
  app.get('/system/health', { preHandler: g.requireUser(READERS) }, async () => {
    const backups = ctx.backups.status();
    const disk = diskInfo(ctx.backupsDir) ?? diskInfo(process.cwd());
    const disk2 = ctx.backupsDir2 ? diskInfo(ctx.backupsDir2) : null;
    const purge = purgePii(ctx, { dryRun: true });
    return {
      time: new Date().toISOString(), timezoneOffsetMinutes: -new Date().getTimezoneOffset(), eventOffsetMinutes: ctx.config.utcOffsetMinutes,
      startedAt: ctx.startedAt, uptimeSeconds: Math.round(process.uptime()), mode: ctx.mode, role: ctx.mode, standby: ctx.replica.status(), cloud: ctx.cloud.status(),
      backups, disk, disk2,
      db: { credentials: ctx.credentials.count(), persons: ctx.persons.count(), scans: ctx.scans.count(), devices: ctx.devices.all().length, audit: ctx.audit.last()?.seq ?? 0 },
      audit: ctx.audit.verify(),
      purge: { retentionDays: retentionDaysFromEnv(), eligibleFrom: purge.eligibleFrom, due: purge.due, pending: ctx.persons.countUnpurged(), nextCheckAt: ctx.purge.nextCheckAt, lastSummary: ctx.meta.get('purge_summary') ? JSON.parse(ctx.meta.get('purge_summary')!) : null },
      pii: { encrypted: true, saltSet: Boolean(ctx.meta.get('pii_salt')), passphraseFromEnv: Boolean(process.env.TP_KEY_PASSPHRASE) },
      key: { kid: ctx.key.kid, publicKeyHex: ctx.key.publicKeyHex }
    };
  });

  // ---- copias de seguridad ----
  /** Copias de seguridad en los dos destinos y estado del programador. */
  app.get('/backup/list', { preHandler: g.requireUser(READERS) }, async () => ctx.backups.status());
  /** Crea una copia ahora (`VACUUM INTO`) en ambos destinos y rota las antiguas. */
  app.post('/backup/snapshot', { preHandler: g.requireUser(['ADMIN']) }, async (req, reply) => {
    try {
      const r = takeSnapshot(ctx, req.user!.username);
      rotateBackups(ctx.backupsDir, ctx.backups.keep);
      rotateBackups(ctx.backupsDir2, ctx.backups.keep);
      return { ...r, message: r.secondary && !r.secondary.ok ? `Copia creada en ${ctx.backupsDir}, pero el segundo destino falló: ${r.secondary.error}` : `Copia de seguridad creada${r.secondary?.ok ? ' (también en el segundo destino)' : ''}.` };
    } catch (e) {
      return reply.code(500).send({ error: `No se pudo crear la copia de seguridad: ${(e as Error).message}` });
    }
  });
  /** Abre una copia, comprueba su integridad y cuenta filas; las compara con el estado actual. */
  app.post<{ Body: { name: string } }>('/backup/verify', { preHandler: g.requireUser(READERS) }, async (req, reply) => {
    const file = req.body?.name ? findBackup(ctx, req.body.name) : null;
    if (!file) return reply.code(404).send({ error: 'No encuentro esa copia de seguridad.' });
    try {
      const v = verifySnapshot(file);
      g.audit(req.user!.username, 'BACKUP_VERIFIED', { file: v.name, ok: v.ok, credentials: v.credentials, scans: v.scans, audit: v.audit });
      return { ...v, current: { credentials: ctx.credentials.count(), persons: ctx.persons.count(), scans: ctx.scans.count(), audit: ctx.audit.last()?.seq ?? 0 } };
    } catch (e) {
      return reply.code(400).send({ error: `No se pudo abrir la copia: ${(e as Error).message}` });
    }
  });
  /** Restaura una copia (exige `confirm: "RESTAURAR"`); antes guarda una copia de seguridad del estado actual. */
  app.post<{ Body: { name: string; confirm?: string } }>('/backup/restore', { preHandler: g.requireUser(['ADMIN']) }, async (req, reply) => {
    const { name, confirm } = req.body ?? {};
    if (!name) return reply.code(400).send({ error: 'Indica qué copia restaurar.' });
    if (confirm !== 'RESTAURAR') return reply.code(400).send({ error: 'Escribe RESTAURAR para confirmar. Se reemplazarán todos los datos actuales.' });
    try {
      const pre = takeSnapshot(ctx, req.user!.username);
      const r = restoreSnapshot(ctx, name, req.user!.username);
      return { ...r, safetyCopy: pre.name, message: 'Copia restaurada. Antes de restaurar se guardó una copia de seguridad del estado actual.' };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  // ---- standby / promoción ----
  /** Convierte el equipo de respaldo en principal (exige `confirm: "PROMOVER"`). Solo si el principal no responde. */
  app.post<{ Body: { confirm?: string } }>('/system/promote', { preHandler: g.requireUser(['ADMIN']) }, async (req, reply) => {
    if (ctx.mode === 'primary') return { mode: 'primary', message: 'Este equipo ya es el principal.' };
    if (req.body?.confirm !== 'PROMOVER') return reply.code(400).send({ error: 'Escribe PROMOVER para confirmar. Hazlo solo si el principal no responde.' });
    const r = promote(ctx, req.user!.username);
    const url = g.hostUrl(req);
    return { ...r, hostUrl: url, message: `Este equipo ahora es el principal. Apunta los scanners a ${url} (o cambia el DNS/mDNS a esta IP).` };
  });

  // ---- purga de datos personales ----
  /** Purga de datos personales: por defecto `dryRun`; para ejecutar exige `confirm` = nombre del evento. No se puede deshacer. */
  app.post<{ Body: { dryRun?: boolean; force?: boolean; confirm?: string } }>('/system/purge', { preHandler: g.requireUser(['ADMIN']) }, async (req, reply) => {
    const dryRun = req.body?.dryRun !== false;
    if (!dryRun && req.body?.confirm !== ctx.config.name) return reply.code(400).send({ error: 'Escribe el nombre del evento para confirmar. Esta acción no se puede deshacer.' });
    return purgePii(ctx, { dryRun, force: req.body?.force === true, by: req.user!.username });
  });
};
