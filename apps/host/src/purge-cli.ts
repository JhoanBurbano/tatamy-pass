/**
 * `npm run purge -w apps/host -- [--dry-run] [--days 90] [--force]`
 * Borra los datos personales de las personas cuando el evento terminó hace más de N días.
 */
import { createContext } from './server.js';
import { purgePii } from './purge.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const di = args.indexOf('--days');
const retentionDays = di >= 0 ? Number(args[di + 1]) : undefined;

const ctx = createContext();
const r = purgePii(ctx, { dryRun, force, retentionDays, by: 'cli' });
console.log(r.message);
console.log(`  evento: ${ctx.config.eventId} · retención: ${r.retentionDays} días · elegible desde: ${r.eligibleFrom.slice(0, 10)} · personas: ${r.persons}${r.dryRun ? ' (simulación)' : ''}`);
ctx.db.close();
