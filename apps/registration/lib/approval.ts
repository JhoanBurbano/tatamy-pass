/**
 * Aprobar / rechazar una inscripción: cambia el estado (los acompañantes heredan), registra en
 * auditoría y envía el correo con, si aplica, los enlaces de credencial digital.
 * Lo usan las acciones del panel y `POST /api/approve` (clave del host).
 */
import type { EventConfig } from '@tatami/core';
import type { MailSender } from './mail';
import { credentialUrl, decisionMail, type DigitalLinks } from './mail-templates';
import type { Repos } from './repo';
import type { Registration } from './repo/types';

export interface ApprovalDeps { repos: Repos; config: EventConfig; sendMail: MailSender; actor: string }

export type ApprovalResult = { ok: true; registration: Registration; mailed: boolean } | { ok: false; message: string };

/** Enlaces de credencial digital para el correo (participante si su rol lo permite + acompañantes). */
export async function digitalLinksFor(repos: Repos, config: EventConfig, r: Registration): Promise<DigitalLinks> {
  const role = config.roles.find((x) => x.code === r.roleCode);
  const links: DigitalLinks = {};
  if (role?.allowsDigital) links.participantUrl = credentialUrl(await repos.registrations.ensureCredentialToken(r.id));
  const companions = (await repos.registrations.companionsOf(r.id)).filter((c) => c.status !== 'REJECTED');
  const out: { name: string; url: string }[] = [];
  for (const c of companions) {
    const cRole = config.roles.find((x) => x.code === c.roleCode);
    if (cRole?.allowsDigital) out.push({ name: `${c.firstName} ${c.lastName}`.trim(), url: credentialUrl(await repos.registrations.ensureCredentialToken(c.id)) });
  }
  if (out.length) links.companions = out;
  return links;
}

export async function approveRegistration(deps: ApprovalDeps, id: string): Promise<ApprovalResult> {
  const { repos, config } = deps;
  const r = await repos.registrations.byId(id);
  if (!r || r.companionOf) return { ok: false, message: 'No encontré esa inscripción.' };
  await repos.registrations.setStatus(id, 'APPROVED');
  await repos.settings.audit(deps.actor, 'APPROVE', id);
  const saved = (await repos.registrations.byId(id))!;
  let mailed = false;
  if (saved.email) {
    const links = await digitalLinksFor(repos, config, saved);
    mailed = (await deps.sendMail(decisionMail(saved, true, undefined, links))).ok;
  }
  return { ok: true, registration: saved, mailed };
}

export async function rejectRegistration(deps: ApprovalDeps, id: string, reason: string): Promise<ApprovalResult> {
  const { repos } = deps;
  const r = await repos.registrations.byId(id);
  if (!r || r.companionOf) return { ok: false, message: 'No encontré esa inscripción.' };
  if (!reason.trim()) return { ok: false, message: 'Escribe el motivo del rechazo: la persona lo verá en su correo.' };
  await repos.registrations.setStatus(id, 'REJECTED', { rejectionReason: reason.trim() });
  await repos.settings.audit(deps.actor, 'REJECT', id, { reason: reason.trim() });
  const saved = (await repos.registrations.byId(id))!;
  const mailed = saved.email ? (await deps.sendMail(decisionMail(saved, false, reason.trim()))).ok : false;
  return { ok: true, registration: saved, mailed };
}
