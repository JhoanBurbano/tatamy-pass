import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const HERE = dirname(fileURLToPath(import.meta.url));

/** Carpeta `migrations/` junto a `src/` (dev) o junto a `dist/` (build). */
export function migrationsDir(): string {
  return join(HERE, '..', 'migrations');
}

/**
 * Opciones nativas de better-sqlite3. `TP_SQLITE_NATIVE_BINDING` apunta a un
 * `better_sqlite3.node` compilado para otro runtime (la app de escritorio lo usa
 * para cargar el binario de Electron sin recompilar el de Node del monorepo).
 */
export function nativeOptions(): { nativeBinding?: string } {
  const b = process.env.TP_SQLITE_NATIVE_BINDING?.trim();
  return b ? { nativeBinding: b } : {};
}

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, nativeOptions());
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => (r as { name: string }).name));
  const files = readdirSync(migrationsDir()).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(migrationsDir(), f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, new Date().toISOString());
    })();
  }
}
