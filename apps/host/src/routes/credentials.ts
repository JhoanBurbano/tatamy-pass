/**
 * Credenciales: búsqueda, ficha, revocar, re-emitir, entregar, QR/token, PDF
 * individual y emisión manual en sitio (p. ej. prensa que llega sin acreditar).
 */
import { ageOn, categoryForAge, COMPANION_ROLE, isIsoDate, validateCompanions, type Person } from '@tatami/core';
import { publicCredential, type CredentialRow, type CredentialSearch } from '../repos.js';
import type { UserRole } from '../auth.js';
import { CRED_READERS, type RouteModule } from './shared.js';

export interface IssueBody {
  firstName: string; lastName: string; roleCode: string; birthDate?: string; documentNumber?: string; club?: string; categoryCode?: string;
  guardian?: { name: string; document: string }; photoUrl?: string; companionOf?: string | null; relationship?: string; note?: string;
}

export const registerCredentialRoutes: RouteModule = (app, ctx, g) => {
  const forRole = (c: CredentialRow, role: UserRole) => (role === 'AUDITOR' || role === 'SUPERVISOR' ? publicCredential(c) : c);

  /** Busca credenciales por texto (`q`), rol, estado, club o documento (por HMAC, nunca descifra). Paginado con `limit`/`offset`. */
  app.get<{ Querystring: CredentialSearch & { limit?: string; offset?: string } }>('/credentials', { preHandler: g.requireUser(CRED_READERS) }, async (req) => {
    const q = req.query;
    const ids = q.document?.trim() ? ctx.persons.byDocument(q.document.trim()).map((p) => p.id) : undefined;
    const res = ctx.credentials.search({ q: q.q, roleCode: q.roleCode || undefined, status: q.status || undefined, club: q.club || undefined, limit: Number(q.limit ?? 50), offset: Number(q.offset ?? 0) }, ids);
    return { ...res, items: res.items.map((c) => forRole(c, req.user!.role)) };
  });
  /** Lista de clubes con credenciales (para filtros). */
  app.get('/credentials/clubs', { preHandler: g.requireUser(CRED_READERS) }, async () => ctx.credentials.clubs());

  /** Ficha completa: persona (PII solo para admin/coordinador), anulaciones, acompañantes, participante e historial de escaneos. */
  app.get<{ Params: { id: string } }>('/credentials/:id', { preHandler: g.requireUser(CRED_READERS) }, async (req, reply) => {
    const c = ctx.credentials.byId(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Credencial no encontrada.' });
    const person = ctx.persons.byId(c.personId);
    const role = req.user!.role;
    const canSeePii = role === 'ADMIN' || role === 'COORDINATOR';
    return {
      ...forRole(c, role),
      person: person ? { id: person.id, firstName: person.firstName, lastName: person.lastName, club: person.club, source: person.source, relationship: person.relationship,
        birthDate: canSeePii ? person.birthDate : undefined, documentNumber: canSeePii ? person.documentNumber : undefined, guardian: canSeePii ? person.guardian : undefined, purgedAt: person.purgedAt } : null,
      revocations: ctx.credentials.revocations().filter((r) => r.credentialId === c.id),
      companions: ctx.credentials.companionsOf(c.id).map(publicCredential),
      participant: c.companionOf ? (ctx.credentials.byId(c.companionOf) ? publicCredential(ctx.credentials.byId(c.companionOf)!) : null) : null,
      scans: ctx.scans.allForCredential(c.id, 100)
    };
  });

  /** Token firmado del QR (lo que va impreso o en la credencial digital). */
  app.get<{ Params: { id: string } }>('/credentials/:id/token', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR', 'PRINTER']) }, async (req, reply) => {
    const c = ctx.credentials.byId(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Credencial no encontrada.' });
    g.audit(req.user!.username, 'CREDENTIAL_TOKEN_VIEWED', { credentialId: c.id, version: c.version });
    return { id: c.id, version: c.version, status: c.status, token: c.token };
  });

  /** Acompañantes ligados a una credencial, con los límites configurados y el uso actual. */
  app.get<{ Params: { id: string } }>('/credentials/:id/companions', { preHandler: g.requireUser(CRED_READERS) }, async (req, reply) => {
    const c = ctx.credentials.byId(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Credencial no encontrada.' });
    const companions = ctx.credentials.companionsOf(c.id).map(publicCredential);
    return {
      participant: publicCredential(c), companions, count: companions.length,
      limits: { perParticipant: ctx.config.companions.perParticipant, total: ctx.config.companions.total, totalCapacity: ctx.config.totalCapacity },
      usedCompanionsTotal: ctx.credentials.countCompanions(), usedTotalEvent: ctx.credentials.count()
    };
  });

  /** Anula una credencial (motivo obligatorio). Los scanners la reciben en la lista de revocaciones. */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/credentials/:id/revoke', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR', 'SUPERVISOR']) }, async (req, reply) => {
    const c = ctx.credentials.byId(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Credencial no encontrada.' });
    if (c.status === 'REVOKED') return reply.code(409).send({ error: 'Esta credencial ya está anulada.' });
    const reason = req.body?.reason?.trim();
    if (!reason) return reply.code(400).send({ error: 'Escribe el motivo de la anulación.' });
    const rev = ctx.credentials.revoke(c.id, req.user!.username, reason);
    g.audit(req.user!.username, 'CREDENTIAL_REVOKED', { credentialId: c.id, reason });
    return { revocation: rev, credential: publicCredential(ctx.credentials.byId(c.id)!) };
  });

  /** Re-emite con versión nueva; la versión anterior queda anulada automáticamente. */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>('/credentials/:id/reissue', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR']) }, async (req, reply) => {
    const c = ctx.credentials.byId(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Credencial no encontrada.' });
    const reason = req.body?.reason?.trim() || 'Sin motivo';
    const next = ctx.credentials.reissue(c.id, req.user!.username, reason);
    g.audit(req.user!.username, 'CREDENTIAL_REISSUED', { credentialId: c.id, fromVersion: c.version, toVersion: next.version, reason });
    return { credential: next };
  });

  /** Marca la credencial como entregada (no aplica a anuladas). */
  app.post<{ Params: { id: string } }>('/credentials/:id/deliver', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR', 'PRINTER']) }, async (req, reply) => {
    const c = ctx.credentials.byId(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Credencial no encontrada.' });
    if (c.status === 'REVOKED') return reply.code(409).send({ error: 'Esta credencial está anulada; no se puede entregar.' });
    ctx.credentials.markDelivered(c.id);
    g.audit(req.user!.username, 'CREDENTIAL_DELIVERED', { credentialId: c.id });
    return { credential: publicCredential(ctx.credentials.byId(c.id)!) };
  });

  /** PDF de una sola credencial (100 × 150 mm) generado con `apps/print`. */
  app.get<{ Params: { id: string } }>('/credentials/:id/pdf', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR', 'PRINTER']) }, async (req, reply) => {
    const c = ctx.credentials.byId(req.params.id);
    if (!c) return reply.code(404).send({ error: 'Credencial no encontrada.' });
    const { buildCredentialsPdf } = await import('@tatami/print/dist/pdf.js');
    const pdf = await buildCredentialsPdf([c], ctx.config);
    g.audit(req.user!.username, 'CREDENTIAL_PDF', { credentialId: c.id });
    return reply.type('application/pdf').header('content-disposition', `inline; filename="${c.id}.pdf"`).send(Buffer.from(pdf));
  });

  /**
   * Emisión manual en sitio: crea la persona y su credencial (p. ej. prensa o
   * staff que llega sin acreditar). Valida rol, cupo, edad/categoría (COMP),
   * acudiente para menores y límites de acompañantes.
   */
  app.post<{ Body: IssueBody }>('/credentials/issue', { preHandler: g.requireUser(['ADMIN', 'COORDINATOR']) }, async (req, reply) => {
    const b = req.body ?? ({} as IssueBody);
    const errors: Array<{ path: string; message: string }> = [];
    const firstName = b.firstName?.trim() ?? '', lastName = b.lastName?.trim() ?? '';
    if (!firstName) errors.push({ path: 'firstName', message: 'Escribe el nombre.' });
    if (!lastName) errors.push({ path: 'lastName', message: 'Escribe el apellido.' });
    const role = ctx.config.roles.find((r) => r.code === b.roleCode);
    if (!role) errors.push({ path: 'roleCode', message: 'Elige un rol de acceso.' });
    const companionOf = b.companionOf?.trim() || null;
    const participant = companionOf ? ctx.credentials.byId(companionOf) : undefined;
    if (companionOf && !participant) errors.push({ path: 'companionOf', message: 'No encuentro esa credencial de participante.' });
    const birthDate = b.birthDate?.trim() || undefined;
    if (birthDate && !isIsoDate(birthDate)) errors.push({ path: 'birthDate', message: 'La fecha de nacimiento debe ser AAAA-MM-DD.' });
    let categoryCode = b.categoryCode?.trim() || undefined;
    if (role && !errors.length) {
      if (role.code === 'COMP') {
        if (!birthDate) errors.push({ path: 'birthDate', message: 'Un competidor necesita fecha de nacimiento para su categoría.' });
        else {
          const age = ageOn(birthDate, ctx.config.startDate);
          const auto = categoryForAge(age, ctx.config.ageCategories);
          if (!categoryCode) categoryCode = auto?.code;
          else if (auto && auto.code !== categoryCode) {
            const chosen = ctx.config.ageCategories.find((c) => c.code === categoryCode);
            errors.push({ path: 'categoryCode', message: `Con ${age} años le corresponde ${auto.name}, no ${chosen?.name ?? categoryCode}.` });
          }
          if (!auto && !categoryCode) errors.push({ path: 'birthDate', message: `No hay categoría para ${age} años.` });
        }
      }
      if (birthDate && ageOn(birthDate, ctx.config.startDate) < 18 && !companionOf && !(b.guardian?.name?.trim() && b.guardian?.document?.trim())) {
        errors.push({ path: 'guardian', message: 'Es menor de edad: indica nombre y documento del acudiente.' });
      }
      const issued = ctx.credentials.countByRole();
      if (role.capacity !== null && (issued[role.code] ?? 0) >= role.capacity && role.code !== COMPANION_ROLE) {
        errors.push({ path: 'roleCode', message: `Se llenó el cupo de ${role.name} (${role.capacity}).` });
      }
      if (companionOf && participant) {
        const v = validateCompanions({ config: ctx.config, adding: 1, participantCompanionsCount: ctx.credentials.companionsOf(participant.id).length, usedCompanionsTotal: ctx.credentials.countCompanions(), usedTotalEvent: ctx.credentials.count() });
        if (!v.ok) errors.push({ path: 'companionOf', message: v.message ?? 'No se pueden agregar más acompañantes.' });
      } else if (ctx.config.totalCapacity !== null && ctx.credentials.count() >= ctx.config.totalCapacity) {
        errors.push({ path: 'roleCode', message: `El evento llegó a su aforo total (${ctx.config.totalCapacity}).` });
      }
    }
    if (errors.length) return reply.code(400).send({ error: errors[0].message, errors });

    const person: Person = {
      id: `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, firstName, lastName,
      birthDate: birthDate ?? '1900-01-01', documentNumber: b.documentNumber?.trim() || undefined, club: b.club?.trim() || undefined,
      guardian: b.guardian?.name?.trim() ? { name: b.guardian.name.trim(), document: b.guardian.document?.trim() ?? '', consentAt: new Date().toISOString() } : undefined,
      photoUrl: b.photoUrl?.trim() || undefined, source: 'manual' as Person['source'], companionOf, relationship: b.relationship?.trim() || undefined
    };
    const dup = b.documentNumber?.trim() ? ctx.persons.byDocument(b.documentNumber.trim()) : [];
    if (dup.length) {
      const existing = ctx.credentials.byPersonId(dup[0].id);
      return reply.code(409).send({ error: `Ya hay una persona con ese documento: ${dup[0].firstName} ${dup[0].lastName}${existing ? ` (${existing.id})` : ''}. Búscala en Credenciales.`, credentialId: existing?.id ?? null });
    }
    const saved = ctx.persons.upsert(person);
    const cred = ctx.credentials.issue({ person: saved, roleCode: companionOf ? COMPANION_ROLE : role!.code, categoryCode, companionOf });
    g.audit(req.user!.username, 'CREDENTIAL_ISSUED_MANUAL', { credentialId: cred.id, roleCode: cred.roleCode, personId: saved.id, note: b.note?.trim() || undefined });
    return reply.code(201).send({ credential: cred, message: `Credencial ${cred.id} emitida para ${cred.displayName}. Ya puedes imprimirla.` });
  });
};
