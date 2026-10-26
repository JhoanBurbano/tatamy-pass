/** Puertas en vivo y alertas (duplicados, manuales, sin conexión) + rechazos por puerta. */
import { liveSnapshot } from '../reports.js';
import type { CredentialRow } from '../repos.js';
import { READERS, type RouteModule } from './shared.js';

export const registerLiveRoutes: RouteModule = (app, ctx, g) => {
  /** Puertas en vivo: ingresos de hoy, ritmo, pendientes, alertas abiertas, tabla por puerta, "dentro ahora" por zona y últimos escaneos. */
  app.get('/live', { preHandler: g.requireUser(READERS) }, async () => {
    ctx.alerts.refreshOffline(ctx.devices.all());
    return liveSnapshot(ctx);
  });

  /** Alertas (duplicados, ingresos manuales, scanners sin conexión) abiertas o resueltas, con la credencial asociada. */
  app.get<{ Querystring: { status?: 'OPEN' | 'RESOLVED' } }>('/alerts', { preHandler: g.requireUser(READERS) }, async (req) => {
    ctx.alerts.refreshOffline(ctx.devices.all());
    const items = ctx.alerts.list(req.query.status || undefined);
    const creds = new Map<string, CredentialRow>();
    for (const a of items) if (a.credentialId && !creds.has(a.credentialId)) { const c = ctx.credentials.byId(a.credentialId); if (c) creds.set(a.credentialId, c); }
    return { items: items.map((a) => ({ ...a, credential: a.credentialId && creds.get(a.credentialId) ? { id: a.credentialId, displayName: creds.get(a.credentialId)!.displayName, roleCode: creds.get(a.credentialId)!.roleCode } : null })), open: ctx.alerts.countOpen() };
  });

  /** Intentos de ingreso denegados hoy, por puerta y por motivo, con los últimos casos. */
  app.get<{ Querystring: { limit?: string } }>('/alerts/denied', { preHandler: g.requireUser(READERS) }, async (req) => {
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 50)), 500);
    const live = liveSnapshot(ctx);
    const names = Object.fromEntries(ctx.devices.all().map((d) => [d.id, d.name]));
    const denied = ctx.scans.deniedToday(ctx.config.utcOffsetMinutes, limit);
    const creds = new Map<string, CredentialRow>();
    for (const e of denied.recent) if (e.credentialId && !creds.has(e.credentialId)) { const c = ctx.credentials.byId(e.credentialId); if (c) creds.set(e.credentialId, c); }
    return {
      date: live.date, total: denied.total,
      byGate: live.gates.map((gt) => ({ deviceId: gt.deviceId, name: gt.name, zone: gt.zone, zoneName: gt.zoneName, denied: gt.denied, today: gt.today })),
      byReason: denied.byReason,
      recent: denied.recent.map((e) => ({ ...e, device: names[e.deviceId] ?? e.deviceId, credential: e.credentialId && creds.get(e.credentialId) ? { id: e.credentialId, displayName: creds.get(e.credentialId)!.displayName, roleCode: creds.get(e.credentialId)!.roleCode } : null }))
    };
  });

  /** Resuelve una alerta con una nota obligatoria. */
  app.post<{ Params: { id: string }; Body: { note?: string } }>('/alerts/:id/resolve', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR', 'SUPERVISOR']) }, async (req, reply) => {
    const a = ctx.alerts.byId(req.params.id);
    if (!a) return reply.code(404).send({ error: 'Alerta no encontrada.' });
    if (a.status === 'RESOLVED') return reply.code(409).send({ error: 'Esta alerta ya está resuelta.' });
    const note = req.body?.note?.trim();
    if (!note) return reply.code(400).send({ error: 'Escribe una nota con lo que se decidió.' });
    const r = ctx.alerts.resolve(a.id, req.user!.username, note);
    g.audit(req.user!.username, 'ALERT_RESOLVED', { alertId: a.id, kind: a.kind, note });
    return r;
  });
};
