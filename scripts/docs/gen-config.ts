/**
 * Genera `docs/32-CONFIG-EVENTO.md`: documenta `event.config.json` campo por
 * campo leyendo los tipos de `packages/core/src/types.ts` (interfaces
 * `EventConfig`, `Zone`, `AccessRole`, `AgeCategory`, `SigningKey` con sus
 * JSDoc), los valores por defecto de `packages/core/src/default-config.ts` y
 * las reglas de `packages/core/src/config-validation.ts`.
 *
 * Uso: `npm run docs:gen` (o `tsx scripts/docs/gen-config.ts`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createDefaultConfig, DEFAULT_AGE_CATEGORIES, DEFAULT_ROLES, DEFAULT_ZONES } from '../../packages/core/src/index.ts';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..');
const TYPES = join(ROOT, 'packages', 'core', 'src', 'types.ts');
const VALIDATION = join(ROOT, 'packages', 'core', 'src', 'config-validation.ts');
const OUT = join(ROOT, 'docs', '32-CONFIG-EVENTO.md');

interface Field { name: string; type: string; doc: string; optional: boolean }

/** Extrae los campos (con JSDoc) de una interfaz de `types.ts`. */
function parseInterface(src: string, name: string): { doc: string; fields: Field[] } {
  const re = new RegExp(`(/\\*\\*(?:(?!\\*/)[\\s\\S])*\\*/)?\\s*export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = src.match(re);
  if (!m) throw new Error(`No encuentro la interfaz ${name} en types.ts`);
  const doc = cleanDoc(m[1] ?? '');
  const fields: Field[] = [];
  let pending = '';
  for (const raw of m[2].split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('/**')) { pending = cleanDoc(line); continue; }
    if (line.startsWith('*') || line.startsWith('//')) continue;
    const f = line.match(/^(\w+)(\?)?:\s*(.+?);$/);
    if (f) { fields.push({ name: f[1], optional: Boolean(f[2]), type: f[3], doc: pending }); pending = ''; }
  }
  return { doc, fields };
}

function cleanDoc(s: string): string {
  return s.replace(/\/\*\*|\*\//g, '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ');
}

/** Reglas de validación: mensajes por campo (`err('path', 'mensaje')`), agrupadas por prefijo. */
function parseRules(src: string): Map<string, string[]> {
  const rules = new Map<string, string[]>();
  for (const m of src.matchAll(/err\((`[^`]+`|'[^']+')\s*,\s*(`[^`]+`|'[^']+')\)/g)) {
    const path = m[1].slice(1, -1).replace(/\$\{i\}/g, 'n').replace(/\[n\]/g, '[]');
    const msg = m[2].slice(1, -1).replace(/\$\{[^}]+\}/g, '…');
    if (!rules.has(path)) rules.set(path, []);
    if (!rules.get(path)!.includes(msg)) rules.get(path)!.push(msg);
  }
  return rules;
}

function fmt(v: unknown): string {
  if (v === null) return '`null` (sin límite)';
  if (v && typeof v === 'object' && 'channels' in (v as object)) return 'canales y órdenes por defecto (ver §5.3)';
  if (Array.isArray(v)) return v.length > 3 ? `${v.length} elementos (ver más abajo)` : v.length ? '`' + JSON.stringify(v) + '`' : '`[]`';
  if (typeof v === 'object') return '`' + JSON.stringify(v) + '`';
  return '`' + JSON.stringify(v) + '`';
}

const typesSrc = readFileSync(TYPES, 'utf8');
const rules = parseRules(readFileSync(VALIDATION, 'utf8'));
const defaults = createDefaultConfig();
const cfg = parseInterface(typesSrc, 'EventConfig');
const zone = parseInterface(typesSrc, 'Zone');
const role = parseInterface(typesSrc, 'AccessRole');
const cat = parseInterface(typesSrc, 'AgeCategory');
const key = parseInterface(typesSrc, 'SigningKey');
const reg = parseInterface(typesSrc, 'RegistrationOptions');
const person = parseInterface(typesSrc, 'Person');
const emergency = parseInterface(typesSrc, 'EmergencyContact');
const eps = parseInterface(typesSrc, 'Eps');
const radio = parseInterface(typesSrc, 'RadioConfig');
const radioChannel = parseInterface(typesSrc, 'RadioChannel');
const radioOrder = parseInterface(typesSrc, 'RadioOrderTemplate');

const rulesFor = (prefix: string, field: string) => {
  const list = [...(rules.get(`${prefix}${field}`) ?? [])];
  return list.length ? list.map((r) => r.replace(/\|/g, '\\|')).join(' · ') : '—';
};

