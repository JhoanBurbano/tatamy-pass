/**
 * Simulación de carga y resiliencia (§11 y RF-TEST), solo con @tatami/core:
 *  - 2.000 credenciales, 8 puertas/dispositivos.
 *  - Pico de 1.500 ingresos en 60 min (tiempo simulado, comprimido).
 *  - 50 QR fotocopiados (mismo token en otra puerta < 2 min).
 *  - 30 credenciales revocadas que intentan entrar.
 *  - 100 re-ingresos sin salida registrada (anti-passback).
 *  - 3 scanners sin red durante 2 h; luego reconcilian con el host.
 * Imprime p50/p95 de validación, decisiones por tipo, eventos reconciliados y duplicados detectados.
 *
 * Uso: npm run simulate
 */
import {
  appendEvents, createDefaultConfig, createEventLog, evaluateScan, formatCredentialId, generateKeyPair, listEvents, reconcile,
  resolveZones, signCredentialToken, toScanEvent, verifyToken,
  type Credential, type EventConfig, type EventLogState, type RevocationEntry, type ScanEvent, type ScanResult
} from '@tatami/core';

// ---------- utilidades ----------

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261120);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n: number) => n.toLocaleString('es-CO');

// ---------- setup ----------

const config: EventConfig = createDefaultConfig();
const key = generateKeyPair('k1');
config.signingKeys = [{ kid: key.kid, publicKeyHex: key.publicKeyHex }];

const MIX: [string, number][] = [['COMP', 0.55], ['GEN', 0.2], ['COACH', 0.08], ['JUR', 0.04], ['STAFF', 0.05], ['VIP', 0.03], ['SPON', 0.02], ['PRESS', 0.02], ['MED', 0.01]];
const N_CREDENTIALS = 2000;
const FIRST = ['Juan', 'María', 'Carlos', 'Ana', 'Luis', 'Sofía', 'Andrés', 'Valentina', 'Diego', 'Camila'];
const LAST = ['Pérez', 'Gómez', 'Rodríguez', 'Burbano', 'Muñoz', 'López', 'García', 'Martínez'];

interface SimCredential { cred: Credential; token: string }
const credentials: SimCredential[] = [];
{
  const roles: string[] = [];
  for (const [code, share] of MIX) for (let k = 0; k < Math.round(N_CREDENTIALS * share); k++) roles.push(code);
  while (roles.length < N_CREDENTIALS) roles.push('GEN');
  roles.length = N_CREDENTIALS;
  roles.forEach((roleCode, i) => {
    const seq = i + 1;
    const role = config.roles.find((r) => r.code === roleCode)!;
    const cred: Credential = {
      id: formatCredentialId(config.idPrefix, seq), seq, eventId: config.eventId, personId: `p${seq}`,
      displayName: `${pick(FIRST)} ${pick(LAST)}`, club: 'Club ' + pick(LAST), roleCode, zones: resolveZones(role.zones, config),
      validFrom: config.startDate, validTo: config.endDate, version: 1, status: 'DELIVERED', kid: key.kid,
      issuedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z'
    };
    credentials.push({ cred, token: signCredentialToken(cred, key) });
  });
}
const credById = new Map(credentials.map((c) => [c.cred.id, c]));

interface Gate { id: string; name: string; zone: string; online: boolean; local: EventLogState; offlineSince?: number }
const gates: Gate[] = [
  ['g1', 'Gradería 1', 'G'], ['g2', 'Gradería 2', 'G'], ['w1', 'Calentamiento', 'W'], ['t1', 'Tatamis 1', 'T'],
  ['t2', 'Tatamis 2', 'T'], ['p1', 'Pesaje', 'P'], ['v1', 'Palco', 'V'], ['h1', 'Hospitalidad', 'H']
].map(([id, name, zone]) => ({ id, name, zone, online: true, local: createEventLog() }));
const gatesByZone = (z: string) => gates.filter((g) => g.zone === z);

