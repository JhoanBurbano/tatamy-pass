/**
 * Genera `docs/31-API-REFERENCIA.md` a partir del código:
 * - Host (`apps/host/src/routes/*.ts`): método, ruta, guarda/roles y el JSDoc
 *   que precede a cada `app.<método>('/ruta', ...)`.
 * - Nube (`apps/registration/app/api/** /route.ts` y los `route.ts` del panel):
 *   método (export GET/POST…), ruta derivada de la carpeta, autenticación
 *   detectada por los helpers usados y el JSDoc del handler.
 *
 * Uso: `npm run docs:gen` (o `tsx scripts/docs/gen-api.ts`). No toca el código.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..', '..');
const HOST_ROUTES = join(ROOT, 'apps', 'host', 'src', 'routes');
const REG_APP = join(ROOT, 'apps', 'registration', 'app');
const OUT = join(ROOT, 'docs', '31-API-REFERENCIA.md');

const ROLE_NAMES: Record<string, string> = {
  ADMIN: 'Administrador', COORDINATOR: 'Coordinador', PRINTER: 'Operador de impresión', CLUB: 'Inscriptor (club)',
  CONTROL: 'Control de entradas', SUPERVISOR: 'Supervisor', AUDITOR: 'Auditor'
};

interface Route { method: string; path: string; auth: string; description: string; file: string; line: number }

// ---------- helpers ----------
function walk(dir: string, filter: (p: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

/** Extrae el JSDoc (`/** … *\/`) que termina justo antes de la línea `idx` (saltando líneas en blanco). */
function jsdocBefore(lines: string[], idx: number): string {
  let i = idx - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  if (i < 0 || !lines[i].trim().endsWith('*/')) return '';
  const end = i;
  while (i >= 0 && !lines[i].includes('/**')) i--;
  if (i < 0) return '';
  return lines.slice(i, end + 1).join('\n')
    .replace(/^\s*\/\*\*\s?/, '').replace(/\s*\*\/\s*$/, '')
    .split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').replace(/\s+/g, ' ').trim();
}

function parseArray(expr: string, consts: Map<string, string[]>): string[] {
  const roles: string[] = [];
  for (const m of expr.matchAll(/'([A-Z_]+)'/g)) roles.push(m[1]);
  for (const m of expr.matchAll(/\.\.\.([A-Za-z_]+)/g)) roles.push(...(consts.get(m[1]) ?? [`?${m[1]}`]));
  return [...new Set(roles)];
}

function describeAuth(expr: string | undefined, consts: Map<string, string[]>): string {
  if (!expr) return 'Público (sin sesión)';
  if (expr.includes('requireDeviceOrUser')) return 'Scanner enrolado (`deviceToken`) o usuario';
  if (expr.includes('requireReplica')) return 'Clave de replicación (`TP_REPLICA_KEY`) o Administrador';
  const m = expr.match(/requireUser\(([^)]*\)?)\)/);
  if (!m) return 'Sesión de usuario';
  const arg = m[1].trim();
  if (arg === 'g.allRoles') return 'Cualquier usuario con sesión';
  let roles: string[];
  if (arg.startsWith('[')) roles = parseArray(arg, consts);
  else roles = consts.get(arg) ?? [`?${arg}`];
  return roles.map((r) => ROLE_NAMES[r] ?? r).join(', ');
}

// ---------- host ----------
function hostRoutes(): Route[] {
  const consts = new Map<string, string[]>();
  const shared = readFileSync(join(HOST_ROUTES, 'shared.ts'), 'utf8');
  for (const m of shared.matchAll(/export const ([A-Z_]+): UserRole\[\] = \[([^\]]*)\]/g)) consts.set(m[1], parseArray(m[2], consts));
  const routes: Route[] = [];
  for (const file of readdirSync(HOST_ROUTES).filter((f) => f.endsWith('.ts') && f !== 'shared.ts').sort()) {
    const src = readFileSync(join(HOST_ROUTES, file), 'utf8');
    const lines = src.split('\n');
    for (const m of src.matchAll(/const ([A-Z_]+) = \[([^\]]*)\] as const/g)) consts.set(m[1], parseArray(m[2], consts));
    lines.forEach((line, i) => {
      const m = line.match(/^\s*app\.(get|post|put|patch|delete)(?:<[^>]*(?:>[^(]*)?>)?\(\s*'([^']+)'\s*,\s*(.*)$/);
      if (!m) return;
      const guard = m[3].match(/preHandler:\s*([^}]*)\}/)?.[1];
      const ws = /websocket:\s*true/.test(m[3]);
      routes.push({ method: ws ? 'WS' : m[1].toUpperCase(), path: m[2], auth: ws ? 'Scanner enrolado (`deviceToken`) o usuario: token como subprotocolo del WebSocket o `?token=`' : describeAuth(guard, consts), description: jsdocBefore(lines, i) || '—', file: `apps/host/src/routes/${file}`, line: i + 1 });
    });
  }
  return routes;
}