function fieldTable(fields: Field[], prefix: string, defaultsOf?: Record<string, unknown>): string {
  const head = ['| Campo | Tipo | Qué es | Por defecto | Validación |', '|---|---|---|---|---|'];
  const rows = fields.map((f) => {
    const d = defaultsOf && f.name in defaultsOf ? fmt(defaultsOf[f.name]) : '—';
    return `| \`${f.name}\`${f.optional ? ' (opcional)' : ''} | \`${f.type.replace(/\|/g, '\\|')}\` | ${f.doc || '—'} | ${d} | ${rulesFor(prefix, f.name)} |`;
  });
  return [...head, ...rows].join('\n');
}

const SPECIAL: Record<string, string> = {
  signingKeys: 'El host la **sobrescribe al arrancar** con la clave pública de `keys/signing.enc.json` (`kid` + `publicKeyHex`), así que no hace falta editarla a mano. Los scanners la reciben en el snapshot y con ella verifican los QR.',
  configVersion: 'La incrementa el host en cada `PUT /config`. El panel la envía como `expectedVersion`: si otro admin guardó antes, 409.',
  updatedAt: 'La pone el host al guardar.',
  zones: 'Ver §2.',
  roles: 'Ver §3.',
  ageCategories: 'Ver §4.',
  registration: 'Ver §5.1.',
  radio: 'Ver §5.3.'
};

