/**
 * Servidor MCP `tatami-host` (stdio): expone al agente herramientas de **solo
 * lectura** sobre el host de Tatami Pass y una de escritura con confirmación
 * explícita. Habla con la API REST del host con un usuario normal (RBAC del
 * host manda: lo que ese usuario no pueda, el agente tampoco).
 *
 * Herramientas:
 *   health             GET /health (+ /system/health si el usuario puede)
 *   gate_summary       GET /reports/gate-summary + GET /live
 *   cloud_status       GET /sync/cloud/status
 *   search_credential  GET /credentials?q= (responde lo mínimo, sin PII)
 *   revoke_credential  POST /credentials/:id/revoke — SOLO si TP_MCP_ALLOW_WRITE=1
 *                      y el agente pasa confirm === "ANULAR <id>" (lo escribe la persona).
 *
 * Variables: TP_HOST_URL (http://127.0.0.1:8787), TP_HOST_USER, TP_HOST_PASSWORD,
 *            TP_HOST_INSECURE=1 (acepta la CA interna de Caddy), TP_MCP_ALLOW_WRITE=1.
 * Uso: `npx tsx scripts/mcp/host-server.ts` (lo arranca Claude Code desde .mcp.json).
 * Límites y flujos: docs/36-AGENTES.md.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const HOST = (process.env.TP_HOST_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const USER = process.env.TP_HOST_USER ?? 'audit';
const PASSWORD = process.env.TP_HOST_PASSWORD ?? 'audit123';
const ALLOW_WRITE = process.env.TP_MCP_ALLOW_WRITE === '1';
if (process.env.TP_HOST_INSECURE === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let token: string | null = null;
let role = '';

async function login(): Promise<void> {
  const r = await fetch(`${HOST}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASSWORD }) })
    .catch((e: Error & { cause?: { code?: string } }) => { throw new Error(`No pude conectar con el host ${HOST}: ${e.cause?.code ?? e.message}`); });
  if (!r.ok) throw new Error(`No pude iniciar sesión en ${HOST} como ${USER}: ${(await r.json().catch(() => ({})) as { error?: string }).error ?? r.status}`);
  const body = (await r.json()) as { token: string; user: { role: string } };
  token = body.token; role = body.user.role;
}

async function api<T = unknown>(path: string, init: RequestInit = {}, retry = true): Promise<{ status: number; body: T }> {
  if (!token) await login();
  const r = await fetch(`${HOST}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
    .catch((e: Error & { cause?: { code?: string } }) => { throw new Error(`No pude conectar con el host ${HOST}: ${e.cause?.code ?? e.message}`); });
  if (r.status === 401 && retry) { token = null; return api<T>(path, init, false); }
  const text = await r.text();
  let body: unknown; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body: body as T };
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

const server = new McpServer({ name: 'tatami-host', version: '0.2.0' });

server.registerTool('health', {
  title: 'Salud del host',
  description: 'Estado del host de Tatami Pass: modo (principal/respaldo), retraso de réplica, conteos, integridad de la auditoría, última copia. Con un usuario con permiso añade reloj, disco, copias, nube y purga. Solo lectura.',
  inputSchema: {}
}, async () => {
  const pub = await api(`/health`);
  const detail = await api(`/system/health`);
  return text({ host: HOST, user: USER, role, health: pub.body, system: detail.status === 200 ? detail.body : `sin permiso (${detail.status})` });
});

server.registerTool('gate_summary', {
  title: 'Resumen de puertas',
  description: 'Entradas, salidas y negados por zona, dispositivo y motivo; credenciales por rol; puertas en vivo (ritmo, pendientes, estado de cada scanner, alertas abiertas). Solo lectura.',
  inputSchema: { includeLive: z.boolean().optional().describe('Incluir GET /live (por defecto sí)') }
}, async ({ includeLive }) => {
  const summary = await api(`/reports/gate-summary`);
  if (summary.status !== 200) return fail(`gate-summary: ${summary.status} ${JSON.stringify(summary.body)}`);
  const live = includeLive === false ? null : await api(`/live`);
  return text({ summary: summary.body, live: live && live.status === 200 ? live.body : undefined });
});

server.registerTool('cloud_status', {
  title: 'Estado de la nube',
  description: 'Última actualización desde la nube (inscripciones aprobadas → host): hora, conteos, intervalo, si el último intento tuvo conexión. Solo lectura.',
  inputSchema: {}
}, async () => {
  const r = await api(`/sync/cloud/status`);
  return r.status === 200 ? text(r.body) : fail(`cloud/status: ${r.status} ${JSON.stringify(r.body)}`);
});

server.registerTool('search_credential', {
  title: 'Buscar credencial',
  description: 'Busca credenciales por ID corto, nombre o club. Devuelve lo mínimo (ID, nombre, rol, estado, zonas, versión), nunca documento ni fecha de nacimiento. Solo lectura.',
  inputSchema: {
    q: z.string().min(2).describe('ID corto (TP-2026-00123-C), nombre o club'),
    limit: z.number().int().min(1).max(50).optional()
  }
}, async ({ q, limit }) => {
  const r = await api<{ items?: Array<Record<string, unknown>>; total?: number }>(`/credentials?q=${encodeURIComponent(q)}&limit=${limit ?? 10}`);
  if (r.status !== 200) return fail(`credentials: ${r.status} ${JSON.stringify(r.body)}`);
  const items = (r.body.items ?? []).map((c) => ({ id: c.id, displayName: c.displayName, roleCode: c.roleCode, status: c.status, zones: c.zones, version: c.version, club: c.club, companionOf: c.companionOf ?? undefined }));
  return text({ total: r.body.total, items });
});

server.registerTool('revoke_credential', {
  title: 'Anular credencial (requiere confirmación)',
  description: 'Anula una credencial en el host. Escritura peligrosa: solo funciona si el servidor arrancó con TP_MCP_ALLOW_WRITE=1 y si `confirm` es exactamente "ANULAR <id>" escrito por la persona (no lo rellenes tú). Deja rastro en la auditoría con el usuario del MCP.',
  inputSchema: {
    id: z.string().describe('ID corto de la credencial, p. ej. TP-2026-00123-C'),
    reason: z.string().min(3).describe('Motivo humano (obligatorio): "perdida", "uso indebido en puerta T1"…'),
    confirm: z.string().describe('Debe ser exactamente "ANULAR <id>", escrito por la persona que autoriza')
  }
}, async ({ id, reason, confirm }) => {
  if (!ALLOW_WRITE) return fail('Escritura desactivada: arranca el servidor con TP_MCP_ALLOW_WRITE=1 si de verdad quieres permitir anulaciones desde un agente. Mientras tanto, indica a la persona el paso en el panel › Credenciales › Anular.');
  if (confirm !== `ANULAR ${id}`) return fail(`Falta la confirmación exacta "ANULAR ${id}". Pídesela a la persona que autoriza (Coordinador o Supervisor); no la escribas tú.`);
  const r = await api<{ error?: string }>(`/credentials/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: JSON.stringify({ reason }) });
  if (r.status !== 200) return fail(`No se anuló (${r.status}): ${r.body?.error ?? JSON.stringify(r.body)}`);
  return text({ ok: true, message: `Credencial ${id} anulada. Los scanners la rechazan en menos de un minuto.`, result: r.body });
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}
main().catch((e) => { console.error(`[tatami-host] ${(e as Error).message}`); process.exit(1); });
