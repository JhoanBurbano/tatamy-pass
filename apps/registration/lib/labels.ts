import type { CredentialState, Registration, RegistrationStatus } from './repo/types';

/** Etiquetas humanas (docs/70-UX-WRITING.md §5.5). */
export const STATUS_LABEL: Record<RegistrationStatus, string> = {
  PENDING: 'Validada · pendiente de aprobación',
  WAITLIST: 'En lista de espera',
  OFFERED: 'Cupo ofrecido · esperando confirmación',
  EXPIRED: 'Oferta vencida',
  APPROVED: 'Aprobada · credencial en preparación',
  REJECTED: 'No aprobada'
};

export const STATUS_SHORT: Record<RegistrationStatus, string> = {
  PENDING: 'Pendiente', WAITLIST: 'Lista de espera', OFFERED: 'Ofrecido', EXPIRED: 'Vencida', APPROVED: 'Aprobada', REJECTED: 'Rechazada'
};

export const STATUS_TONE: Record<RegistrationStatus, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = {
  PENDING: 'info', WAITLIST: 'warn', OFFERED: 'warn', EXPIRED: 'muted', APPROVED: 'ok', REJECTED: 'bad'
};

export const CREDENTIAL_LABEL: Record<CredentialState, string> = {
  ISSUED: 'Emitida', PRINTED: 'Impresa', DELIVERED: 'Entregada', REVOKED: 'Anulada'
};

/** Estado de credencial que ve el público, combinando aprobación, export y reporte del host. */
export function publicStatus(r: Registration): { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info'; hint: string } {
  if (r.revokedAt) return { label: 'Credencial anulada', tone: 'bad', hint: `Motivo: ${r.revokeReason ?? 'sin detalle'}. Ve a la mesa de acreditación con tu documento.` };
  if (r.status === 'APPROVED') {
    if (r.credentialStatus === 'DELIVERED') return { label: 'Credencial entregada', tone: 'ok', hint: 'Ya tienes tu credencial. Llévala siempre contigo en el evento.' };
    if (r.credentialStatus === 'PRINTED' || r.credentialStatus === 'ISSUED') return { label: 'Credencial lista · recoger en acreditación', tone: 'ok', hint: 'Recógela en la mesa de acreditación con tu documento.' };
    return { label: STATUS_LABEL.APPROVED, tone: 'ok', hint: 'La credencial se imprime y se entrega en acreditación el primer día del evento.' };
  }
  if (r.status === 'REJECTED') return { label: `No aprobada`, tone: 'bad', hint: r.rejectionReason ? `Motivo: ${r.rejectionReason}.` : 'Escribe al coordinador si crees que es un error.' };
  if (r.status === 'OFFERED') return { label: STATUS_LABEL.OFFERED, tone: 'warn', hint: 'Revisa tu correo: tienes un enlace para confirmar el cupo antes de 48 horas.' };
  if (r.status === 'EXPIRED') return { label: STATUS_LABEL.EXPIRED, tone: 'muted', hint: 'No confirmaste a tiempo y el cupo pasó a la siguiente persona. Puedes inscribirte de nuevo en lista de espera.' };
  if (r.status === 'WAITLIST') return { label: STATUS_LABEL.WAITLIST, tone: 'warn', hint: 'Si se libera un lugar te escribimos al correo que dejaste.' };
  return { label: STATUS_LABEL.PENDING, tone: 'info', hint: 'El coordinador la revisará y te avisaremos por correo.' };
}