// Host: fuente de verdad de la sede.
const host = { log: createEventLog(), revocations: [] as RevocationEntry[] };
// Revocaciones conocidas por cada scanner (se sincronizan antes del corte de red).
const knownRevocations = new Map<string, RevocationEntry[]>();

// ---------- plan de escaneos ----------

const T0 = Date.parse('2026-11-20T13:00:00Z'); // 08:00 Colombia
const MIN = 60_000;
type Kind = 'normal' | 'clone' | 'revoked' | 'passback' | 'exit';
interface Planned { at: number; gate: Gate; credId: string; token: string; direction: 'IN' | 'OUT'; kind: Kind }
const plan: Planned[] = [];

// 1.500 ingresos en 60 min, en la puerta que corresponde a cada rol.
const entered: Planned[] = [];
const shuffled = [...credentials].sort(() => rand() - 0.5);
for (let i = 0; i < 1500; i++) {
  const { cred, token } = shuffled[i % shuffled.length];
  const zone = cred.zones.includes('T') && rand() < 0.5 ? 'T' : cred.zones.includes('W') && rand() < 0.3 ? 'W' : cred.zones.includes('V') ? 'V' : cred.zones.includes('H') && !cred.zones.includes('G') ? 'H' : 'G';
  const gate = pick(gatesByZone(zone));
  const p: Planned = { at: T0 + rand() * 60 * MIN, gate, credId: cred.id, token, direction: 'IN', kind: 'normal' };
  plan.push(p);
  entered.push(p);
}

// 50 QR fotocopiados: mismo token, otra puerta de la misma zona, 30–90 s después.
const cloneTargets = entered.filter((p) => gatesByZone(p.gate.zone).length > 1).slice(0, 50);
for (const p of cloneTargets) {
  const other = gatesByZone(p.gate.zone).find((g) => g.id !== p.gate.id)!;
  plan.push({ at: p.at + (30 + rand() * 60) * 1000, gate: other, credId: p.credId, token: p.token, direction: 'IN', kind: 'clone' });
}

// 30 revocadas (antes del pico; todos los scanners reciben la lista).
const usedIds = new Set(entered.map((p) => p.credId));
const revokedPool = credentials.filter((c) => !usedIds.has(c.cred.id)).slice(0, 30);
for (const c of revokedPool) {
  host.revocations.push({ credentialId: c.cred.id, version: null, reason: 'Reportada perdida', at: new Date(T0 - 30 * MIN).toISOString(), by: 'coord' });
  plan.push({ at: T0 + rand() * 60 * MIN, gate: pick(gates.filter((g) => c.cred.zones.includes(g.zone))), credId: c.cred.id, token: c.token, direction: 'IN', kind: 'revoked' });
}
for (const g of gates) knownRevocations.set(g.id, [...host.revocations]);

// 100 re-ingresos sin salida: entraron a Tatamis y vuelven a escanear > 2 min después.
// Solo roles con anti-passback en Tatamis (COMP/COACH); jurado y staff no lo tienen por config.
const tatamiEntries = entered.filter((p) => p.gate.zone === 'T' && ['COMP', 'COACH'].includes(credById.get(p.credId)!.cred.roleCode)).slice(0, 100);
for (const p of tatamiEntries) {
  plan.push({ at: p.at + (3 + rand() * 20) * MIN, gate: p.gate, credId: p.credId, token: p.token, direction: 'IN', kind: 'passback' });
}
// Algunas salidas legítimas para que haya tráfico OUT.
for (const p of entered.filter((x) => x.gate.zone === 'W').slice(0, 80)) {
  plan.push({ at: p.at + (5 + rand() * 30) * MIN, gate: p.gate, credId: p.credId, token: p.token, direction: 'OUT', kind: 'exit' });
}

plan.sort((a, b) => a.at - b.at);

// Corte de red: 3 scanners sin red desde el minuto 20 durante 2 h.
const OFFLINE_GATES = new Set(['t2', 'p1', 'w1']);
const OFFLINE_FROM = T0 + 20 * MIN;
const OFFLINE_UNTIL = OFFLINE_FROM + 120 * MIN;

