/**
 * Resumen que sube el host al cierre (`POST /api/host-report`, cabecera `x-tatami-key`):
 * {
 *   hostId?: string, at?: string,
 *   summary?: { scans, allowed, denied, alerts, byZone?, ... },      // libre, se guarda tal cual
 *   credentials: [{ externalId, credentialId?, version?, status: ISSUED|PRINTED|DELIVERED|REVOKED, updatedAt? }]
 * }
 * `externalId` es el id de la inscripción en la nube (el host lo guarda como external_id).
 */
import type { Repos } from './repo';
import type { CredentialState } from './repo/types';

const STATES: CredentialState[] = ['ISSUED', 'PRINTED', 'DELIVERED', 'REVOKED'];

export interface HostReportInput {
  hostId?: string;
  at?: string;
  summary?: Record<string, unknown>;
  credentials?: { externalId?: string; registrationId?: string; credentialId?: string; version?: number; status?: string; updatedAt?: string }[];
}

export async function applyHostReport(repos: Repos, body: HostReportInput): Promise<{ ok: true; reportId: string; applied: number; unknown: string[]; invalid: number }> {
  const creds = Array.isArray(body.credentials) ? body.credentials : [];
  let applied = 0; let invalid = 0;
  const unknown: string[] = [];
  for (const c of creds) {
    const id = c.externalId ?? c.registrationId;
    const status = String(c.status ?? '').toUpperCase() as CredentialState;
    if (!id || !STATES.includes(status)) { invalid++; continue; }
    const version = Number.isInteger(c.version) && (c.version as number) > 0 ? c.version : undefined;
    const ok = await repos.registrations.setCredential(id, { credentialId: c.credentialId, status, version, at: c.updatedAt ?? body.at ?? new Date().toISOString() });
    if (ok) applied++; else unknown.push(id);
  }
  const report = await repos.settings.addHostReport({ hostId: body.hostId, summary: { ...(body.summary ?? {}), at: body.at ?? null, applied, unknown: unknown.length, invalid }, credentialsCount: creds.length });
  return { ok: true, reportId: report.id, applied, unknown, invalid };
}