const out: string[] = [];
out.push('# 32 · Configuración del evento (`event.config.json`)');
out.push('');
out.push('> **Generado automáticamente** por `scripts/docs/gen-config.ts` (`npm run docs:gen`) a partir de `packages/core/src/types.ts`, `default-config.ts` y `config-validation.ts`. Para cambiar algo aquí, cambia el JSDoc del tipo o la regla de validación y vuelve a generar.');
out.push('');
out.push('El archivo vive en `apps/host/event.config.json` (o donde apunte `TP_EVENT_CONFIG`). Se edita desde el panel › **Evento y roles** (valida, guarda y recarga en caliente) o a mano con el host apagado. La nube (`apps/registration`) usa la misma forma (`EVENT_CONFIG_PATH`) para cupos, edades y acompañantes del formulario. Cómo cambiar roles y cupos paso a paso: [50-OPERACION.md §5](./50-OPERACION.md).');
out.push('');
out.push('## 1. Raíz (`EventConfig`)');
out.push('');
if (cfg.doc) out.push(cfg.doc, '');
out.push(fieldTable(cfg.fields.map((f) => ({ ...f, doc: SPECIAL[f.name] ? `${f.doc ? f.doc + ' ' : ''}${SPECIAL[f.name]}` : f.doc })), '', defaults as unknown as Record<string, unknown>));
out.push('');
out.push('## 2. Zonas (`zones[]`, tipo `Zone`)');
out.push('');
out.push(zone.doc || 'Una zona es un espacio con control de acceso (una o varias puertas).', '');
out.push(fieldTable(zone.fields, 'zones[].'));
out.push('');
out.push('Reglas de la lista: ' + rulesFor('', 'zones'));
out.push('');
out.push('Zonas por defecto:');
out.push('');
out.push('| Código | Nombre | Controla salida |', '|---|---|---|');
for (const z of DEFAULT_ZONES) out.push(`| \`${z.code}\` | ${z.name} | ${z.tracksExit ? 'sí' : 'no'} |`);
out.push('');
out.push('## 3. Roles de acceso (`roles[]`, tipo `AccessRole`)');
out.push('');
out.push(role.doc, '');
out.push(fieldTable(role.fields, 'roles[].'));
out.push('');
out.push('Reglas de la lista: ' + rulesFor('', 'roles') + ' El rol `ACOMP` (acompañante) es especial: no cuenta contra su propio cupo sino contra `companions` y `totalCapacity` (ver [00-DECISIONES.md §7](./00-DECISIONES.md)).');
out.push('');
out.push('Roles por defecto:');
out.push('');
out.push('| Código | Nombre | Zonas | Cupo | Foto | Digital | Anti-passback | Color |', '|---|---|---|---|---|---|---|---|');
for (const r of DEFAULT_ROLES) out.push(`| \`${r.code}\` | ${r.name} | ${r.zones.join(', ')} | ${r.capacity ?? 'sin límite'} | ${r.requiresPhoto ? 'sí' : 'no'} | ${r.allowsDigital ? 'sí' : 'no'} | ${r.antiPassbackZones.length ? r.antiPassbackZones.join(', ') : '—'} | \`${r.color}\` |`);
out.push('');
out.push('## 4. Categorías de edad (`ageCategories[]`, tipo `AgeCategory`)');
out.push('');
out.push('La edad se calcula a la fecha de `startDate`. Un competidor (`COMP`) debe caer en una categoría; si elige otra, el formulario y la emisión en sitio lo bloquean y explican cuál le corresponde.', '');
out.push(fieldTable(cat.fields, 'ageCategories[].'));
out.push('');
out.push('Reglas de la lista: ' + rulesFor('', 'ageCategories'));
out.push('');
out.push('| Código | Nombre | Edad | Cupo |', '|---|---|---|---|');
for (const c of DEFAULT_AGE_CATEGORIES) out.push(`| \`${c.code}\` | ${c.name} | ${c.minAge}–${c.maxAge ?? '∞'} | ${c.capacity ?? 'sin límite'} |`);
out.push('');
out.push('## 5. Claves de firma (`signingKeys[]`, tipo `SigningKey`)');
out.push('');
out.push(fieldTable(key.fields, 'signingKeys[].'));
out.push('');
out.push('### 5.1 Opciones de inscripción (`registration`, tipo `RegistrationOptions`)');
out.push('');
out.push(reg.doc || '', '');
out.push(fieldTable(reg.fields, 'registration.'));
out.push('');
out.push('### 5.2 Persona (`Person`): campos que se imprimen en la credencial');
out.push('');
out.push('No viven en `event.config.json` sino en cada persona (nube → host, SportData o emisión en sitio). La plantilla de credencial ([33-DISENO-CREDENCIAL.md](./33-DISENO-CREDENCIAL.md)) decide cuáles se imprimen (`privacy`).', '');
out.push(fieldTable(person.fields.filter((f) => ['delegation', 'emergencyContact', 'eps', 'documentNumber', 'club'].includes(f.name)), 'person.'));
out.push('');
out.push('`EmergencyContact`: ' + emergency.doc, '');
out.push(fieldTable(emergency.fields, 'person.emergencyContact.'));
out.push('');
out.push('`Eps`: ' + eps.doc, '');
out.push(fieldTable(eps.fields, 'person.eps.'));
out.push('');
out.push('### 5.3 Tatami Radio (`radio`, tipo `RadioConfig`)');
out.push('');
out.push((radio.doc || '') + ' Cómo funciona, límites y requisitos de red: [34-VOZ-RADIO.md](./34-VOZ-RADIO.md) y ADR-0010. Se edita desde el panel › **Radio** › Canales y órdenes.', '');
out.push(fieldTable(radio.fields, 'radio.', defaults.radio as unknown as Record<string, unknown>));
out.push('');
out.push('Reglas de la lista de canales: ' + rulesFor('', 'radio.channels') + ' · ' + rulesFor('', 'radio'));
out.push('');
out.push('`RadioChannel` (`radio.channels[]`): ' + radioChannel.doc, '');
out.push(fieldTable(radioChannel.fields, 'radio.channels[].'));
out.push('');
out.push('Canales por defecto:');
out.push('');
out.push('| Id | Nombre | Hablan | Escuchan | Prioridad | Emergencia | Color |', '|---|---|---|---|---|---|---|');
for (const c of defaults.radio!.channels) out.push(`| \`${c.id}\` | ${c.name} | ${c.talk.join(', ')} | ${c.listen.join(', ')} | ${c.priority} | ${c.emergency ? 'sí' : 'no'} | \`${c.color}\` |`);
out.push('');
out.push('`RadioOrderTemplate` (`radio.orders[]`): ' + radioOrder.doc, '');
out.push(fieldTable(radioOrder.fields, 'radio.orders[].'));
out.push('');
out.push('Órdenes por defecto:');
out.push('');
out.push('| Código | Texto | Pide puerta | Emergencia |', '|---|---|---|---|');
for (const o of defaults.radio!.orders) out.push(`| \`${o.code}\` | ${o.label} | ${o.requiresGate ? 'sí' : 'no'} | ${o.emergency ? 'sí' : 'no'} |`);
out.push('');
out.push('## 6. Ejemplo mínimo válido');
out.push('');
const example = createDefaultConfig({ zones: DEFAULT_ZONES.slice(0, 3), roles: DEFAULT_ROLES.filter((r) => ['GEN', 'COMP', 'STAFF'].includes(r.code)).map((r) => ({ ...r, zones: r.zones.filter((z) => z === '*' || ['G', 'W', 'T'].includes(z)), antiPassbackZones: r.antiPassbackZones.filter((z) => ['W', 'T'].includes(z)) })), ageCategories: DEFAULT_AGE_CATEGORIES.slice(0, 2) });
out.push('```json');
out.push(JSON.stringify(example, null, 2));
out.push('```');
out.push('');
out.push('## 7. Cómo validar antes de guardar');
out.push('');
out.push('- Panel › Evento y roles marca el campo con error (misma función `validateEventConfig`).');
out.push('- API: `POST /config/validate` con `{ config }` devuelve `{ errors: [{ path, message }], warnings }` sin guardar.');
out.push('- Consola: `npx tsx -e "import(\'@tatami/core\').then(m => console.log(m.validateEventConfig(JSON.parse(require(\'fs\').readFileSync(\'apps/host/event.config.json\',\'utf8\')))))"` desde la raíz (tras `npm run build -w packages/core`).');
out.push('- Skill para agentes: `.claude/skills/tatami-evento-config/SKILL.md`.');
out.push('');
writeFileSync(OUT, out.join('\n'));
console.log(`[docs:gen] ${relative(ROOT, OUT)} · ${cfg.fields.length} campos raíz · ${rules.size} reglas`);
