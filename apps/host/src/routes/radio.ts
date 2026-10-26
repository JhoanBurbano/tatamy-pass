/** Tatami Radio: WebSocket de señalización (`/radio/ws`), estado en vivo e historial del día. Nunca pasa audio por aquí. */
import type { FastifyRequest } from 'fastify';
import { participantId, RADIO_EVENT_DEVICE_ID, radioEventMeta, type RadioParticipant } from '@tatami/core';
import { READERS, type RouteModule } from './shared.js';

/**
 * El navegador no puede poner cabeceras en un WebSocket: el token (de sesión o del
 * scanner) viaja como segundo subprotocolo (`['tatami-radio', '<token>']`) o, si no, en `?token=`.
 */
export function radioToken(req: FastifyRequest): string | undefined {
  const proto = req.headers['sec-websocket-protocol'];
  if (typeof proto === 'string') {
    const parts = proto.split(',').map((s) => s.trim()).filter(Boolean);
    const t = parts.find((p) => p !== 'tatami-radio');
    if (t) return t;
  }
  const q = (req.query as { token?: string } | undefined)?.token;
  if (typeof q === 'string' && q) return q;
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
}

export const registerRadioRoutes: RouteModule = (app, ctx, g) => {
  /**
   * WebSocket de Tatami Radio. Autenticado con el `deviceToken` del scanner o el token de sesión del panel
   * (subprotocolo `tatami-radio` + token, o `?token=`). Mensajes JSON (`RadioClientMessage` / `RadioServerMessage` en core):
   * `join`, `leave`, `offer`, `answer`, `ice`, `ptt-start`, `ptt-end`, `order`, `ack`, `ping`. Solo señalización: el audio va P2P.
   */
  app.get<{ Querystring: { token?: string } }>('/radio/ws', {
    websocket: true,
    preHandler: async (req, reply) => {
      const token = radioToken(req);
      const user = token ? ctx.users.bySession(token) : undefined;
      const dev = !user && token ? ctx.devices.byToken(token) : undefined;
      if (user) req.user = user;
      else if (dev && !dev.disabledAt) { const { token: _t, ...d } = dev; req.device = d; }
      if (!req.user && !req.device) return reply.code(401).send({ error: 'Dispositivo no enrolado o sesión vencida.' });
    }
  }, (socket, req) => {
    const p: RadioParticipant = req.user
      ? { id: participantId('user', req.user.username), name: req.user.username, kind: 'user', role: req.user.role }
      : { id: participantId('device', req.device!.id), name: req.device!.name, kind: 'device', role: req.device!.role, zone: req.device!.zone };
    ctx.radio.attach(socket, p);
  });

  /** Estado de la radio: canales con quién está y quién habla, cola, emergencia activa, equipos conectados y últimas órdenes con sus acuses. */
  app.get('/radio/status', { preHandler: g.requireDeviceOrUser }, async () => ctx.radio.status());

  /** Historial del día (hora local del evento) de la radio: quién habló en qué canal y cuánto, órdenes y acuses, del log append-only. `date=AAAA-MM-DD` opcional. */
  app.get<{ Querystring: { date?: string; limit?: string } }>('/radio/events', { preHandler: g.requireUser(READERS) }, async (req) => {
    const off = ctx.config.utcOffsetMinutes * 60_000;
    const day = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : new Date(Date.now() + off).toISOString().slice(0, 10);
    const start = Date.parse(`${day}T00:00:00.000Z`) - off;
    const from = new Date(start).toISOString(), to = new Date(start + 86_400_000).toISOString();
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 500)), 5000);
    const events = ctx.scans.forDevice(RADIO_EVENT_DEVICE_ID, from, to, limit).map((e) => ({ id: e.id, at: e.at, channel: e.zone, meta: radioEventMeta(e) ?? null }));
    return { date: day, events };
  });
};
