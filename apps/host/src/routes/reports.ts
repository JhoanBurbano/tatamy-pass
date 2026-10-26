/** Reportes: resumen de puertas y cierre del día (JSON/CSV). */
import { dayCloseCsv, dayCloseReport } from '../reports.js';
import { READERS, type RouteModule } from './shared.js';

export const registerReportRoutes: RouteModule = (app, ctx, g) => {
  /** Resumen por puerta: entradas, salidas, negados por motivo, por zona y por dispositivo, más credenciales por rol. */
  app.get('/reports/gate-summary', { preHandler: g.requireUser(READERS) }, async () => ({
    ...ctx.scans.gateSummary(),
    credentialsByRole: ctx.credentials.countByRole(),
    devices: ctx.devices.all().map((d) => ({ id: d.id, name: d.name, zone: d.zone, lastSeq: d.lastSeq })),
    generatedAt: new Date().toISOString()
  }));
  /** Reporte de cierre del día (`date=YYYY-MM-DD`, por defecto hoy) en JSON o CSV (`format=csv`). */
  app.get<{ Querystring: { date?: string; format?: string } }>('/reports/day-close', { preHandler: g.requireUser(READERS) }, async (req, reply) => {
    const date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
    const r = dayCloseReport(ctx, date);
    if (req.query.format === 'csv') return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="cierre-${r.date}.csv"`).send(dayCloseCsv(r));
    return r;
  });
};
