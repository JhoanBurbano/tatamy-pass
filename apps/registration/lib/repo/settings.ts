/** Ajustes del evento, lotes de importación, reportes del host y auditoría simple. */
import type { Row, SqlDriver } from '../db/driver';
import { newId } from '../ids';
import { DEFAULT_FORM_SETTINGS, type EventSettings, type HostReport, type ImportBatch } from './types';

export function createSettingsRepo(db: SqlDriver) {
  const now = () => new Date().toISOString();
  async function getJson<T>(key: string): Promise<T | undefined> {
    const r = await db.get<{ value_json: string }>('SELECT value_json FROM event_settings WHERE key = ?', [key]);
    return r ? (JSON.parse(r.value_json) as T) : undefined;
  }
  async function setJson(key: string, value: unknown): Promise<void> {
    await db.run('INSERT INTO event_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at', [key, JSON.stringify(value), now()]);
  }
  return {
    async eventSettings(): Promise<EventSettings> {
      const config = (await getJson<EventSettings['config']>('event.config')) ?? {};
      const form = { ...DEFAULT_FORM_SETTINGS, ...((await getJson<Partial<EventSettings['form']>>('event.form')) ?? {}) };
      return { config, form };
    },
    async saveEventConfig(config: EventSettings['config']): Promise<void> { await setJson('event.config', config); },
    async saveFormSettings(form: EventSettings['form']): Promise<void> { await setJson('event.form', form); },
    async getValue<T>(key: string): Promise<T | undefined> { return getJson<T>(key); },
    async setValue(key: string, value: unknown): Promise<void> { await setJson(key, value); },

    // ─── Importaciones SportData ─────────────────────────────────────────
    async addImportBatch(b: Omit<ImportBatch, 'id' | 'createdAt'>): Promise<ImportBatch> {
      const id = newId('imp');
      await db.run('INSERT INTO import_batches (id, file_name, rows, created, updated, unchanged, duplicates_in_file, errors_json, mapping_json, by_user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, b.fileName ?? null, b.rows, b.created, b.updated, b.unchanged, b.duplicatesInFile, JSON.stringify(b.errors), JSON.stringify(b.mapping), b.byUser ?? null, now()]);
      return { id, createdAt: now(), ...b };
    },
    async importBatches(limit = 50): Promise<ImportBatch[]> {
      const rows = await db.all<Row>(`SELECT * FROM import_batches ORDER BY created_at DESC LIMIT ${limit}`);
      return rows.map((r) => ({
        id: r.id as string, fileName: (r.file_name as string | null) ?? undefined, rows: Number(r.rows), created: Number(r.created), updated: Number(r.updated), unchanged: Number(r.unchanged),
        duplicatesInFile: Number(r.duplicates_in_file), errors: JSON.parse(r.errors_json as string), mapping: JSON.parse(r.mapping_json as string), byUser: (r.by_user as string | null) ?? undefined, createdAt: r.created_at as string
      }));
    },

    // ─── Reportes del host ───────────────────────────────────────────────
    async addHostReport(r: { hostId?: string; summary: Record<string, unknown>; credentialsCount: number }): Promise<HostReport> {
      const id = newId('hr'); const at = now();
      await db.run('INSERT INTO host_reports (id, received_at, host_id, summary_json, credentials_count) VALUES (?, ?, ?, ?, ?)', [id, at, r.hostId ?? null, JSON.stringify(r.summary), r.credentialsCount]);
      return { id, receivedAt: at, ...r };
    },
    async hostReports(limit = 20): Promise<HostReport[]> {
      const rows = await db.all<Row>(`SELECT * FROM host_reports ORDER BY received_at DESC LIMIT ${limit}`);
      return rows.map((r) => ({ id: r.id as string, receivedAt: r.received_at as string, hostId: (r.host_id as string | null) ?? undefined, summary: JSON.parse(r.summary_json as string), credentialsCount: Number(r.credentials_count) }));
    },

    // ─── Auditoría (quién hizo qué en el panel) ──────────────────────────
    async audit(actor: string, action: string, target?: string, payload?: unknown): Promise<void> {
      await db.run('INSERT INTO audit_log (at, actor, action, target, payload_json) VALUES (?, ?, ?, ?, ?)', [now(), actor, action, target ?? null, payload === undefined ? null : JSON.stringify(payload)]);
    },
    async auditEntries(limit = 100): Promise<{ at: string; actor: string; action: string; target?: string; payload?: unknown }[]> {
      const rows = await db.all<Row>(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ${limit}`);
      return rows.map((r) => ({ at: r.at as string, actor: r.actor as string, action: r.action as string, target: (r.target as string | null) ?? undefined, payload: r.payload_json ? JSON.parse(r.payload_json as string) : undefined }));
    }
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
