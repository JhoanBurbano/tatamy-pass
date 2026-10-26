/**
 * Capa mínima sobre la base de datos. Los repositorios escriben SQL con `?` como
 * marcador; cada driver lo adapta a su dialecto (Postgres usa `$1..$n`).
 *
 * Reglas para que el mismo SQL sirva en SQLite y Postgres:
 * - Solo TEXT / INTEGER; fechas como ISO 8601; JSON como texto.
 * - `COUNT(*)` llega como string en Postgres: usa `num()`.
 * - Comparaciones sin distinguir mayúsculas: `LOWER(col) = LOWER(?)`.
 * - Upsert: `INSERT … ON CONFLICT (col) DO UPDATE SET …` (ambos lo soportan).
 */
export type Dialect = 'sqlite' | 'postgres';

export type Row = Record<string, unknown>;

export interface SqlDriver {
  readonly dialect: Dialect;
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  /** Varias sentencias separadas por `;` (migraciones). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Convierte lo que devuelve COUNT()/SUM() (number en SQLite, string en Postgres). */
export function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0);
}

/** `?` → `$1, $2, …` para Postgres. Nuestro SQL no usa `?` dentro de literales. */
export function toPgPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}
