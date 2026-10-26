/**
 * Lista de espera (§7): liberar cupo → ofrecer al primero por correo con enlace de 48 h;
 * si vence, pasa al siguiente. `OFFERED` ocupa cupo mientras dura la oferta.
 */
import type { EventConfig } from '@tatami/core';
import { secureToken } from './ids';
import { offerMail } from './mail-templates';
import type { MailSender } from './mail';
import type { Repos } from './repo';
import type { Registration } from './repo/types';

export const OFFER_HOURS = 48;

export interface WaitlistDeps {
  repos: Repos;
  config: EventConfig;
  sendMail: MailSender;
  now?: () => Date;
}

export type ReleaseResult =
  | { ok: true; offered: Registration; expiresAt: string; mailed: boolean }
  | { ok: false; reason: 'EMPTY' | 'NO_EMAIL'; message: string; skipped?: Registration };

/** Libera un cupo para rol (y categoría opcional): ofrece al primero de la lista. */
export async function releaseSlot(deps: WaitlistDeps, f: { roleCode: string; categoryCode?: string }): Promise<ReleaseResult> {
  const { repos, config } = deps;
  const next = await repos.registrations.nextInWaitlist(f);
  if (!next) return { ok: false, reason: 'EMPTY', message: 'Nadie en lista de espera.' };
  if (!next.email) {
    // Sin correo no hay forma de avisar: pasa directo a pendiente y el coordinador decide.
    await repos.registrations.setStatus(next.id, 'PENDING');
    return { ok: false, reason: 'NO_EMAIL', message: `${next.firstName} ${next.lastName} no dejó correo: pasó directo a pendiente de aprobación.`, skipped: next };
  }
  const now = (deps.now ?? (() => new Date()))();
  const token = secureToken();
  const expiresAt = new Date(now.getTime() + OFFER_HOURS * 3600_000).toISOString();
  await repos.registrations.markOffered(next.id, token, expiresAt);
  const offered = (await repos.registrations.byId(next.id))!;
  const roleName = config.roles.find((r) => r.code === offered.roleCode)?.name ?? offered.roleCode;
  const mail = await deps.sendMail(offerMail(offered, roleName, expiresAt));
  return { ok: true, offered, expiresAt, mailed: mail.ok };
}

/** Confirma una oferta por token. */
export async function confirmOffer(deps: Pick<WaitlistDeps, 'repos' | 'now'>, token: string): Promise<{ ok: true; registration: Registration } | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY'; message: string }> {
  const { repos } = deps;
  const reg = await repos.registrations.byOfferToken(token);
  if (!reg) return { ok: false, reason: 'NOT_FOUND', message: 'Este enlace no es válido o ya se usó.' };
  const now = (deps.now ?? (() => new Date()))();
  if (reg.status !== 'OFFERED') return { ok: false, reason: 'ALREADY', message: 'Esta inscripción ya no está en oferta.' };
  if (reg.offerExpiresAt && new Date(reg.offerExpiresAt).getTime() < now.getTime()) {
    return { ok: false, reason: 'EXPIRED', message: 'Este enlace venció: pasaron más de 48 horas. El cupo pasó a la siguiente persona. Puedes inscribirte de nuevo en lista de espera.' };
  }
  await repos.registrations.setStatus(reg.id, 'PENDING');
  await repos.registrations.clearOffer(reg.id);
  return { ok: true, registration: (await repos.registrations.byId(reg.id))! };
}

/** Vence ofertas caducadas y pasa el cupo al siguiente de cada rol/categoría. */
export async function expireOffers(deps: WaitlistDeps): Promise<{ expired: Registration[]; offered: Registration[] }> {
  const { repos } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const expired = await repos.registrations.expiredOffers(now.toISOString());
  const offered: Registration[] = [];
  for (const r of expired) {
    await repos.registrations.setStatus(r.id, 'EXPIRED');
    await repos.registrations.clearOffer(r.id);
    const res = await releaseSlot(deps, { roleCode: r.roleCode, categoryCode: r.categoryCode });
    if (res.ok) offered.push(res.offered);
  }
  return { expired, offered };
}
