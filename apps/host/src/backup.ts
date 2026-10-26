/**
 * Copias de seguridad (§9 de 00-DECISIONES).
 *
 * - Snapshot SQLite con `VACUUM INTO` (consistente aunque haya escrituras).
 * - Programadas cada `TP_BACKUP_INTERVAL_MIN` (5) a `TP_BACKUPS_DIR` y, si se
 *   define, también a `TP_BACKUPS_DIR_2` (p. ej. la USB cifrada). Si el segundo
 *   destino no está montado, la copia principal se hace igual y se avisa.
 * - Retención "48 + 1 por hora": se conservan las 48 más recientes y, de las
 *   anteriores, la primera de cada hora. El resto se borra.
 * - Verificación: abre el snapshot en solo lectura, `PRAGMA integrity_check` y
 *   cuenta filas por tabla.
 * - Restauración en caliente (copia tabla a tabla dentro de la base abierta) o
 *   en frío con `npm run restore -w apps/host -- <snapshot>` (restore-cli.ts).
 */
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, statfsSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { nativeOptions } from './db.js';
import type { AppContext } from './server.js';

export interface BackupInfo { file: string; name: string; at: string; bytes: number }

export const BACKUP_NAME = /^tatami-.*\.db$/;

export function listBackups(dir: string | null | undefined): BackupInfo[] {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => BACKUP_NAME.test(f)).map((name) => {
    const file = join(dir, name);
    const st = statSync(file);
    return { file, name, at: st.mtime.toISOString(), bytes: st.size };
  }).sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function backupSettingsFromEnv(): { intervalMinutes: number; keep: number; dir2: string | null } {
  const n = Number(process.env.TP_BACKUP_INTERVAL_MIN ?? 5);
  const keep = Number(process.env.TP_BACKUP_KEEP ?? 48);
  return { intervalMinutes: Number.isFinite(n) ? n : 5, keep: Number.isFinite(keep) && keep > 0 ? keep : 48, dir2: process.env.TP_BACKUPS_DIR_2?.trim() || null };
}

export interface SnapshotResult extends BackupInfo {
  /** Copia en el segundo destino (USB), si está configurado. */
  secondary: { file: string; ok: true } | { ok: false; error: string } | null;
}

