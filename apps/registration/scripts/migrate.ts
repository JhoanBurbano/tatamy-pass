/**
 * `npm run migrate -w apps/registration`
 * Aplica las migraciones pendientes a la base que indique el entorno:
 *   DATABASE_URL=postgres://…  → Postgres (Neon)
 *   (sin DATABASE_URL)         → SQLite en REGISTRATION_DB_PATH (data/registration.db)
 * Con ADMIN_EMAIL + ADMIN_PASSWORD crea el primer administrador si no hay usuarios.
 */
import { bootstrapAdmin, createDriverFromEnv } from '../lib/db';
import { migrate } from '../lib/db/migrate';
import { createRepos } from '../lib/repo';

async function main() {
  const driver = createDriverFromEnv();
  console.log(`[migrate] base: ${driver.dialect}${driver.dialect === 'sqlite' ? ` (${process.env.REGISTRATION_DB_PATH ?? 'data/registration.db'})` : ''}`);
  const applied = await migrate(driver, (m) => console.log(`[migrate] ${m}`));
  console.log(applied.length ? `[migrate] ${applied.length} migración(es) aplicadas.` : '[migrate] Nada pendiente: la base ya está al día.');
  await bootstrapAdmin(createRepos(driver));
  await driver.close();
}

main().catch((e) => { console.error('[migrate] error:', (e as Error).message); process.exit(1); });
