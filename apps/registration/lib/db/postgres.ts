/**
 * Driver Postgres (Neon en Vercel, o cualquier Postgres ≥ 13) sobre `pg`.
 * Pool pequeño: en serverless cada instancia abre pocas conexiones y Neon
 * acepta su pooler (`-pooler` en el host) para absorber picos.
 */
import { Pool } from 'pg';
import { toPgPlaceholders, type Row, type SqlDriver } from './driver';

function sslFor(url: string): false | { rejectUnauthorized: boolean } {
  if (process.env.PGSSL === 'disable') return false;
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (host === 'localhost' || host === '127.0.0.1' || host === 'postgres' || host === 'db') return false;
  return { rejectUnauthorized: false };
}

export function createPostgresDriver(url: string): SqlDriver {
  // Esquema alternativo (tests, varios eventos en la misma base): PG_SCHEMA=tp_test (debe existir)
  const schema = process.env.PG_SCHEMA;
  if (schema && !/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error('PG_SCHEMA inválido');
  const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 3), ssl: sslFor(url), ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  return {
    dialect: 'postgres',
    async all<T = Row>(sql: string, params: unknown[] = []) { return (await pool.query(toPgPlaceholders(sql), params)).rows as T[]; },
    async get<T = Row>(sql: string, params: unknown[] = []) { return (await pool.query(toPgPlaceholders(sql), params)).rows[0] as T | undefined; },
    async run(sql: string, params: unknown[] = []) { const r = await pool.query(toPgPlaceholders(sql), params); return { changes: r.rowCount ?? 0 }; },
    async exec(sql: string) { await pool.query(sql); },
    async close() { await pool.end(); }
  };
}
