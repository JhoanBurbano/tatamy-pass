/**
 * Scaffold de un tipo de evento de dispositivo nuevo para el log de sync
 * (ver skill `tatami-sync-protocolo` y ADR-0004). Hace los pasos de core:
 *
 *   1. `packages/core/src/device-events.ts`: literal en `DeviceEventType`,
 *      `reasonCode` en `DEVICE_EVENT_REASON`, variante en `ManualMeta`, caso en
 *      `describeDeviceEvent` y en el `Extract` de `buildDeviceEvent`.
 *   2. `packages/core/test/device-events.test.ts`: test del evento (lo crea si no existe).
 *   3. Imprime la lista de pasos que quedan a mano (host, scanner, panel, docs, e2e).
 *
 * Uso:  npx tsx scripts/agent/new-event-type.ts <snake_case> "<Descripción humana>" [--campos a:string,b:number] [--dry-run]
 * Ej.:  npx tsx scripts/agent/new-event-type.ts battery_low "Batería baja" --campos level:number
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..');
const SRC = join(ROOT, 'packages', 'core', 'src', 'device-events.ts');
const TEST = join(ROOT, 'packages', 'core', 'test', 'device-events.test.ts');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const name = args.find((a) => !a.startsWith('--'));
const human = args.filter((a) => !a.startsWith('--'))[1];
const fieldsArg = args.includes('--campos') ? args[args.indexOf('--campos') + 1] : '';
if (!name || !/^[a-z][a-z0-9_]*$/.test(name) || !human) {
  console.error('Uso: new-event-type.ts <snake_case> "<Descripción humana>" [--campos a:string,b:number] [--dry-run]');
  process.exit(1);
}
const REASON = name.toUpperCase();
const fields = fieldsArg ? fieldsArg.split(',').map((f) => { const [k, t] = f.split(':'); return { k: k.trim(), t: (t ?? 'string').trim() }; }) : [];

let src = readFileSync(SRC, 'utf8');
if (src.includes(`'${name}'`)) { console.error(`El tipo '${name}' ya existe en device-events.ts.`); process.exit(1); }

const edits: Array<[string, string, string]> = [];
// 1. DeviceEventType
edits.push(['DeviceEventType', /export type DeviceEventType = ([^;]+);/.source, '']);
src = src.replace(/export type DeviceEventType = ([^;]+);/, (_m, list: string) => `export type DeviceEventType = ${list.trim()} | '${name}';`);
// 2. DEVICE_EVENT_REASON (tipo y valor)
src = src.replace(/Record<Exclude<DeviceEventType, 'manual_entry' \| 'exception'>, string> = \{([\s\S]*?)\n\};/, (_m, body: string) =>
  `Record<Exclude<DeviceEventType, 'manual_entry' | 'exception'>, string> = {${body},\n  ${name}: '${REASON}'\n};`);
// 3. ManualMeta
const fieldDecl = fields.map((f) => `; ${f.k}: ${f.t}`).join('');
src = src.replace(/(export type ManualMeta =[\s\S]*?)(;\n\ntype DistributiveOmit)/, (_m, head: string, tail: string) =>
  `${head}\n  | { type: '${name}'; reason: string; by: string${fieldDecl} }${tail}`);
// 4. describeDeviceEvent
const tpl = fields.length ? ` · ${fields.map((f) => `\${meta.${f.k}}`).join(' · ')}` : '';
src = src.replace(/(export function describeDeviceEvent\([\s\S]*?switch \(meta\.type\) \{[\s\S]*?)(\n  \}\n\})/, (_m, head: string, tail: string) =>
  `${head}\n    case '${name}': return \`${human}${tpl}\`;${tail}`);
// 5. buildDeviceEvent Extract
src = src.replace(/meta: Extract<ManualMeta, \{ type: ([^}]+) \}>;/, (_m, list: string) => `meta: Extract<ManualMeta, { type: ${list.trim()} | '${name}' }>;`);

const fieldVals = fields.map((f) => `, ${f.k}: ${f.t === 'number' ? '1' : f.t === 'boolean' ? 'true' : `'${f.k}'`}`).join('');
const testCase = `
describe('evento de dispositivo ${name}', () => {
  it('se construye con la forma de ScanEvent y es idempotente en el log', () => {
    const meta = { type: '${name}' as const, by: 'operador'${fieldVals} };
    const e = buildDeviceEvent({ deviceId: 'dev1', seq: 7, zone: 'T', at: '2026-11-20T09:00:00.000Z', meta: { ...meta, reason: describeDeviceEvent(meta) } });
    expect(e.id).toBe('dev1:7');
    expect(e.decision).toBe(DEVICE_EVENT_DECISION);
    expect(e.reasonCode).toBe('${REASON}');
    expect(e.credentialId).toBeNull();
    expect(isDeviceEvent(e)).toBe(true);
    expect(deviceEventType(e)).toBe('${name}');
    expect(describeDeviceEvent(meta)).toContain('${human}');
    const log = createEventLog();
    expect(appendEvents(log, [e]).added).toHaveLength(1);
    expect(appendEvents(log, [e]).duplicates).toBe(1);
  });
});
`;
const testHeader = `import { describe, expect, it } from 'vitest';
import { appendEvents, buildDeviceEvent, createEventLog, DEVICE_EVENT_DECISION, describeDeviceEvent, deviceEventType, isDeviceEvent } from '../src/index.js';
`;
const testOut = existsSync(TEST) ? readFileSync(TEST, 'utf8') + testCase : testHeader + testCase;

if (dry) {
  console.log('--- device-events.ts (fragmentos cambiados) ---');
  for (const line of src.split('\n')) if (line.includes(name) || line.includes(REASON)) console.log(line);
  console.log('--- test ---'); console.log(testCase);
} else {
  writeFileSync(SRC, src);
  writeFileSync(TEST, testOut);
  console.log(`✔ packages/core/src/device-events.ts: tipo '${name}' (reasonCode ${REASON})`);
  console.log(`✔ packages/core/test/device-events.test.ts: caso añadido`);
}
void edits;

console.log(`
Siguientes pasos (skill tatami-sync-protocolo §"Añadir un tipo de evento"):
  1. npm test -w packages/core && npm run build -w packages/core
  2. Host: apps/host/src/reports.ts / repos.ts ignoran decision === 'EVENT'; si debe generar alerta o verse en Puertas en vivo, AlertRepo.fromScans / liveSnapshot. Test en apps/host/test/sync.test.ts (POST /sync/events → accepted 1; standby lo replica).
  3. Scanner: apps/scanner/src/device-events.ts (recordDeviceEvent con meta { type: '${name}', by, … }); dispáralo desde la pantalla/lib que corresponda. Test en apps/scanner/test/device-events.test.ts.
  4. Panel: etiqueta humana en apps/host-admin/src/pages/*.tsx si debe mostrarse.
  5. Docs: docs/30-ARQUITECTURA.md §6, docs/70-UX-WRITING.md (texto "${human}"), docs/80-COMO-PROBAR.md §3, docs/99-CHANGELOG.md.
  6. e2e si nace de un flujo de usuario (spec por TC).
`);
