/**
 * Seed: evento nac2026, 2.000 credenciales de prueba y un usuario por rol.
 * Uso: npm run seed   (TP_DB_PATH para cambiar la ruta de la base)
 */
import { ageOn, categoryForAge, type Person } from '@tatami/core';
import { createContext } from './server.js';
import { USER_ROLES } from './auth.js';
import { enrollDemoDevices, seedCredentials, SEED_USERS } from './seed-data.js';

const ctx = createContext();

if (ctx.users.count() > 0) {
  console.log('La base ya tiene datos. Borra data/tatami.db para volver a sembrar.');
  process.exit(0);
}

for (const role of USER_ROLES) {
  const u = SEED_USERS[role];
  ctx.users.create(u.username, u.password, role);
}
console.log('Usuarios creados:');
for (const role of USER_ROLES) console.log(`  ${SEED_USERS[role].username.padEnd(12)} / ${SEED_USERS[role].password}  (${role})`);

const { byRole, total } = seedCredentials(ctx, 2000);
console.log(`Credenciales emitidas: ${total}`);
for (const [r, n] of Object.entries(byRole)) console.log(`  ${r.padEnd(6)} ${n}`);

const devices = enrollDemoDevices(ctx);
console.log('Dispositivos de demo enrolados (PIN 123456):');
for (const d of devices) console.log(`  ${d.name.padEnd(14)} zona ${d.zone}  token ${d.token}`);

ctx.audit.append('seed', 'SEED_COMPLETED', { total, byRole });
console.log('Auditoría:', ctx.audit.verify());

// re-export para que los tipos no queden sin usar
export type { Person };
export { ageOn, categoryForAge };
