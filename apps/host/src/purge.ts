/**
 * Purga de datos personales a N días del fin del evento (Ley 1581/2012, §10).
 * - Borra nombre, documento, fecha de nacimiento, acudiente, foto y parentesco de
 *   las personas; anonimiza el nombre visible de sus credenciales.
 * - Conserva los hechos sin PII: escaneos (solo IDs), credenciales (rol, zonas,
 *   estado), auditoría (IDs y usuarios del staff) y guarda un resumen agregado
 *   en `meta.purge_summary`.
 * - Idempotente: una persona purgada no se vuelve a tocar.
 *
 * CLI: `npm run purge -w apps/host -- --dry-run [--days 90] [--force]`
 */
import type { AppContext } from './server.js';

export interface PurgeOptions {
  /** Días después de `endDate` a partir de los cuales se purga (por defecto 90, `TP_RETENTION_DAYS`). */
  retentionDays?: number;
  dryRun?: boolean;
  /** Ignora la fecha del evento (para pruebas o por orden del administrador). */
  force?: boolean;
  now?: number;
  by?: string;
}

export interface PurgeResult {
  due: boolean;
  dryRun: boolean;
  retentionDays: number;
  eligibleFrom: string;
  persons: number;
  credentials: number;
  message: string;
  summary?: Record<string, unknown>;
}

export function retentionDaysFromEnv(): number {
  const n = Number(process.env.TP_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 90;
}

export function purgePii(ctx: AppContext, opts: PurgeOptions = {}): PurgeResult {
  const retentionDays = opts.retentionDays ?? retentionDaysFromEnv();
  const now = opts.now ?? Date.now();
  const eligibleFrom = new Date(Date.parse(`${ctx.config.endDate}T23:59:59.999Z`) - ctx.config.utcOffsetMinutes * 60_000 + retentionDays * 86_400_000).toISOString();
  const due = opts.force === true || now >= Date.parse(eligibleFrom);
  const pending = (ctx.db.prepare('SELECT COUNT(*) AS n FROM persons WHERE purged_at IS NULL').get() as { n: number }).n;
  const base: PurgeResult = { due, dryRun: opts.dryRun === true, retentionDays, eligibleFrom, persons: pending, credentials: 0, message: '' };
  if (!due) {
    base.persons = 0;
    base.message = `Todavía no: los datos personales se borran a partir del ${eligibleFrom.slice(0, 10)} (${retentionDays} días después del evento).`;
    return base;
  }
  if (pending === 0) { base.message = 'No queda nada por purgar.'; return base; }
  if (opts.dryRun) {
    base.message = `Se borrarían los datos personales de ${pending} personas (simulación, nada cambió).`;
    return base;
  }
  const at = new Date(now).toISOString();
  const summary = {
    purgedAt: at, event: ctx.config.eventId, persons: pending,
    credentialsByRole: ctx.credentials.countByRole(), credentialsByStatus: ctx.credentials.countByStatus(), scans: ctx.scans.count(), gateSummary: ctx.scans.gateSummary()
  };
  let credentials = 0;
  ctx.db.transaction(() => {
    const ids = (ctx.db.prepare('SELECT id FROM persons WHERE purged_at IS NULL').all() as { id: string }[]).map((r) => r.id);
    for (const id of ids) {
      ctx.persons.purge(id, at);
      credentials += (ctx.db.prepare('SELECT COUNT(*) AS n FROM credentials WHERE person_id = ?').get(id) as { n: number }).n;
      ctx.credentials.purgeDisplay(id, at);
    }
    ctx.meta.set('purge_summary', JSON.stringify(summary));
    ctx.audit.append(opts.by ?? 'system', 'PII_PURGED', { persons: pending, credentials, retentionDays });
  })();
  return { ...base, credentials, summary, message: `Datos personales de ${pending} personas borrados de forma definitiva.` };
}

export class PurgeScheduler {
  private timer: NodeJS.Timeout | undefined;
  /** Próxima revisión (ISO) o null si el job no está activo. */
  nextCheckAt: string | null = null;
  constructor(private ctx: AppContext, private readonly intervalMs = 24 * 3600_000) {}
  /** Revisa al arrancar y cada 24 h. */
  start(log: (m: string) => void = (m) => console.log(`[purga] ${m}`)): void {
    this.stop();
    const run = () => {
      this.nextCheckAt = new Date(Date.now() + this.intervalMs).toISOString();
      try {
        const r = purgePii(this.ctx);
        if (r.due && r.persons > 0) log(r.message);
      } catch (e) { log(`No se pudo ejecutar la purga: ${(e as Error).message}`); }
    };
    run();
    this.timer = setInterval(run, this.intervalMs);
    this.timer.unref?.();
    log(`Purga de datos personales: revisión diaria, retención ${retentionDaysFromEnv()} días después del evento.`);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.nextCheckAt = null; }
}
