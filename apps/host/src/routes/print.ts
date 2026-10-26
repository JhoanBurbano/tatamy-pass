/**
 * Impresión: lotes (crear por rol/club/estado, PDF con apps/print, marcar impreso/entregado)
 * y plantilla de la credencial (ADR-0009): leer, guardar, assets, vista previa y restablecer.
 */
import { defaultBadgeTemplate, filterPersonForBadge, formatCredentialId, generateKeyPair, resolveZones, signCredentialToken, validateBadgeTemplate, MAX_ASSET_BYTES, type BadgeAsset, type BadgeTemplate, type Credential, type Person } from '@tatami/core';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CredentialRow } from '../repos.js';
import { PRINTERS, type RouteModule } from './shared.js';

const run = promisify(execFile);

/** Rasteriza la primera página de un PDF con `pdftoppm` (poppler) si está instalado; `null` si no. */
async function pdfToPng(pdf: Uint8Array): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'tp-preview-'));
  try {
    await writeFile(join(dir, 'p.pdf'), pdf);
    await run('pdftoppm', ['-png', '-r', '110', '-f', '1', '-l', '1', '-singlefile', join(dir, 'p.pdf'), join(dir, 'p')], { timeout: 15_000 });
    return await readFile(join(dir, 'p.png'));
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const TEMPLATE_EDITORS = ['ADMIN', 'COORDINATOR'] as const;

export const registerPrintRoutes: RouteModule = (app, ctx, g) => {
  type Layout = 'two-pages' | 'duplex';
  const layoutOf = (v: unknown): Layout => (v === 'duplex' ? 'duplex' : 'two-pages');

  /** Credenciales + datos de la persona filtrados por la privacidad de la plantilla. */
  const printable = (creds: CredentialRow[], template: BadgeTemplate) => creds.map((c) => ({ ...c, person: filterPersonForBadge(template, ctx.persons.byId(c.personId)) }));

  const pdfFor = async (creds: CredentialRow[], layout: Layout = 'two-pages') => {
    const { buildCredentialsPdf } = await import('@tatami/print/dist/pdf.js');
    const template = ctx.badgeTemplate.get();
    return buildCredentialsPdf(printable(creds, template), ctx.config, { template, layout });
  };

  /** Lotes de impresión creados. */
  app.get('/print/batches', { preHandler: g.requireUser([...PRINTERS, 'AUDITOR']) }, async () => ctx.batches.all());

  /** Crea un lote por rol/club/estado o por lista de ids (máximo 2000, excluye anuladas). */
  app.post<{ Body: { roleCode?: string; club?: string; status?: CredentialRow['status']; ids?: string[]; limit?: number } }>('/print/batches', { preHandler: g.requireUser(PRINTERS) }, async (req, reply) => {
    const b = req.body ?? {};
    let creds: CredentialRow[];
    if (Array.isArray(b.ids) && b.ids.length) creds = ctx.credentials.byIds(b.ids);
    else creds = ctx.credentials.search({ roleCode: b.roleCode || undefined, club: b.club || undefined, status: b.status || 'ISSUED', limit: Math.min(b.limit ?? 500, 2000) }).items;
    creds = creds.filter((c) => c.status !== 'REVOKED');
    if (!creds.length) return reply.code(400).send({ error: 'No hay credenciales que coincidan con ese filtro.' });
    const batch = ctx.batches.create(req.user!.username, { roleCode: b.roleCode ?? null, club: b.club ?? null, status: b.status ?? 'ISSUED', ids: b.ids?.length ?? 0 }, creds.map((c) => c.id));
    g.audit(req.user!.username, 'PRINT_BATCH_CREATED', { batchId: batch.id, count: batch.count, filter: batch.filter });
    return batch;
  });

  /** Vista previa: las credenciales del lote (sin token). */
  app.get<{ Params: { id: string } }>('/print/batches/:id', { preHandler: g.requireUser([...PRINTERS, 'AUDITOR']) }, async (req, reply) => {
    const batch = ctx.batches.byId(req.params.id);
    if (!batch) return reply.code(404).send({ error: 'Lote no encontrado.' });
    const items = ctx.credentials.byIds(batch.credentialIds).map(({ token: _t, ...c }) => c);
    return { ...batch, items };
  });

  /** PDF del lote completo (`apps/print`, anverso y reverso según la plantilla); `?layout=duplex` pone ambos lados en una hoja. Registra el tiempo de generación en la auditoría. */
  app.get<{ Params: { id: string }; Querystring: { layout?: string } }>('/print/batches/:id/pdf', { preHandler: g.requireUser(PRINTERS) }, async (req, reply) => {
    const batch = ctx.batches.byId(req.params.id);
    if (!batch) return reply.code(404).send({ error: 'Lote no encontrado.' });
    const t0 = performance.now();
    const pdf = await pdfFor(ctx.credentials.byIds(batch.credentialIds), layoutOf(req.query?.layout));
    g.audit(req.user!.username, 'PRINT_BATCH_PDF', { batchId: batch.id, count: batch.count, ms: Math.round(performance.now() - t0) });
    return reply.type('application/pdf').header('content-disposition', `attachment; filename="${batch.id}.pdf"`).send(Buffer.from(pdf));
  });

  /** Marca el lote y sus credenciales como impresas. */
  app.post<{ Params: { id: string } }>('/print/batches/:id/printed', { preHandler: g.requireUser(PRINTERS) }, async (req, reply) => {
    const batch = ctx.batches.byId(req.params.id);
    if (!batch) return reply.code(404).send({ error: 'Lote no encontrado.' });
    const updated = ctx.credentials.markPrinted(batch.credentialIds);
    const b = ctx.batches.markPrinted(batch.id, req.user!.username)!;
    g.audit(req.user!.username, 'PRINT_BATCH_PRINTED', { batchId: batch.id, credentialsUpdated: updated });
    return { ...b, credentialsUpdated: updated };
  });

  /** Marca entregadas todas las credenciales del lote (las que no estén anuladas). */
  app.post<{ Params: { id: string } }>('/print/batches/:id/delivered', { preHandler: g.requireUser(PRINTERS) }, async (req, reply) => {
    const batch = ctx.batches.byId(req.params.id);
    if (!batch) return reply.code(404).send({ error: 'Lote no encontrado.' });
    let updated = 0;
    ctx.db.transaction(() => { for (const id of batch.credentialIds) { const c = ctx.credentials.byId(id); if (c && c.status !== 'REVOKED' && c.status !== 'DELIVERED') { ctx.credentials.markDelivered(id); updated++; } } })();
    const b = ctx.batches.markDelivered(batch.id, req.user!.username)!;
    g.audit(req.user!.username, 'PRINT_BATCH_DELIVERED', { batchId: batch.id, credentialsUpdated: updated });
    return { ...b, credentialsUpdated: updated };
  });

  // ---------- plantilla de la credencial (ADR-0009) ----------

  /** Plantilla de credencial vigente (`data/badge-template.json`) con sus assets en base64. */
  app.get('/print/template', { preHandler: g.requireUser([...PRINTERS, 'AUDITOR']) }, async () => ({ template: ctx.badgeTemplate.get(), bytes: ctx.badgeTemplate.bytes(), isDefault: JSON.stringify(ctx.badgeTemplate.get()) === JSON.stringify(defaultBadgeTemplate()) }));

  /** Guarda una plantilla completa: valida con `validateBadgeTemplate` (400 con `errors` por campo), persiste y audita. */
  app.put<{ Body: { template: BadgeTemplate } }>('/print/template', { preHandler: g.requireUser([...TEMPLATE_EDITORS]) }, async (req, reply) => {
    const incoming = req.body?.template;
    if (!incoming) return reply.code(400).send({ error: 'Se esperaba { template }.' });
    const errors = ctx.badgeTemplate.save(incoming);
    if (errors.length) return reply.code(400).send({ error: 'El diseño tiene errores. Revisa los campos marcados.', errors });
    g.audit(req.user!.username, 'BADGE_TEMPLATE_UPDATED', { id: incoming.id, name: incoming.name, assets: Object.keys(incoming.assets).length, privacy: incoming.privacy });
    return { template: ctx.badgeTemplate.get(), message: 'Diseño guardado. Los próximos PDF salen con esta plantilla.' };
  });

  /** Sube un logo o imagen (PNG, JPG o SVG, ≤ 1 MB) a la plantilla: `{ id, name, mime, dataBase64 }`. Si el id existe, lo reemplaza. */
  app.post<{ Body: { id?: string; name?: string; mime?: string; dataBase64?: string } }>('/print/template/assets', { preHandler: g.requireUser([...TEMPLATE_EDITORS]) }, async (req, reply) => {
    const b = req.body ?? {};
    const id = String(b.id ?? '').trim().toLowerCase();
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return reply.code(400).send({ error: 'Pon un id corto para el archivo: minúsculas, números y guiones (p. ej. logo-liga).' });
    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(String(b.mime))) return reply.code(400).send({ error: 'Solo se aceptan imágenes PNG, JPG o SVG.' });
    const data = String(b.dataBase64 ?? '').replace(/^data:[^,]*,/, '');
    if (!data) return reply.code(400).send({ error: 'El archivo llegó vacío. Vuelve a elegirlo.' });
    if (Buffer.byteLength(data, 'base64') > MAX_ASSET_BYTES) return reply.code(400).send({ error: 'El archivo pesa más de 1 MB. Reduce la imagen antes de subirla.' });
    const asset: BadgeAsset = { name: String(b.name ?? id).slice(0, 80), mime: b.mime as BadgeAsset['mime'], dataBase64: data };
    const next: BadgeTemplate = { ...ctx.badgeTemplate.get(), assets: { ...ctx.badgeTemplate.get().assets, [id]: asset } };
    const errors = ctx.badgeTemplate.save(next);
    if (errors.length) return reply.code(400).send({ error: errors[0].message, errors });
    g.audit(req.user!.username, 'BADGE_TEMPLATE_ASSET_ADDED', { id, name: asset.name, mime: asset.mime, bytes: Buffer.byteLength(data, 'base64') });
    return { id, template: ctx.badgeTemplate.get(), message: `Archivo "${asset.name}" subido. Ya puedes usarlo en el pie o en patrocinadores.` };
  });

  /** Quita un asset y todas sus referencias (pie, patrocinadores, silueta, fondo). */
  app.delete<{ Params: { id: string } }>('/print/template/assets/:id', { preHandler: g.requireUser([...TEMPLATE_EDITORS]) }, async (req, reply) => {
    const id = req.params.id;
    const t = structuredClone(ctx.badgeTemplate.get());
    if (!t.assets[id]) return reply.code(404).send({ error: 'Ese archivo no está en la plantilla.' });
    delete t.assets[id];
    t.front.footer.logos = t.front.footer.logos.filter((x) => x !== id);
    t.back.footer.logos = t.back.footer.logos.filter((x) => x !== id);
    t.back.sponsors.logos = t.back.sponsors.logos.filter((x) => x !== id);
    if (t.header.skylineAsset === id) t.header.skylineAsset = null;
    if (t.background.imageAsset === id) t.background.imageAsset = null;
    const errors = ctx.badgeTemplate.save(t);
    if (errors.length) return reply.code(400).send({ error: errors[0].message, errors });
    g.audit(req.user!.username, 'BADGE_TEMPLATE_ASSET_REMOVED', { id });
    return { template: ctx.badgeTemplate.get(), message: 'Archivo quitado de la plantilla.' };
  });

  /**
   * Vista previa: PDF de una credencial de muestra con la plantilla enviada (`template`, sin guardar) o la vigente,
   * datos de ejemplo (`sample`) y `layout`. Se firma con una clave efímera: el QR de la muestra no vale en ninguna puerta.
   * `format: 'png'` devuelve la primera página como imagen si el equipo tiene `pdftoppm` (poppler); si no, 406 y el panel usa el PDF.
   */
  app.post<{ Body: { template?: BadgeTemplate; layout?: string; format?: 'pdf' | 'png'; sample?: Partial<Person> & { displayName?: string; roleCode?: string; categoryCode?: string } } }>('/print/template/preview', { preHandler: g.requireUser(PRINTERS) }, async (req, reply) => {
    const b = req.body ?? {};
    const template = b.template ?? ctx.badgeTemplate.get();
    const errors = validateBadgeTemplate(template);
    if (errors.length) return reply.code(400).send({ error: 'El diseño tiene errores. Revisa los campos marcados.', errors });
    const s = b.sample ?? {};
    const roleCode = s.roleCode && ctx.config.roles.some((r) => r.code === s.roleCode) ? s.roleCode : 'COMP';
    const role = ctx.config.roles.find((r) => r.code === roleCode)!;
    const key = generateKeyPair('preview');
    const now = new Date().toISOString();
    const cred: Credential = {
      id: formatCredentialId(ctx.config.idPrefix, 428), seq: 428, eventId: ctx.config.eventId, personId: 'preview', displayName: s.displayName ?? 'Jhoan Pérez', club: s.club ?? 'Academia Gran Maestro',
      roleCode, zones: resolveZones(role.zones, ctx.config), validFrom: ctx.config.startDate, validTo: ctx.config.endDate, version: 1, status: 'ISSUED', kid: key.kid,
      categoryCode: s.categoryCode ?? (roleCode === 'COMP' ? ctx.config.ageCategories[0]?.code : undefined), issuedAt: now, updatedAt: now
    };
    const person: Person = {
      id: 'preview', firstName: 'Jhoan', lastName: 'Pérez', birthDate: '2000-01-01', source: 'seed', documentNumber: s.documentNumber ?? '1.061.234.567', club: cred.club,
      delegation: s.delegation ?? 'Bogotá D.C. - Cundinamarca', emergencyContact: s.emergencyContact ?? { name: 'María Fernanda Pérez', phone: '+57 310 234 5678' }, eps: s.eps ?? { name: 'EPS Sura', regime: 'Régimen Contributivo' }
    };
    const { buildCredentialsPdf } = await import('@tatami/print/dist/pdf.js');
    const pdf = await buildCredentialsPdf([{ ...cred, token: signCredentialToken(cred, key), person: filterPersonForBadge(template, person) }], ctx.config, { template, layout: layoutOf(b.layout ?? 'duplex') });
    if (b.format === 'png') {
      const png = await pdfToPng(pdf);
      if (!png) return reply.code(406).send({ error: 'Este equipo no puede convertir el PDF a imagen (falta poppler). Se muestra el PDF.' });
      return reply.type('image/png').send(png);
    }
    return reply.type('application/pdf').header('content-disposition', 'inline; filename="vista-previa-credencial.pdf"').send(Buffer.from(pdf));
  });

  /** Vuelve a la plantilla por defecto del piloto ("Nacional 2026"). Se pierden los logos subidos. */
  app.post('/print/template/reset', { preHandler: g.requireUser([...TEMPLATE_EDITORS]) }, async (req) => {
    const t = ctx.badgeTemplate.reset();
    g.audit(req.user!.username, 'BADGE_TEMPLATE_RESET', { id: t.id });
    return { template: t, message: 'Diseño restablecido al del piloto.' };
  });
};