// ---------- ejecución ----------

const latencies: number[] = [];
const decisions: Record<string, number> = {};
const reasons: Record<string, number> = {};
const byKind: Record<Kind, Record<string, number>> = { normal: {}, clone: {}, revoked: {}, passback: {}, exit: {} };
const seqs = new Map<string, number>();
let offlineScans = 0;

function scannerView(gate: Gate): EventLogState {
  return gate.online ? host.log : gate.local;
}

function runScan(p: Planned): ScanResult {
  const { gate } = p;
  const t0 = performance.now();
  const verification = verifyToken(p.token, config.signingKeys);
  const credential = credById.get(p.credId)?.cred;
  const view = scannerView(gate);
  const recentScans = credential ? listEvents(view).filter((e) => e.credentialId === credential.id) : [];
  const result = evaluateScan({
    source: { kind: 'token', verification }, credential, zone: gate.zone, direction: p.direction, now: p.at,
    device: { id: gate.id, zone: gate.zone, role: 'CONTROL' }, recentScans, revocations: knownRevocations.get(gate.id) ?? [], config
  });
  latencies.push(performance.now() - t0);

  const seq = (seqs.get(gate.id) ?? 0) + 1;
  seqs.set(gate.id, seq);
  const ev: ScanEvent = toScanEvent({ deviceId: gate.id, seq, zone: gate.zone, direction: p.direction, at: p.at, result, credentialId: credential?.id ?? null });
  appendEvents(gate.local, [ev]);
  if (gate.online) appendEvents(host.log, [ev]);
  else offlineScans++;
  return result;
}

let reconciledToHost = 0;
let reconciledToLocal = 0;
let duplicatesIgnored = 0;
let reconcileMs = 0;

for (const p of plan) {
  // transiciones de red
  for (const g of gates) {
    if (OFFLINE_GATES.has(g.id) && g.online && p.at >= OFFLINE_FROM && p.at < OFFLINE_UNTIL) {
      // se va sin red: congela una copia del log del host
      g.local = createEventLog(listEvents(host.log));
      g.online = false;
      g.offlineSince = p.at;
    }
    if (OFFLINE_GATES.has(g.id) && !g.online && p.at >= OFFLINE_UNTIL) {
      const t = performance.now();
      const r = reconcile(
        { events: listEvents(g.local), revocations: knownRevocations.get(g.id) ?? [], config },
        { events: listEvents(host.log), revocations: host.revocations, config }
      );
      appendEvents(host.log, r.toRemote);
      appendEvents(g.local, r.toLocal);
      reconciledToHost += r.toRemote.length;
      reconciledToLocal += r.toLocal.length;
      duplicatesIgnored += r.duplicatesIgnored;
      reconcileMs += performance.now() - t;
      g.online = true;
    }
  }
  const r = runScan(p);
  decisions[r.decision] = (decisions[r.decision] ?? 0) + 1;
  reasons[r.reasonCode] = (reasons[r.reasonCode] ?? 0) + 1;
  byKind[p.kind][r.reasonCode] = (byKind[p.kind][r.reasonCode] ?? 0) + 1;
}

// Los que seguían sin red al final del plan reconcilian ahora.
for (const g of gates.filter((x) => !x.online)) {
  const t = performance.now();
  const r = reconcile({ events: listEvents(g.local), revocations: [], config }, { events: listEvents(host.log), revocations: host.revocations, config });
  appendEvents(host.log, r.toRemote);
  reconciledToHost += r.toRemote.length;
  reconciledToLocal += r.toLocal.length;
  duplicatesIgnored += r.duplicatesIgnored;
  reconcileMs += performance.now() - t;
  g.online = true;
}

// Reconciliación de verificación: el host debe tener exactamente todos los eventos locales.
const totalLocal = gates.reduce((n, g) => n + listEvents(g.local, { deviceId: g.id }).length, 0);
const totalHost = host.log.events.size;

