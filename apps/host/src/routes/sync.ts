/** Sync con scanners (snapshot + eventos append-only) y replicación hacia el standby. */
import type { ScanEvent } from '@tatami/core';
import { publicCredential } from '../repos.js';
import { replicationPayload } from '../replication.js';
import type { RouteModule } from './shared.js';

export const registerSyncRoutes: RouteModule = (app, ctx, g) => {
  /** Copia completa para el scanner: config, credenciales (sin PII) y revocaciones, con la hora del host. */
  app.get('/sync/snapshot', { preHandler: g.requireDeviceOrUser }, async () => ({
    serverTime: new Date().toISOString(),
    config: ctx.config,
    credentials: ctx.credentials.all().map(publicCredential),
    revocations: ctx.credentials.revocations()
  }));

  /** Recibe escaneos y eventos de dispositivo (append-only, idempotente por `deviceId:seq`). Un scanner solo puede subir los suyos. Genera alertas. */
  app.post<{ Body: { events: ScanEvent[]; pending?: number } }>('/sync/events', { preHandler: g.requireDeviceOrUser }, async (req, reply) => {
    const events = req.body?.events;
    if (!Array.isArray(events)) return reply.code(400).send({ error: 'Se esperaba { events: [...] }.' });
    for (const e of events) {
      if (!e || typeof e.deviceId !== 'string' || !Number.isInteger(e.seq) || typeof e.zone !== 'string' || typeof e.at !== 'string') {
        return reply.code(400).send({ error: 'Evento inválido en el lote.' });
      }
      if (req.device && e.deviceId !== req.device.id) {
        return reply.code(403).send({ error: 'Un dispositivo solo puede subir sus propios eventos.' });
      }
    }
    const res = ctx.scans.appendBatch(events);
    const maxByDevice = new Map<string, number>();
    for (const e of events) maxByDevice.set(e.deviceId, Math.max(maxByDevice.get(e.deviceId) ?? 0, e.seq));
    const pending = typeof req.body.pending === 'number' ? req.body.pending : (req.device ? 0 : undefined);
    for (const [id, seq] of maxByDevice) ctx.devices.touch(id, seq, pending);
    if (res.accepted > 0) {
      const names = Object.fromEntries(ctx.devices.all().map((d) => [d.id, d.name]));
      ctx.alerts.fromScans(events, names);
    }
    return { ...res, serverTime: new Date().toISOString() };
  });

  /** Eventos recibidos después del cursor `since` (hasta 20000); devuelve el cursor siguiente. */
  app.get<{ Querystring: { since?: string; limit?: string } }>('/sync/events', { preHandler: g.requireDeviceOrUser }, async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 5000), 20000);
    const events = ctx.scans.since(req.query.since, limit);
    const cursor = events.length ? events[events.length - 1].receivedAt! : (req.query.since ?? null);
    return { events, cursor, serverTime: new Date().toISOString() };
  });

  // ---- replicación (primario → standby) ----
  /** Replicación primario → respaldo: copia completa (incluye PII en claro: usar HTTPS fuera de la LAN de staff). */
  app.get<{ Querystring: { auditSeq?: string } }>('/replication/snapshot', { preHandler: g.requireReplica }, async (req) => replicationPayload(ctx, undefined, Number(req.query.auditSeq ?? 0)));
  /** Replicación primario → respaldo: cambios desde `since`, auditoría desde `auditSeq` y config si cambió. */
  app.get<{ Querystring: { since?: string; auditSeq?: string; configVersion?: string } }>('/replication/changes', { preHandler: g.requireReplica }, async (req) =>
    replicationPayload(ctx, req.query.since, Number(req.query.auditSeq ?? 0), Number(req.query.configVersion ?? 0)));
};
