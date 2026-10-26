/**
 * Export para el host (§8): inscripciones aprobadas creadas/actualizadas desde `since`.
 * Añade `photoUrl`, `code` y el bloque `credential` (revocación desde la nube) sin
 * romper el formato que el host ya consume (`registrations[].companions`).
 */
import type { Repos } from './repo';
import type { Registration } from './repo/types';

export interface ExportedRegistration {
  id: string;
  code?: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  documentNumber?: string;
  club?: string;
  email?: string;
  roleCode: string;
  categoryCode?: string;
  guardian?: Registration['guardian'];
  /** Delegación, contacto de emergencia y EPS: se imprimen en la credencial (reverso) según la plantilla del host. */
  delegation?: string;
  emergencyContact?: Registration['emergencyContact'];
  eps?: Registration['eps'];
  photoUrl?: string;
  relationship?: string;
  companionOf?: string | null;
  status: 'APPROVED';
  updatedAt: string;
  /** Revocación decidida en la nube: el host la aplica en su próximo pull. */
  revoked: boolean;
  revokedAt?: string;
  revokeReason?: string;
  companions: ExportedRegistration[];
}

export function toExported(r: Registration, companions: Registration[] = []): ExportedRegistration {
  return {
    id: r.id, code: r.code, firstName: r.firstName, lastName: r.lastName, birthDate: r.birthDate, documentNumber: r.documentNumber, club: r.club, email: r.email,
    roleCode: r.roleCode, categoryCode: r.categoryCode, guardian: r.guardian, delegation: r.delegation, emergencyContact: r.emergencyContact, eps: r.eps, photoUrl: r.photoUrl, relationship: r.relationship, companionOf: r.companionOf ?? null,
    status: 'APPROVED', updatedAt: r.updatedAt, revoked: Boolean(r.revokedAt), revokedAt: r.revokedAt, revokeReason: r.revokeReason,
    companions: companions.map((c) => toExported(c))
  };
}

export async function buildExport(repos: Repos, since: string | undefined, opts: { markExported?: boolean } = {}) {
  const rows = await repos.registrations.exportSince(since);
  const registrations = rows.map((r) => toExported(r, r.companions));
  const cursor = rows.reduce((max, r) => {
    const latest = [r.updatedAt, ...r.companions.map((c) => c.updatedAt)].sort().pop()!;
    return latest > max ? latest : max;
  }, since ?? '');
  if (opts.markExported && rows.length) await repos.registrations.markExported(rows.map((r) => r.id));
  return { serverTime: new Date().toISOString(), since: since ?? null, cursor: cursor || null, count: registrations.length, registrations };
}
