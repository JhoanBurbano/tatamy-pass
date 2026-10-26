/**
 * Genera en `out/` 12 credenciales de muestra con la plantilla por defecto
 * ("Nacional 2026"): `sample-credentials.pdf` (anverso y reverso, dos páginas
 * por credencial), `sample-duplex.pdf` (ambos lados en una hoja) y, si hay
 * `pdftoppm` (poppler), `sample-front.png` / `sample-back.png` de la primera.
 * Usa una clave de firma efímera (solo para muestra).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultConfig, defaultBadgeTemplate, filterPersonForBadge, formatCredentialId, generateKeyPair, resolveZones, signCredentialToken, type Credential, type Person } from '@tatami/core';
import { buildCredentialsPdf, type PrintableCredential } from './pdf.js';
import { fontsAvailable } from './fonts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = createDefaultConfig({ startDate: '2026-11-14', endDate: '2026-11-16' });
const key = generateKeyPair('sample');
const template = defaultBadgeTemplate();

const people: [string, string, string | undefined, string | undefined, string][] = [
  ['Juan Pérez Gómez', 'COMP', 'Academia Caucana de Taekwondo', 'JUV', 'Cauca'], ['María Rodríguez', 'COMP', 'Academia Internacional de Taekwondo ITF', 'INF_B', 'Valle del Cauca'],
  ['Carlos Muñoz', 'COACH', 'Academia ITF Bogotá', undefined, 'Bogotá D.C. - Cundinamarca'], ['Ana López Castro', 'JUR', undefined, undefined, 'Antioquia'],
  ['Luis Torres', 'VIP', undefined, undefined, 'Cauca'], ['Sofía Ramírez', 'SPON', 'Gatorade', undefined, 'Bogotá D.C.'],
  ['Andrés Vargas', 'PRESS', 'El Tiempo', undefined, 'Bogotá D.C.'], ['Valentina Ortiz', 'MED', undefined, undefined, 'Cauca'],
  ['Diego Mosquera', 'STAFF', undefined, undefined, 'Cauca'], ['Camila Erazo', 'GEN', undefined, undefined, 'Nariño'],
  ['Santiago Burbano', 'COMP', 'ITF Popayán', 'ADU', 'Cauca'], ['Isabella García', 'COACH', 'Cóndor Pasto', undefined, 'Nariño']
];

const creds: PrintableCredential[] = people.map(([name, roleCode, club, categoryCode, delegation], i) => {
  const role = config.roles.find((r) => r.code === roleCode)!;
  const seq = 428 + i;
  const base: Credential = {
    id: formatCredentialId(config.idPrefix, seq), seq, eventId: config.eventId, personId: `p${seq}`, displayName: name, club, roleCode,
    zones: resolveZones(role.zones, config), validFrom: config.startDate, validTo: config.endDate, version: 1, status: 'ISSUED', kid: key.kid,
    categoryCode, issuedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  const [first, last] = [name.split(' ')[0], name.split(' ').slice(1).join(' ')];
  const person: Person = {
    id: base.personId, firstName: first, lastName: last, birthDate: '2000-01-01', documentNumber: String(1_061_234_567 + i * 7919), club, delegation, source: 'seed',
    emergencyContact: { name: `Contacto de ${first}`, phone: `+57 310 ${String(234_5678 + i * 11).replace(/(\d{3})(\d{4})/, '$1 $2')}` },
    eps: { name: ['EPS Sura', 'Sanitas', 'Nueva EPS', 'Compensar'][i % 4], regime: i % 3 === 0 ? 'Régimen Subsidiado' : 'Régimen Contributivo' }
  };
  return { ...base, token: signCredentialToken(base, key), person: filterPersonForBadge(template, person) };
});

const outDir = join(HERE, '..', 'out');
mkdirSync(outDir, { recursive: true });
const t0 = performance.now();
const pdf = await buildCredentialsPdf(creds, config, { template, layout: 'two-pages' });
const file = join(outDir, 'sample-credentials.pdf');
writeFileSync(file, pdf);
console.log(`${creds.length} credenciales (anverso + reverso) → ${file} (${(pdf.length / 1024).toFixed(0)} KB, ${(performance.now() - t0).toFixed(0)} ms, fuentes ${fontsAvailable() ? 'Barlow embebidas' : 'Helvetica'})`);
const duplex = await buildCredentialsPdf(creds.slice(0, 3), config, { template, layout: 'duplex' });
writeFileSync(join(outDir, 'sample-duplex.pdf'), duplex);
console.log(`3 credenciales en una hoja (duplex) → ${join(outDir, 'sample-duplex.pdf')}`);

// Capturas PNG del anverso y reverso de la primera credencial (poppler).
try {
  execFileSync('pdftoppm', ['-png', '-r', '220', '-f', '1', '-l', '2', file, join(outDir, 'sample')], { stdio: 'ignore' });
  for (const [n, name] of [['1', 'sample-front.png'], ['2', 'sample-back.png']]) {
    const cand = [`sample-${n}.png`, `sample-0${n}.png`, `sample-00${n}.png`].map((f) => join(outDir, f)).find(existsSync);
    if (cand) renameSync(cand, join(outDir, name));
  }
  console.log(`Capturas → ${join(outDir, 'sample-front.png')} y ${join(outDir, 'sample-back.png')}`);
} catch {
  console.log('Sin pdftoppm (poppler-utils): no se generaron las capturas PNG. Abre el PDF para verlas.');
}
