/** Permisos de edición en el panel. */
import { registrationWindow } from './config';
import type { SessionUser } from './auth/session';
import type { Repos } from './repo';
import type { Registration } from './repo/types';

/** ¿Puede este usuario editar esta inscripción? Coordinador/admin siempre; inscriptor solo su delegación y mientras el formulario esté abierto. */
export async function canEdit(user: SessionUser, r: Registration, repos: Repos): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (user.role === 'admin' || user.role === 'coord') return { ok: true };
  if (!user.delegationId) return { ok: false, reason: 'Tu usuario no tiene delegación asignada.' };
  const delegation = await repos.users.delegationById(user.delegationId);
  const own = r.delegationId === user.delegationId || (delegation && r.club?.toLowerCase() === delegation.name.toLowerCase());
  if (!own) return { ok: false, reason: 'Esta inscripción no es de tu delegación.' };
  const { form } = await repos.settings.eventSettings();
  const w = registrationWindow(form);
  if (!w.open) return { ok: false, reason: `Las inscripciones ya cerraron: no se pueden editar. ${w.reason ?? ''} Escribe al coordinador si necesitas un cambio.` };
  if (r.status === 'REJECTED') return { ok: false, reason: 'Esta inscripción fue rechazada; escribe al coordinador.' };
  return { ok: true };
}