export function takeSnapshot(ctx: AppContext, by = 'system'): SnapshotResult {
  mkdirSync(ctx.backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(ctx.backupsDir, `tatami-${stamp}.db`);
  ctx.db.prepare('VACUUM INTO ?').run(file);
  const at = new Date().toISOString();
  ctx.meta.set('lastBackupAt', at);
  let secondary: SnapshotResult['secondary'] = null;
  if (ctx.backupsDir2) {
    try {
      mkdirSync(ctx.backupsDir2, { recursive: true });
      const f2 = join(ctx.backupsDir2, basename(file));
      copyFileSync(file, f2);
      secondary = { file: f2, ok: true };
      ctx.meta.set('lastBackup2At', at);
      ctx.meta.delete('lastBackup2Error');
    } catch (e) {
      secondary = { ok: false, error: (e as Error).message };
      ctx.meta.set('lastBackup2Error', `${at} · ${(e as Error).message}`);
    }
  }
  ctx.audit.append(by, 'BACKUP_SNAPSHOT', { file, secondary: secondary?.ok ? secondary.file : secondary?.ok === false ? `error: ${secondary.error}` : null });
  const st = statSync(file);
  return { file, name: basename(file), at: st.mtime.toISOString(), bytes: st.size, secondary };
}

/**
 * Retención "48 + 1 por hora": conserva las `keep` más recientes y, de las más
 * antiguas, la primera copia de cada hora. Devuelve cuántas borró.
 */
export function rotateBackups(dir: string | null | undefined, keep = 48): number {
  const all = listBackups(dir); // más reciente primero
  const older = all.slice(keep).reverse(); // más antigua primero
  const hoursKept = new Set<string>();
  let removed = 0;
  for (const b of older) {
    const hour = b.at.slice(0, 13);
    if (!hoursKept.has(hour)) { hoursKept.add(hour); continue; }
    try { unlinkSync(b.file); removed++; } catch { /* la USB pudo desmontarse */ }
  }
  return removed;
}

export interface VerifyResult {
  name: string; ok: boolean; integrity: string; bytes: number; at: string;
  tables: Record<string, number>; credentials: number; scans: number; audit: number; persons: number;
  message: string;
}

/** Abre el snapshot en solo lectura, comprueba integridad y cuenta filas. */
export function verifySnapshot(file: string): VerifyResult {
  if (!existsSync(file)) throw new Error('No encuentro esa copia de seguridad.');
  const st = statSync(file);
  const db = new Database(file, { readonly: true, fileMustExist: true, ...nativeOptions() });
  try {
    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    const tables: Record<string, number> = {};
    for (const t of names) tables[t] = (db.prepare(`SELECT COUNT(*) AS n FROM "${t.replace(/"/g, '""')}"`).get() as { n: number }).n;
    const ok = integrity === 'ok';
    const credentials = tables.credentials ?? 0, scans = tables.scan_events ?? 0, audit = tables.audit_log ?? 0, persons = tables.persons ?? 0;
    return {
      name: basename(file), ok, integrity, bytes: st.size, at: st.mtime.toISOString(), tables, credentials, scans, audit, persons,
      message: ok ? `Copia íntegra: ${credentials} credenciales, ${persons} personas, ${scans} escaneos y ${audit} registros de auditoría.` : `La copia está dañada (${integrity}). Usa otra.`
    };
  } finally {
    db.close();
  }
}

/** Busca un snapshot por nombre en el destino principal y en el secundario. */
export function findBackup(ctx: Pick<AppContext, 'backupsDir' | 'backupsDir2'>, name: string): string | null {
  const base = basename(name);
  if (!BACKUP_NAME.test(base)) return null;
  for (const dir of [ctx.backupsDir, ctx.backupsDir2]) {
    if (!dir) continue;
    const f = join(dir, base);
    if (existsSync(f)) return f;
  }
  return null;
}

/**
 * Restaura un snapshot sobre la base abierta: copia todas las tablas del
 * snapshot (excepto schema_migrations) dentro de una transacción.
 */
export function restoreSnapshot(ctx: AppContext, name: string, by: string): { tables: number } {
  const file = findBackup(ctx, name);
  if (!file) throw new Error('No encuentro esa copia de seguridad.');
  const check = verifySnapshot(file);
  if (!check.ok) throw new Error(`Esa copia está dañada (${check.integrity}); elige otra.`);
  const db = ctx.db;
  db.pragma('foreign_keys = OFF');
  db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS src`);
  let tables = 0;
  try {
    const names = (db.prepare("SELECT name FROM src.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'").all() as { name: string }[]).map((r) => r.name);
    const local = new Set((db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    db.transaction(() => {
      for (const t of names) {
        if (!local.has(t)) continue;
        const cols = (db.prepare(`PRAGMA src.table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
        const localCols = new Set((db.prepare(`PRAGMA main.table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
        const common = cols.filter((c) => localCols.has(c));
        db.exec(`DELETE FROM main.${t}`);
        db.exec(`INSERT INTO main.${t} (${common.join(',')}) SELECT ${common.join(',')} FROM src.${t}`);
        tables++;
      }
    })();
  } finally {
    db.exec('DETACH DATABASE src');
    db.pragma('foreign_keys = ON');
  }
  ctx.audit.append(by, 'BACKUP_RESTORED', { file: basename(file), tables });
  return { tables };
}

export function diskInfo(path: string): { freeBytes: number; totalBytes: number } | null {
  try {
    const s = statfsSync(path);
    return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
  } catch {
    return null;
  }
}

export interface BackupStatus {
  intervalMinutes: number; keep: number; dir: string; dir2: string | null; dir2Available: boolean;
  lastBackupAt: string | null; lastBackup2At: string | null; lastBackup2Error: string | null; nextRunAt: string | null;
  count: number; count2: number; snapshots: BackupInfo[]; snapshots2: BackupInfo[];
}

export class BackupScheduler {
  private timer: NodeJS.Timeout | undefined;
  private nextRunAt: string | null = null;
  readonly intervalMinutes: number;
  readonly keep: number;

  constructor(private ctx: AppContext, intervalMinutes?: number, keep?: number) {
    const env = backupSettingsFromEnv();
    this.intervalMinutes = intervalMinutes ?? env.intervalMinutes;
    this.keep = keep ?? env.keep;
  }

  start(log: (m: string) => void = (m) => console.log(`[backup] ${m}`)): void {
    this.stop();
    if (this.intervalMinutes <= 0) { log('Copias periódicas desactivadas (TP_BACKUP_INTERVAL_MIN=0).'); return; }
    const ms = this.intervalMinutes * 60_000;
    this.nextRunAt = new Date(Date.now() + ms).toISOString();
    this.timer = setInterval(() => {
      this.nextRunAt = new Date(Date.now() + ms).toISOString();
      try {
        const r = takeSnapshot(this.ctx);
        if (r.secondary && !r.secondary.ok) log(`Copia hecha en ${this.ctx.backupsDir}, pero no en el segundo destino: ${r.secondary.error}`);
        rotateBackups(this.ctx.backupsDir, this.keep);
        rotateBackups(this.ctx.backupsDir2, this.keep);
      } catch (e) { log(`No se pudo hacer la copia: ${(e as Error).message}`); }
    }, ms);
    this.timer.unref?.();
    log(`Copia de seguridad cada ${this.intervalMinutes} min en ${this.ctx.backupsDir}${this.ctx.backupsDir2 ? ` y ${this.ctx.backupsDir2}` : ''} (se conservan ${this.keep} + 1 por hora).`);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.nextRunAt = null; }

  status(): BackupStatus {
    const snapshots = listBackups(this.ctx.backupsDir);
    const snapshots2 = listBackups(this.ctx.backupsDir2);
    return {
      intervalMinutes: this.intervalMinutes, keep: this.keep, dir: this.ctx.backupsDir, dir2: this.ctx.backupsDir2, dir2Available: Boolean(this.ctx.backupsDir2 && existsSync(this.ctx.backupsDir2)),
      lastBackupAt: this.ctx.meta.get('lastBackupAt') ?? snapshots[0]?.at ?? null, lastBackup2At: this.ctx.meta.get('lastBackup2At') ?? null,
      lastBackup2Error: this.ctx.meta.get('lastBackup2Error') ?? null, nextRunAt: this.nextRunAt,
      count: snapshots.length, count2: snapshots2.length, snapshots: snapshots.slice(0, 60), snapshots2: snapshots2.slice(0, 60)
    };
  }
}
