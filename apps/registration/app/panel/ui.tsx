import type { ReactNode } from 'react';
import { STATUS_SHORT, STATUS_TONE, CREDENTIAL_LABEL } from '@/lib/labels';
import type { CredentialState, Registration, RegistrationStatus } from '@/lib/repo/types';

export type Search = Record<string, string | string[] | undefined>;

export function q(sp: Search, k: string): string {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/** Mensaje de resultado de una acción (viene en ?ok= / ?error=). */
export function Flash({ sp }: { sp: Search }) {
  const ok = q(sp, 'ok'); const error = q(sp, 'error');
  if (!ok && !error) return null;
  return <div className={`notice ${error ? 'bad' : 'ok'}`} role="status" style={{ marginTop: 0, marginBottom: 16 }}>{error || ok}</div>;
}

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  return <span className={`badge ${STATUS_TONE[status]}`}>{STATUS_SHORT[status]}</span>;
}

export function CredentialBadge({ r }: { r: Pick<Registration, 'credentialStatus' | 'revokedAt' | 'exportedAt' | 'status'> }) {
  if (r.revokedAt) return <span className="badge bad">Anulada</span>;
  if (r.credentialStatus) {
    const tone: Record<CredentialState, string> = { ISSUED: 'info', PRINTED: 'info', DELIVERED: 'ok', REVOKED: 'bad' };
    return <span className={`badge ${tone[r.credentialStatus]}`}>{CREDENTIAL_LABEL[r.credentialStatus]}</span>;
  }
  if (r.exportedAt) return <span className="badge info">Enviada al host</span>;
  if (r.status === 'APPROVED') return <span className="badge muted">Pendiente de enviar</span>;
  return <span className="badge muted">Sin credencial</span>;
}

export function Avatar({ r, size }: { r: Pick<Registration, 'photoUrl' | 'firstName' | 'lastName'>; size?: 'lg' }) {
  const initials = `${r.firstName[0] ?? ''}${r.lastName[0] ?? ''}`.toUpperCase();
  // eslint-disable-next-line @next/next/no-img-element
  if (r.photoUrl) return <img className={`avatar ${size ?? ''}`} src={r.photoUrl} alt={`Foto de ${r.firstName}`} />;
  return <div className={`avatar ${size ?? ''}`} aria-hidden>{initials}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="card"><div className="empty"><strong>{title}</strong>{children}</div></div>;
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="panel-head">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function fmt(iso?: string): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' }); } catch { return iso; }
}

export function fullName(r: Pick<Registration, 'firstName' | 'lastName'>): string {
  return `${r.firstName} ${r.lastName}`.trim();
}
