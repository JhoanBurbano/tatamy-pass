/** Configuración del evento: leer, validar y guardar (archivo + recarga en caliente, versionado). */
import { capacityWarnings, validateEventConfig, type EventConfig } from '@tatami/core';
import type { RouteModule } from './shared.js';

export const registerConfigRoutes: RouteModule = (app, ctx, g) => {
  /** Configuración vigente del evento (`event.config.json` en memoria) y credenciales emitidas por rol. */
  app.get('/config', { preHandler: g.requireUser(g.allRoles) }, async () => ({ config: ctx.config, issuedByRole: ctx.credentials.countByRole() }));

  /** Guarda una configuración nueva: valida con `validateEventConfig`, incrementa `configVersion`, persiste el archivo y recarga en caliente. 409 si `expectedVersion` no coincide. */
  app.put<{ Body: { config: EventConfig; expectedVersion?: number } }>('/config', { preHandler: g.requireUser(['ADMIN']) }, async (req, reply) => {
    const incoming = req.body?.config;
    if (!incoming) return reply.code(400).send({ error: 'Se esperaba { config }.' });
    if (typeof req.body.expectedVersion === 'number' && req.body.expectedVersion !== ctx.config.configVersion) {
      return reply.code(409).send({ error: `Alguien guardó otra versión mientras editabas (v${ctx.config.configVersion}). Recarga y vuelve a intentarlo.` });
    }
    const candidate: EventConfig = { ...incoming, signingKeys: ctx.config.signingKeys, configVersion: ctx.config.configVersion + 1, updatedAt: new Date().toISOString() };
    const errors = validateEventConfig(candidate);
    if (errors.length) return reply.code(400).send({ error: 'La configuración tiene errores.', errors });
    const previous = { ...ctx.config };
    ctx.applyConfig(candidate, { persist: true });
    ctx.radio.reloadConfig();
    g.audit(req.user!.username, 'CONFIG_UPDATED', { fromVersion: previous.configVersion, toVersion: ctx.config.configVersion, previous: { ...previous, signingKeys: undefined } });
    return { config: ctx.config, warnings: capacityWarnings(ctx.config, ctx.credentials.countByRole()), message: 'Configuración guardada. Los scanners la reciben en menos de un minuto.' };
  });

  /** Valida una configuración sin guardarla; devuelve errores por campo y avisos de cupo. */
  app.post<{ Body: { config: EventConfig } }>('/config/validate', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR']) }, async (req) => ({
    errors: validateEventConfig(req.body?.config), warnings: req.body?.config ? capacityWarnings({ ...req.body.config, roles: req.body.config.roles ?? [] }, ctx.credentials.countByRole()) : []
  }));
};
