import { ageOn, categoryForAge, type Device, type Person } from '@tatami/core';
import type { AppContext } from './server.js';
import type { UserRole } from './auth.js';

export const SEED_USERS: Record<UserRole, { username: string; password: string }> = {
  ADMIN: { username: 'admin', password: 'admin123' },
  COORDINATOR: { username: 'coord', password: 'coord123' },
  PRINTER: { username: 'print', password: 'print123' },
  REGISTRAR: { username: 'club', password: 'club123' },
  CONTROL: { username: 'control', password: 'control123' },
  SUPERVISOR: { username: 'super', password: 'super123' },
  AUDITOR: { username: 'audit', password: 'audit123' }
};

const FIRST = ['Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Sofía', 'Andrés', 'Valentina', 'Diego', 'Camila', 'Santiago', 'Isabella', 'Mateo', 'Daniela', 'Sebastián', 'Laura'];
const LAST = ['Pérez', 'Gómez', 'Rodríguez', 'Burbano', 'Muñoz', 'López', 'García', 'Martínez', 'Ruiz', 'Torres', 'Ramírez', 'Castro', 'Vargas', 'Ortiz', 'Mosquera', 'Erazo'];
const CLUBS = ['Academia Caucana de Taekwondo', 'Academia Internacional de Taekwondo ITF', 'Academia ITF Bogotá', 'Academia ITF Antioquia · Medellín', 'Academia ITF Nariño · Pasto', 'Academia ITF Atlántico · Barranquilla', 'Academia ITF Valle · Cali', 'Academia ITF Risaralda · Pereira'];

/** Distribución de roles para N credenciales (suma 1). */
const MIX: [string, number][] = [
  ['COMP', 0.55], ['GEN', 0.2], ['COACH', 0.08], ['JUR', 0.04], ['STAFF', 0.05], ['VIP', 0.03], ['SPON', 0.02], ['PRESS', 0.02], ['MED', 0.01]
];

/** PRNG determinista (mulberry32) para que el seed sea reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DELEGATIONS = ['Cauca', 'Valle del Cauca', 'Nariño', 'Bogotá D.C. - Cundinamarca', 'Antioquia', 'Huila', 'Atlántico', 'Santander'];
const EPS = ['EPS Sura', 'Sanitas', 'Nueva EPS', 'Compensar', 'Salud Total', 'Coosalud'];

function pick<T>(rand: () => number, arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }

export function fakePerson(i: number, rand: () => number, roleCode: string): Person {
  const first = FIRST[Math.floor(rand() * FIRST.length)];
  const last = `${LAST[Math.floor(rand() * LAST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
  // competidores de 6 a 40 años; el resto adultos
  const age = roleCode === 'COMP' ? 6 + Math.floor(rand() * 35) : 20 + Math.floor(rand() * 40);
  const year = 2026 - age;
  const month = 1 + Math.floor(rand() * 12);
  const day = 1 + Math.floor(rand() * 28);
  return {
    id: `p_seed_${String(i).padStart(5, '0')}`,
    firstName: first, lastName: last,
    birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    club: roleCode === 'COMP' || roleCode === 'COACH' ? CLUBS[Math.floor(rand() * CLUBS.length)] : undefined,
    documentNumber: String(10_000_000 + Math.floor(rand() * 89_999_999)),
    // derivados de `i` (no de rand) para no mover la secuencia determinista del seed
    delegation: DELEGATIONS[i % DELEGATIONS.length],
    emergencyContact: { name: `Acudiente de ${first}`, phone: `+57 31${i % 10} ${String(100 + (i % 900))} ${String(1000 + (i * 37) % 9000)}` },
    eps: { name: EPS[i % EPS.length], regime: i % 3 === 0 ? 'Régimen Subsidiado' : 'Régimen Contributivo' },
    source: 'seed'
  };
}

export function seedCredentials(ctx: AppContext, n: number): { byRole: Record<string, number>; total: number } {
  const rand = rng(2026);
  const byRole: Record<string, number> = {};
  const roles: string[] = [];
  for (const [code, share] of MIX) for (let k = 0; k < Math.round(n * share); k++) roles.push(code);
  while (roles.length < n) roles.push('GEN');
  roles.length = n;
  // Mezcla determinista para que todos los roles aparezcan aunque el total se corte en n.
  for (let i = roles.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [roles[i], roles[j]] = [roles[j], roles[i]]; }
  let total = 0;
  ctx.db.transaction(() => {
    roles.forEach((roleCode, i) => {
      if (total >= n) return; // n es el total con acompañantes (respeta el aforo totalCapacity)
      const person = ctx.persons.upsert(fakePerson(i + 1, rand, roleCode));
      let categoryCode: string | undefined;
      if (roleCode === 'COMP') categoryCode = categoryForAge(ageOn(person.birthDate, ctx.config.startDate), ctx.config.ageCategories)?.code;
      const c = ctx.credentials.issue({ person, roleCode, categoryCode });
      ctx.credentials.setStatus(c.id, 'DELIVERED');
      byRole[roleCode] = (byRole[roleCode] ?? 0) + 1;
      total++;
      // Cada competidor trae 0–2 acompañantes (rol ACOMP, zona Gradería, credencial digital).
      if (roleCode === 'COMP') {
        const nComp = Math.floor(rand() * 3);
        for (let k = 0; k < nComp && total < n; k++) {
          const comp = ctx.persons.upsert({ ...fakePerson(100_000 + (i + 1) * 10 + k, rand, 'ACOMP'), club: person.club, companionOf: c.id, relationship: pick(rand, ['Madre', 'Padre', 'Hermano/a', 'Pareja', 'Amigo/a']) });
          const cc = ctx.credentials.issue({ person: comp, roleCode: 'ACOMP', companionOf: c.id });
          ctx.credentials.setStatus(cc.id, 'DELIVERED');
          byRole.ACOMP = (byRole.ACOMP ?? 0) + 1;
          total++;
        }
      }
    });
  })();
  return { byRole, total };
}

export function enrollDemoDevices(ctx: AppContext): Array<Device & { token: string }> {
  const gates: Array<{ name: string; zone: string; role: Device['role'] }> = [
    { name: 'Puerta G1', zone: 'G', role: 'CONTROL' }, { name: 'Puerta G2', zone: 'G', role: 'CONTROL' },
    { name: 'Calentamiento', zone: 'W', role: 'CONTROL' }, { name: 'Tatamis', zone: 'T', role: 'SUPERVISOR' }
  ];
  return gates.map((g) => {
    const t = ctx.devices.createEnrollToken(g);
    return ctx.devices.enroll(t.token, '123456')!;
  });
}
