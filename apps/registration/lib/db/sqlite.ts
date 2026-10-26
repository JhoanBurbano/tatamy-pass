/** Driver SQLite (dev y tests) sobre better-sqlite3. */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Row, SqlDriver } from './driver';

export function createSqliteDriver(path: string): SqlDriver & { raw: Database.Database } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return {
    dialect: 'sqlite',
    raw: db,
    async all<T = Row>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params) as T[]; },
    async get<T = Row>(sql: string, params: unknown[] = []) { return db.prepare(sql).get(...params) as T | undefined; },
    async run(sql: string, params: unknown[] = []) { const r = db.prepare(sql).run(...params); return { changes: r.changes }; },
    async exec(sql: string) { db.exec(sql); },
    async close() { db.close(); }
  };
}
