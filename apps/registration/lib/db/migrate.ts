/**
 * Migraciones SQL por dialecto: `migrations/<dialect>/NNN_nombre.sql`, aplicadas en
 * orden y registradas en `schema_migrations`. Idempotente: correrla dos veces no hace nada.
 *
 * Bases SQLite creadas antes de las migraciones (solo `registrations`, sin
 * `schema_migrations`) se actualizan en caliente añadiendo las columnas que falten.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SqlDriver } from './driver';

export function migrationsDir(dialect: string): string {
  const candidates = [
    process.env.REGISTRATION_MIGRATIONS_DIR,
    resolve(process.cwd(), 'migrations', dialect),
    resolve(process.cwd(), 'apps/registration/migrations', dialect)
  ].filter(Boolean) as string[];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`No encuentro la carpeta de migraciones para ${dialect}. Probé: ${candidates.join(', ')}`);
  return found;
}

/** Columnas que los esquemas viejos de SQLite no tenían (antes de 001_init). */
const LEGACY_COLUMNS: [string, string][] = [
  ['code', 'TEXT'], ['delegation_id', 'TEXT'], ['photo_url', 'TEXT'], ['rejection_reason', 'TEXT'], ['companion_of', 'TEXT'], ['relationship', 'TEXT'],
  ['consent_at', 'TEXT'], ['offer_token', 'TEXT'], ['offer_expires_at', 'TEXT'], ['offered_at', 'TEXT'], ['credential_id', 'TEXT'], ['credential_status', 'TEXT'],
  ['credential_updated_at', 'TEXT'], ['exported_at', 'TEXT'], ['revoked_at', 'TEXT'], ['revoke_reason', 'TEXT'], ['updated_at', "TEXT NOT NULL DEFAULT ''"]
];

async function upgradeLegacySqlite(db: SqlDriver): Promise<void> {
  const hasRegs = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'registrations'");
  const hasMig = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
  if (!hasRegs || hasMig) return;
  const cols = new Set((await db.all<{ name: string }>('PRAGMA table_info(registrations)')).map((c) => c.name));
  for (const [col, type] of LEGACY_COLUMNS) if (!cols.has(col)) await db.exec(`ALTER TABLE registrations ADD COLUMN ${col} ${type}`);
  await db.exec("UPDATE registrations SET updated_at = created_at WHERE updated_at = ''");
}

export async function migrate(db: SqlDriver, log: (m: string) => void = () => undefined): Promise<string[]> {
  if (db.dialect === 'sqlite') await upgradeLegacySqlite(db);
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((await db.all<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const dir = migrationsDir(db.dialect);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.exec(sql);
    await db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [file, new Date().toISOString()]);
    done.push(file);
    log(`migración aplicada: ${file}`);
  }
  return done;
}