// ---------- reporte ----------

console.log('\n=== Tatami Pass · simulación de carga ===');
console.log(`Credenciales: ${fmt(credentials.length)} · Puertas: ${gates.length} · Escaneos planificados: ${fmt(plan.length)}`);
console.log(`Ventana simulada: ${new Date(T0).toISOString()} → ${new Date(plan[plan.length - 1].at).toISOString()} (pico 1.500 ingresos en 60 min)`);
console.log(`Sin red: ${[...OFFLINE_GATES].join(', ')} durante 120 min (escaneos locales en ese lapso: ${fmt(offlineScans)})`);

console.log('\nValidación offline (firma + reglas):');
console.log(`  p50 ${percentile(latencies, 50).toFixed(2)} ms · p95 ${percentile(latencies, 95).toFixed(2)} ms · p99 ${percentile(latencies, 99).toFixed(2)} ms · máx ${Math.max(...latencies).toFixed(2)} ms (objetivo < 300 ms)`);

console.log('\nDecisiones:');
for (const [d, n] of Object.entries(decisions)) console.log(`  ${d.padEnd(6)} ${fmt(n)}`);
console.log('\nMotivos:');
for (const [r, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${r.padEnd(22)} ${fmt(n)}`);

console.log('\nResultado por escenario inyectado:');
const show = (label: string, kind: Kind, expected: string) => {
  const total = Object.values(byKind[kind]).reduce((a, b) => a + b, 0);
  const hit = byKind[kind][expected] ?? 0;
  console.log(`  ${label.padEnd(34)} ${String(hit).padStart(5)}/${total} → ${expected}${hit < total ? `  (otros: ${Object.entries(byKind[kind]).filter(([k]) => k !== expected).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`);
};
show('QR fotocopiados (duplicado < 2 min)', 'clone', 'DUPLICATE');
show('Credenciales revocadas', 'revoked', 'REVOKED');
show('Re-ingreso sin salida', 'passback', 'ANTI_PASSBACK');
show('Salidas', 'exit', 'OK_EXIT');

console.log('\nReconciliación tras el corte de red:');
console.log(`  eventos subidos al host: ${fmt(reconciledToHost)} · bajados a scanners: ${fmt(reconciledToLocal)} · ya conocidos e ignorados: ${fmt(duplicatesIgnored)} · tiempo ${reconcileMs.toFixed(0)} ms`);
console.log(`  eventos en host: ${fmt(totalHost)} · suma de logs locales propios: ${fmt(totalLocal)} → ${totalHost === totalLocal ? 'CONSISTENTE' : 'INCONSISTENTE'}`);

// Duplicados detectables en el host una vez reconciliado (mismo QR aceptado en dos puertas en < 2 min).
const byCred = new Map<string, ScanEvent[]>();
for (const e of listEvents(host.log)) if (e.credentialId && e.direction === 'IN' && e.decision !== 'DENY') (byCred.get(e.credentialId) ?? byCred.set(e.credentialId, []).get(e.credentialId)!).push(e);
let postHocDuplicates = 0;
for (const evs of byCred.values()) {
  for (let i = 1; i < evs.length; i++) {
    if (evs[i].deviceId !== evs[i - 1].deviceId && Date.parse(evs[i].at) - Date.parse(evs[i - 1].at) < config.duplicateWindowSeconds * 1000) postHocDuplicates++;
  }
}
const missedDuplicates = cloneTargets.length - (byKind.clone.DUPLICATE ?? 0);
console.log(`  duplicados visibles en el host tras reconciliar: ${postHocDuplicates} de ${cloneTargets.length} inyectados`);
if (missedDuplicates > 0) {
  console.log(`\nNota: ${missedDuplicates} duplicado(s) no se alertaron en tiempo real porque una de las dos puertas estaba sin red; el reporte del host los muestra tras reconciliar.`);
}
console.log('');
