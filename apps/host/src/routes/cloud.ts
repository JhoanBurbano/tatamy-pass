/**
 * Nube (apps/registration → host): estado, traer ahora, vista previa de lo que
 * falta por traer, intervalo editable y lo que la nube ya trajo y sigue
 * pendiente de imprimir/entregar.
 */
import { CloudNotConfigured } from '../cloud-sync.js';
import { publicCredential } from '../repos.js';
import type { RouteModule } from './shared.js';

export const registerCloudRoutes: RouteModule = (app, ctx, g) => {
  const CLOUD_READERS = ['ADMIN', 'COORDINATOR', 'SUPERVISOR', 'AUDITOR', 'PRINTER'] as const;

  /** Estado de la actualización desde la nube: última hora, conteos, intervalo y si el último intento tuvo conexión. */
  app.get('/sync/cloud/status', { preHandler: g.requireUser([...CLOUD_READERS]) }, async () => ctx.cloud.status());

  /** Trae ahora las inscripciones aprobadas de la nube (idempotente por id de inscripción). 503 si no hay conexión, 409 si la nube no está configurada. */
  app.post('/sync/cloud/pull', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR']) }, async (req, reply) => {
    try {
      const result = await ctx.cloud.pull();
      if (!result.ok) return reply.code(503).send({ ...result, status: ctx.cloud.status() });
      return { ...result, status: ctx.cloud.status() };
    } catch (e) {
      if (e instanceof CloudNotConfigured) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  /** Qué hay en la nube desde el último cursor, sin aplicarlo. */
  app.get('/sync/cloud/preview', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR', 'PRINTER']) }, async (_req, reply) => {
    try {
      const r = await ctx.cloud.preview();
      if (!r.ok) return reply.code(503).send({ ...r, error: `Sin conexión a la nube (${r.error}).` });
      return r;
    } catch (e) {
      if (e instanceof CloudNotConfigured) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  /** Cambia el intervalo de actualización periódica (0 = solo manual, máximo 1440 min). Se guarda en la base. */
  app.put<{ Body: { intervalMinutes?: number } }>('/sync/cloud/settings', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR']) }, async (req, reply) => {
    const m = Number(req.body?.intervalMinutes);
    if (!Number.isFinite(m) || m < 0 || m > 1440) return reply.code(400).send({ error: 'El intervalo va de 0 (solo manual) a 1440 minutos.' });
    ctx.cloud.setIntervalMinutes(m);
    g.audit(req.user!.username, 'CLOUD_INTERVAL_CHANGED', { intervalMinutes: m });
    return { ...ctx.cloud.status(), message: m === 0 ? 'Actualización periódica desactivada: solo manual.' : `La nube se consulta cada ${m} min.` };
  });

  /**
   * Inscripciones que la nube ya trajo al host y todavía no tienen credencial
   * impresa/entregada: lo que hay que imprimir antes de que lleguen.
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/registrations/pending', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR', 'PRINTER', 'SUPERVISOR', 'AUDITOR']) }, async (req) => {
    const limit = Math.min(Math.max(1, Number(req.query.limit ?? 50)), 500);
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    const r = ctx.credentials.pendingFromCloud(limit, offset);
    return { ...r, items: r.items.map(publicCredential), cloud: ctx.cloud.status() };
  });
};