// ---------- nube ----------
function cloudRoutes(): Route[] {
  const files = walk(REG_APP, (p) => p.endsWith('route.ts')).sort();
  const routes: Route[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const rel = relative(REG_APP, file).replace(/\\/g, '/').replace(/\/route\.ts$/, '');
    const path = '/' + rel.replace(/\[([^\]]+)\]/g, ':$1');
    let auth = 'Público (sin sesión)';
    if (/checkCloudKey|x-tatami-key/.test(src)) auth = 'Clave compartida del host (`x-tatami-key`)';
    if (/CRON_SECRET/.test(src)) auth += ' o cron de Vercel (`Authorization: Bearer CRON_SECRET`)';
    const req = src.match(/requireUser(?:OrThrow)?\(\s*\[([^\]]*)\]/);
    if (req) auth = 'Sesión del panel: ' + req[1].replace(/'/g, '').split(',').map((s) => s.trim()).filter(Boolean).join(', ');
    else if (/requireUser(?:OrThrow)?\(\)/.test(src)) auth = 'Sesión del panel (cualquier rol)';
    if (/rateLimit|rate-limit/.test(src)) auth += ' · con límite de peticiones';
    lines.forEach((line, i) => {
      const m = line.match(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/);
      if (!m) return;
      routes.push({ method: m[1], path, auth, description: jsdocBefore(lines, i) || '—', file: `apps/registration/app/${rel}/route.ts`, line: i + 1 });
    });
  }
  return routes;
}

// ---------- render ----------
function table(routes: Route[]): string {
  const rows = routes.map((r) => `| \`${r.method}\` | \`${r.path}\` | ${r.auth} | ${r.description.replace(/\|/g, '\\|')} | [${r.file.split('/').pop()}:${r.line}](../${r.file}#L${r.line}) |`);
  return ['| Método | Ruta | Quién puede | Qué hace | Código |', '|---|---|---|---|---|', ...rows].join('\n');
}

function groupHost(routes: Route[]): Map<string, Route[]> {
  const groups = new Map<string, Route[]>();
  const titles: Record<string, string> = {
    'auth.ts': 'Sesión y usuarios', 'devices.ts': 'Scanners (enrolamiento)', 'sync.ts': 'Sync con scanners y replicación', 'cloud.ts': 'Nube → host',
    'credentials.ts': 'Credenciales', 'print.ts': 'Impresión por lotes', 'live.ts': 'Puertas en vivo y alertas', 'config.ts': 'Configuración del evento',
    'reports.ts': 'Reportes', 'audit.ts': 'Auditoría', 'system.ts': 'Sistema: salud, copias, respaldo, purga', 'radio.ts': 'Tatami Radio (voz por la LAN)'
  };
  for (const r of routes) {
    const f = r.file.split('/').pop()!;
    const t = titles[f] ?? f;
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(r);
  }
  return groups;
}

const host = hostRoutes();
const cloud = cloudRoutes();
const out: string[] = [];
out.push('# 31 · Referencia de la API');
out.push('');
out.push('> **Generado automáticamente** por `scripts/docs/gen-api.ts` (`npm run docs:gen`). No lo edites a mano: cambia el JSDoc de la ruta en el código y vuelve a generar. Las rutas sin comentario aparecen con «—»: es una deuda que hay que pagar en el mismo PR.');
out.push('');
out.push(`Rutas del host: **${host.length}** · rutas de la nube: **${cloud.length}**. Roles del host: ${Object.entries(ROLE_NAMES).map(([k, v]) => `\`${k}\` (${v})`).join(', ')}.`);
out.push('');
out.push('## 1. Host (`apps/host`, Fastify, puerto 8787)');
out.push('');
out.push('Autenticación: `Authorization: Bearer <token>` con el token de `POST /auth/login` (usuarios) o el `deviceToken` de `POST /devices/enroll` (scanners). En el equipo de respaldo toda escritura responde `409`. Los errores llegan como `{ error: "mensaje en español" }` y, en validaciones de formulario, `errors: [{ path, message }]`.');
out.push('');
for (const [title, routes] of groupHost(host)) {
  out.push(`### ${title}`);
  out.push('');
  out.push(table(routes));
  out.push('');
}
out.push('## 2. Nube (`apps/registration`, Next.js App Router)');
out.push('');
out.push('Tres formas de entrar: público (inscripción y estado), sesión del panel (cookie; roles `admin`, `coord`, `club`) y clave compartida con el host (`x-tatami-key` = `TP_CLOUD_KEY`). Detalle de despliegue en [85-DESPLIEGUE-NUBE.md](./85-DESPLIEGUE-NUBE.md).');
out.push('');
out.push(table(cloud));
out.push('');
out.push('## 3. Cómo mantener esta referencia');
out.push('');
out.push('1. Cada ruta nueva del host lleva un `/** … */` justo encima de `app.<método>(...)` que diga **qué hace** y, si aplica, qué confirma o qué código de error devuelve.');
out.push('2. Cada `route.ts` de la nube lleva el JSDoc encima de `export async function GET|POST`.');
out.push('3. Corre `npm run docs:gen` y revisa el diff de este archivo en el PR (`scripts/agent/check-all.sh` falla si queda desactualizado).');
out.push('');
writeFileSync(OUT, out.join('\n'));
console.log(`[docs:gen] ${relative(ROOT, OUT)} · host ${host.length} rutas · nube ${cloud.length} rutas`);
const missing = [...host, ...cloud].filter((r) => r.description === '—');
if (missing.length) console.log(`[docs:gen] sin JSDoc: ${missing.map((r) => `${r.method} ${r.path}`).join(', ')}`);
