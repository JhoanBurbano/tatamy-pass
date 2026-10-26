/**
 * `npm run restore -w apps/host -- <snapshot> [--yes]`
 *
 * Restauración en frío (con el host apagado): verifica el snapshot, guarda una
 * copia de seguridad de la base actual y reemplaza `TP_DB_PATH` por el snapshot.
 * El nombre puede ser una ruta o solo el nombre del archivo (se busca en
 * TP_BACKUPS_DIR y TP_BACKUPS_DIR_2). Con el host encendido usa el panel
 * (Sistema › Copias de seguridad › Restaurar), que lo hace en caliente.
 */
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { backupSettingsFromEnv, findBackup, verifySnapshot } from './backup.js';
import { openDb } from './db.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const yes = process.argv.includes('--yes');
const name = args[0];
if (!name) {
  console.error('Uso: npm run restore -w apps/host -- <snapshot.db> [--yes]');
  process.exit(2);
}

const dbPath = process.env.TP_DB_PATH ?? join(process.cwd(), 'data', 'tatami.db');
const backupsDir = process.env.TP_BACKUPS_DIR ?? join(process.cwd(), 'backups');
const file = existsSync(name) ? resolve(name) : findBackup({ backupsDir, backupsDir2: backupSettingsFromEnv().dir2 }, name);
if (!file) {
  console.error(`No encuentro la copia "${name}" (busqué en ${backupsDir}${backupSettingsFromEnv().dir2 ? ` y ${backupSettingsFromEnv().dir2}` : ''}).`);
  process.exit(1);
}

const v = verifySnapshot(file);
console.log(`Copia: ${basename(file)} · ${v.message}`);
if (!v.ok) process.exit(1);

if (!yes) {
  console.log(`\nSe reemplazará ${dbPath} por esta copia. Apaga el host antes. Para confirmar vuelve a ejecutar con --yes.`);
  process.exit(0);
}

mkdirSync(backupsDir, { recursive: true });
if (existsSync(dbPath)) {
  const safety = join(backupsDir, `tatami-${new Date().toISOString().replace(/[:.]/g, '-')}-antes-de-restaurar.db`);
  // copia consistente de la base actual (incluye lo que esté en el WAL)
  const cur = openDb(dbPath);
  cur.prepare('VACUUM INTO ?').run(safety);
  cur.close();
  console.log(`Copia de seguridad del estado actual: ${safety}`);
}
for (const suffix of ['', '-wal', '-shm']) { const f = `${dbPath}${suffix}`; if (existsSync(f)) unlinkSync(f); }
mkdirSync(join(dbPath, '..'), { recursive: true });
copyFileSync(file, dbPath);
// aplica migraciones pendientes (si la copia es de una versión anterior) y verifica la auditoría
const db = openDb(dbPath);
const last = db.prepare('SELECT MAX(seq) AS n FROM audit_log').get() as { n: number | null };
db.close();
console.log(`Base restaurada en ${dbPath} (${v.credentials} credenciales, ${v.scans} escaneos, auditoría hasta #${last.n ?? 0}).`);
console.log('Enciende el host: npm run dev:host (o node dist/main.js). Los scanners se resincronizan solos.');
