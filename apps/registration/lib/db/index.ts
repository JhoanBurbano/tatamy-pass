/**
 * Persistencia dual:
 * - `DATABASE_URL` definida  → Postgres (`pg`; Neon en Vercel).
 * - sin `DATABASE_URL`       → SQLite local en `REGISTRATION_DB_PATH` (por defecto data/registration.db).
 *
 * `getRepos()` abre la conexión una sola vez por proceso, aplica las migraciones
 * pendientes (`migrations/<dialecto>/`) y crea el primer admin si `ADMIN_EMAIL` y
 * `ADMIN_PASSWORD` están definidas y no hay usuarios.
 */
import { createRepos, type Repos } from '../repo';
import { hashPassword } from '../auth/password';
import type { SqlDriver } from './driver';
import { migrate } from './migrate';
import { createPostgresDriver } from './postgres';
import { createSqliteDriver } from './sqlite';

export function createDriverFromEnv(): SqlDriver {
  const url = process.env.DATABASE_URL;
  if (url) return createPostgresDriver(url);
  return createSqliteDriver(process.env.REGISTRATION_DB_PATH ?? 'data/registration.db');
}

export async function bootstrapAdmin(repos: Repos, log: (m: string) => void = console.log): Promise<void> {
  const email = process.env.ADMIN_EMAIL; const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if ((await repos.users.count()) > 0) return;
  await repos.users.create({ email, name: process.env.ADMIN_NAME ?? 'Administrador', role: 'admin', passwordHash: await hashPassword(password) });
  log(`[registration] admin inicial creado: ${email}`);
}

const g = globalThis as unknown as { __tpRepos?: Promise<Repos> };

/** Repositorios listos (conexión abierta + migraciones aplicadas). */
export function getRepos(): Promise<Repos> {
  if (!g.__tpRepos) {
    g.__tpRepos = (async () => {
      const driver = createDriverFromEnv();
      await migrate(driver, (m) => console.log(`[registration] ${m}`));
      const repos = createRepos(driver);
      await bootstrapAdmin(repos);
      return repos;
    })().catch((e) => { g.__tpRepos = undefined; throw e; });
  }
  return g.__tpRepos;
}

/** Para tests: repos sobre un driver propio (en memoria), ya migrado. */
export async function createTestRepos(driver: SqlDriver): Promise<Repos> {
  await migrate(driver);
  return createRepos(driver);
}
