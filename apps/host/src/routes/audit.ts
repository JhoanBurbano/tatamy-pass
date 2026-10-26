/** Auditoría encadenada: página, verificación y exportación CSV/JSON con hash del archivo. */
import { createHash } from 'node:crypto';
import { toCsv } from '../reports.js';
import { AUDITORS, type RouteModule } from './shared.js';

export const registerAuditRoutes: RouteModule = (app, ctx, g) => {
  /** Página del registro de auditoría con filtros por acción y actor; `all=1` devuelve todo. Incluye la verificación de la cadena. */
  app.get<{ Querystring: { offset?: string; limit?: string; action?: string; actor?: string; all?: string } }>('/audit', { preHandler: g.requireUser(AUDITORS) }, async (req) => {
    if (req.query.all === '1') return { records: ctx.audit.all(), verification: ctx.audit.verify() };
    const page = ctx.audit.page({ offset: Number(req.query.offset ?? 0), limit: Number(req.query.limit ?? 50), action: req.query.action || undefined, actor: req.query.actor || undefined });
    return { ...page, verification: ctx.audit.verify(), actions: ctx.audit.actions() };
  });
  /** Verifica la cadena de hashes de la auditoría y devuelve hasta qué número está íntegra. */
  app.get('/audit/verify', { preHandler: g.requireUser(AUDITORS) }, async () => {
    const v = ctx.audit.verify();
    const last = ctx.audit.last();
    return { ...v, count: last?.seq ?? 0, message: v.ok ? `Registro íntegro hasta el número ${last?.seq ?? 0}.` : `El registro fue alterado a partir del número ${v.brokenAt}. No modifiques nada y avisa al Administrador.` };
  });
  /** Exporta toda la auditoría en JSON (por defecto) o CSV (`format=csv`) con huella SHA-256 en `x-content-sha256`. */
  app.get<{ Querystring: { format?: string } }>('/audit/export', { preHandler: g.requireUser(AUDITORS) }, async (req, reply) => {
    const records = ctx.audit.all();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
    let body: string, type: string, ext: string;
    if (req.query.format === 'csv') {
      body = toCsv(records.map((r) => ({ seq: r.seq, at: r.at, actor: r.actor, action: r.action, payload: JSON.stringify(r.payload), prevHash: r.prevHash, hash: r.hash })));
      type = 'text/csv; charset=utf-8'; ext = 'csv';
    } else {
      body = JSON.stringify({ exportedAt: new Date().toISOString(), event: ctx.config.eventId, verification: ctx.audit.verify(), records }, null, 2);
      type = 'application/json'; ext = 'json';
    }
    const sha = createHash('sha256').update(body).digest('hex');
    g.audit(req.user!.username, 'AUDIT_EXPORTED', { format: ext, records: records.length, sha256: sha });
    return reply.type(type).header('x-content-sha256', sha).header('content-disposition', `attachment; filename="auditoria-${stamp}.${ext}"`).send(body);
  });
};
