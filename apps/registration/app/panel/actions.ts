'use server';

/**
 * Acciones de servidor del panel. Next verifica el Origin de cada acción (CSRF) y la
 * sesión se lee de la cookie HttpOnly. Cada acción vuelve a comprobar el rol; la forma de
 * los datos se valida con zod (lib/schemas.ts) y las reglas de negocio en lib/.
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COMPANION_ROLE, isIsoDate, isMinor, splitFullName, validateCategory, validateCompanions } from '@tatami/core';
import { approveRegistration, rejectRegistration } from '@/lib/approval';
import { hashPassword, passwordPolicy, verifyPassword } from '@/lib/auth/password';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { currentUser, requireUserOrThrow } from '@/lib/auth/guard';
import { rotateCloudKey } from '@/lib/cloud-auth';
import { eventConfig } from '@/lib/config';
import { canEdit } from '@/lib/permissions';
import { getRepos } from '@/lib/db';
import { secureToken } from '@/lib/ids';
import { sendMail } from '@/lib/mail';
import { inviteMail } from '@/lib/mail-templates';
import { decodePhoto, storePhoto } from '@/lib/photos';
import { rateLimit } from '@/lib/rate-limit';
import type { EventSettings, Registration, UserRole } from '@/lib/repo/types';
import { editRegistrationSchema, formToObject, inviteSchema, loginSchema, zodErrors } from '@/lib/schemas';
import { releaseSlot } from '@/lib/waitlist';

export interface ActionState { ok?: string; error?: string; /** Para que el formulario conserve el correo tras un intento fallido. */ email?: string }

function str(fd: FormData, k: string): string { return String(fd.get(k) ?? '').trim(); }

/** Vuelve a la página con el mensaje en la URL (lo muestra <Flash/>). */
function back(path: string, state: ActionState): never {
  const p = new URLSearchParams();
  if (state.ok) p.set('ok', state.ok);
  if (state.error) p.set('error', state.error);
  redirect(`${path}${p.size ? `?${p}` : ''}`);
}

function firstError(errors: Record<string, string>): string {
  return Object.values(errors)[0] ?? 'Revisa los datos.';
}

// ─── Sesión ────────────────────────────────────────────────────────────────

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const typed = str(fd, 'email');
  const parsed = loginSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { error: firstError(zodErrors(parsed.error)), email: typed };
  const { email, password, next = '' } = parsed.data;
  const rl = rateLimit(`login:${email}`, Number(process.env.RATE_LIMIT_LOGIN ?? 5), 60_000);
  if (!rl.ok) return { error: `Demasiados intentos. Espera ${rl.retryAfterSeconds} s.`, email };
  const repos = await getRepos();
  const user = await repos.users.byEmail(email);
  if (!user || !(await verifyPassword(user.passwordHash, password))) return { error: 'Correo o contraseña incorrectos.', email };
  const token = await createSessionToken({ id: user.id, email: user.email, name: user.name, role: user.role, delegationId: user.delegationId });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  await repos.users.touchLogin(user.id);
  await repos.settings.audit(user.email, 'LOGIN');
  redirect(next.startsWith('/panel') && !next.startsWith('//') ? next : '/panel/inscripciones');
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/panel/login');
}

export async function activateInviteAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const token = str(fd, 'token'); const password = String(fd.get('password') ?? ''); const confirm = String(fd.get('confirm') ?? '');
  const repos = await getRepos();
  const user = await repos.users.byInviteToken(token);
  if (!user || !user.inviteExpiresAt || new Date(user.inviteExpiresAt).getTime() < Date.now()) return { error: 'Esta invitación no es válida o ya venció. Pide una nueva al coordinador.' };
  const policy = passwordPolicy(password);
  if (policy) return { error: policy };
  if (password !== confirm) return { error: 'Las contraseñas no coinciden.' };
  await repos.users.setPassword(user.id, await hashPassword(password));
  const session = await createSessionToken({ id: user.id, email: user.email, name: user.name, role: user.role, delegationId: user.delegationId });
  (await cookies()).set(SESSION_COOKIE, session, sessionCookieOptions());
  await repos.settings.audit(user.email, 'INVITE_ACCEPTED');
  redirect('/panel/inscripciones');
}

// ─── Inscripciones: aprobar / rechazar ─────────────────────────────────────

export async function approveAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const id = str(fd, 'id'); const returnTo = str(fd, 'returnTo') || '/panel/inscripciones';
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const res = await approveRegistration({ repos, config, sendMail, actor: user.email }, id);
  revalidatePath('/panel');
  if (!res.ok) back(returnTo, { error: res.message });
  back(returnTo, { ok: `Inscripción de ${res.registration.firstName} ${res.registration.lastName} aprobada${res.registration.email ? (res.mailed ? ' y correo enviado.' : ', pero el correo no salió.') : '.'}` });
}

export async function rejectAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const id = str(fd, 'id'); const reason = str(fd, 'reason'); const returnTo = str(fd, 'returnTo') || '/panel/inscripciones';
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const res = await rejectRegistration({ repos, config, sendMail, actor: user.email }, id, reason);
  revalidatePath('/panel');
  if (!res.ok) back(returnTo, { error: res.message });
  back(returnTo, { ok: `Inscripción de ${res.registration.firstName} ${res.registration.lastName} rechazada.` });
}

export async function approveAllValidatedAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const filters = { roleCode: str(fd, 'roleCode') || undefined, categoryCode: str(fd, 'categoryCode') || undefined, club: str(fd, 'club') || undefined };
  const pending = await repos.registrations.list({ status: 'PENDING', ...filters, limit: 5000 });
  for (const r of pending) await approveRegistration({ repos, config, sendMail, actor: user.email }, r.id);
  await repos.settings.audit(user.email, 'APPROVE_ALL_VALIDATED', undefined, { count: pending.length, filters });
  revalidatePath('/panel');
  back('/panel/inscripciones?status=APPROVED', { ok: pending.length ? `${pending.length} inscripciones aprobadas.` : 'No había inscripciones validadas pendientes.' });
}

// ─── Inscripciones: editar datos y acompañantes ────────────────────────────

export async function editRegistrationAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow();
  const id = str(fd, 'id'); const returnTo = `/panel/inscripciones/${id}`;
  const repos = await getRepos();
  const r = await repos.registrations.byId(id);
  if (!r) back('/panel/inscripciones', { error: 'No encontré esa inscripción.' });
  const allowed = await canEdit(user, r, repos);
  if (!allowed.ok) back(returnTo, { error: allowed.reason });
  const parsed = editRegistrationSchema.safeParse(formToObject(fd));
  if (!parsed.success) back(returnTo, { error: firstError(zodErrors(parsed.error)) });
  const d = parsed.data;
  const { config } = await eventConfig(repos);
  const patch: Parameters<typeof repos.registrations.updateDetails>[1] = {
    firstName: d.firstName, lastName: d.lastName, documentNumber: d.documentNumber || undefined, email: d.email || undefined, relationship: d.relationship || undefined
  };
  if (!r.companionOf) {
    if (!isIsoDate(d.birthDate)) back(returnTo, { error: 'Revisa la fecha de nacimiento. Escríbela como día / mes / año.' });
    patch.birthDate = d.birthDate;
    patch.club = d.club || undefined;
    patch.delegationId = user.role === 'club' ? user.delegationId : (d.club ? (await repos.users.delegationByName(d.club))?.id : undefined);
    if (user.role === 'club') { const del = await repos.users.delegationById(user.delegationId!); patch.club = del?.name ?? r.club; }
    if (r.roleCode === 'COMP') {
      if (!d.categoryCode) back(returnTo, { error: 'Elige la categoría.' });
      const used = await repos.registrations.countByCategory();
      if (d.categoryCode !== r.categoryCode) {
        const v = validateCategory({ birthDate: d.birthDate, eventStartDate: config.startDate, categoryCode: d.categoryCode, categories: config.ageCategories, usedByCategory: used });
        if (!v.ok && v.reason !== 'CAPACITY_FULL') back(returnTo, { error: v.message });
      } else {
        const v = validateCategory({ birthDate: d.birthDate, eventStartDate: config.startDate, categoryCode: d.categoryCode, categories: config.ageCategories, usedByCategory: {} });
        if (!v.ok) back(returnTo, { error: v.message });
      }
      patch.categoryCode = d.categoryCode;
    }
    if (isMinor(d.birthDate, config.startDate)) {
      if (!d.guardianName || !d.guardianDocument) back(returnTo, { error: `${d.firstName} es menor de edad: escribe nombre y documento del acudiente.` });
      patch.guardian = { name: d.guardianName, document: d.guardianDocument, consentAt: r.guardian?.consentAt ?? new Date().toISOString() };
    } else {
      patch.guardian = undefined;
    }
  }
  const res = await repos.registrations.updateDetails(id, patch);
  if (!res.ok) back(returnTo, { error: `Ya existe otra inscripción con ese nombre, fecha de nacimiento y club (${res.conflict.code ?? res.conflict.id}). Revisa Duplicados.` });
  await repos.settings.audit(user.email, 'EDIT_REGISTRATION', id, { fields: Object.keys(patch) });
  revalidatePath('/panel');
  back(returnTo, { ok: 'Datos guardados.' });
}

export async function setPhotoAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow();
  const id = str(fd, 'id'); const returnTo = `/panel/inscripciones/${id}`;
  const repos = await getRepos();
  const r = await repos.registrations.byId(id);
  if (!r) back('/panel/inscripciones', { error: 'No encontré esa inscripción.' });
  const allowed = await canEdit(user, r, repos);
  if (!allowed.ok) back(returnTo, { error: allowed.reason });
  const decoded = decodePhoto(String(fd.get('photo') ?? ''));
  if (decoded === 'TOO_BIG') back(returnTo, { error: 'La foto pesa demasiado (máximo 2 MB). Recórtala de nuevo.' });
  if (!decoded) back(returnTo, { error: 'No pude leer la foto. Prueba con otra en JPG o PNG.' });
  const url = await storePhoto(id, decoded);
  await repos.registrations.update(id, { photoUrl: url });
  await repos.settings.audit(user.email, 'SET_PHOTO', id);
  revalidatePath('/panel');
  back(returnTo, { ok: 'Foto guardada.' });
}

export async function addCompanionAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow();
  const id = str(fd, 'id'); const returnTo = `/panel/inscripciones/${id}`;
  const repos = await getRepos();
  const r = await repos.registrations.byId(id);
  if (!r || r.companionOf) back('/panel/inscripciones', { error: 'No encontré esa inscripción.' });
  const allowed = await canEdit(user, r, repos);
  if (!allowed.ok) back(returnTo, { error: allowed.reason });
  const name = str(fd, 'name');
  if (!name) back(returnTo, { error: 'Escribe el nombre del acompañante.' });
  const { config } = await eventConfig(repos);
  const existing = await repos.registrations.companionsOf(id);
  const v = validateCompanions({ participantCompanionsCount: existing.length, adding: 1, config, usedCompanionsTotal: await repos.registrations.countCompanions(), usedTotalEvent: await repos.registrations.countActive() });
  if (!v.ok) back(returnTo, { error: v.message });
  const { firstName, lastName } = splitFullName(name);
  const created = await repos.registrations.upsert({
    firstName, lastName, birthDate: '', documentNumber: str(fd, 'document') || undefined, club: r.club, delegationId: r.delegationId, roleCode: COMPANION_ROLE,
    status: r.status, source: 'online', companionOf: r.id, relationship: str(fd, 'relationship') || undefined
  });
  await repos.settings.audit(user.email, 'ADD_COMPANION', id, { companion: created.registration.id });
  revalidatePath('/panel');
  back(returnTo, { ok: `Acompañante ${name} agregado.${r.status === 'APPROVED' ? ' Como la inscripción ya está aprobada, el host lo recibe en la próxima actualización.' : ''}` });
}

export async function removeCompanionAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow();
  const companionId = str(fd, 'companionId');
  const repos = await getRepos();
  const c = await repos.registrations.byId(companionId);
  if (!c?.companionOf) back('/panel/inscripciones', { error: 'No encontré ese acompañante.' });
  const parent = await repos.registrations.byId(c.companionOf);
  const returnTo = `/panel/inscripciones/${c.companionOf}`;
  if (!parent) back('/panel/inscripciones', { error: 'No encontré esa inscripción.' });
  const allowed = await canEdit(user, parent, repos);
  if (!allowed.ok) back(returnTo, { error: allowed.reason });
  if (c.credentialStatus && c.credentialStatus !== 'REVOKED') back(returnTo, { error: 'Este acompañante ya tiene credencial emitida en el host: anúlala desde Credenciales en vez de borrarlo.' });
  await repos.registrations.delete(companionId);
  await repos.settings.audit(user.email, 'REMOVE_COMPANION', parent.id, { companion: companionId });
  revalidatePath('/panel');
  back(returnTo, { ok: `Acompañante ${c.firstName} ${c.lastName} quitado.` });
}

// ─── Lista de espera ───────────────────────────────────────────────────────

export async function releaseSlotAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const roleCode = str(fd, 'roleCode'); const categoryCode = str(fd, 'categoryCode') || undefined;
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const res = await releaseSlot({ repos, config, sendMail }, { roleCode, categoryCode });
  await repos.settings.audit(user.email, 'RELEASE_SLOT', res.ok ? res.offered.id : undefined, { roleCode, categoryCode, ok: res.ok });
  revalidatePath('/panel/lista-espera');
  if (res.ok) back('/panel/lista-espera', { ok: `Cupo ofrecido a ${res.offered.firstName} ${res.offered.lastName}${res.mailed ? ' (correo enviado)' : ' (no se pudo enviar el correo)'}. Tiene 48 h para confirmar.` });
  back('/panel/lista-espera', { error: res.message });
}

/** Pasa directo a pendiente de aprobación (sin esperar confirmación por correo): para cuando la persona confirmó por otro medio. */
export async function promoteWaitlistAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const id = str(fd, 'id');
  const repos = await getRepos();
  const r = await repos.registrations.byId(id);
  if (!r || (r.status !== 'WAITLIST' && r.status !== 'OFFERED')) back('/panel/lista-espera', { error: 'Esa inscripción ya no está en lista de espera.' });
  await repos.registrations.setStatus(id, 'PENDING');
  await repos.registrations.clearOffer(id);
  await repos.settings.audit(user.email, 'PROMOTE_WAITLIST', id);
  revalidatePath('/panel');
  back('/panel/lista-espera', { ok: `${r.firstName} ${r.lastName} pasó a pendiente de aprobación (ocupa cupo desde ahora).` });
}

// ─── Duplicados ────────────────────────────────────────────────────────────

export async function mergeAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const into = str(fd, 'into'); const from = str(fd, 'from');
  const repos = await getRepos();
  let merged: Registration;
  try {
    merged = await repos.registrations.merge(into, from);
  } catch (e) {
    back('/panel/duplicados', { error: (e as Error).message });
  }
  await repos.registrations.recordDuplicateDecision(into, from, 'merged', user.email);
  await repos.settings.audit(user.email, 'MERGE_DUPLICATE', into, { from });
  revalidatePath('/panel');
  back('/panel/duplicados', { ok: `Fusionadas en una sola inscripción: ${merged.firstName} ${merged.lastName}.` });
}

export async function markDistinctAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const repos = await getRepos();
  await repos.registrations.recordDuplicateDecision(str(fd, 'a'), str(fd, 'b'), 'distinct', user.email);
  await repos.settings.audit(user.email, 'DISTINCT_DUPLICATE', str(fd, 'a'), { b: str(fd, 'b') });
  revalidatePath('/panel/duplicados');
  back('/panel/duplicados', { ok: 'Marcadas como personas distintas.' });
}

// ─── Credenciales ──────────────────────────────────────────────────────────

export async function revokeAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const id = str(fd, 'id'); const reason = str(fd, 'reason'); const returnTo = str(fd, 'returnTo') || '/panel/credenciales';
  if (!reason) back(returnTo, { error: 'Escribe el motivo de la anulación.' });
  const repos = await getRepos();
  const r = await repos.registrations.byId(id);
  if (!r) back(returnTo, { error: 'No encontré esa inscripción.' });
  await repos.registrations.revoke(id, reason);
  await repos.settings.audit(user.email, 'REVOKE', id, { reason });
  revalidatePath('/panel');
  back(returnTo, { ok: `Credencial de ${r.firstName} ${r.lastName} anulada. El host la recibe en su próxima actualización.` });
}

export async function unrevokeAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const id = str(fd, 'id'); const returnTo = str(fd, 'returnTo') || '/panel/credenciales';
  const repos = await getRepos();
  await repos.registrations.unrevoke(id);
  await repos.settings.audit(user.email, 'UNREVOKE', id);
  revalidatePath('/panel');
  back(returnTo, { ok: 'Anulación retirada. Si el host ya la aplicó, re-emite la credencial desde el host.' });
}

// ─── Exportar: clave del host ──────────────────────────────────────────────

export async function rotateCloudKeyAction(): Promise<void> {
  const user = await requireUserOrThrow(['admin']);
  const repos = await getRepos();
  await rotateCloudKey(repos);
  await repos.settings.audit(user.email, 'ROTATE_CLOUD_KEY');
  revalidatePath('/panel/exportar');
  back('/panel/exportar', { ok: 'Clave nueva generada. La anterior ya no vale: actualiza TP_CLOUD_KEY en el host y reinícialo.' });
}

// ─── Cupos ─────────────────────────────────────────────────────────────────

function intOrNull(v: string): number | null {
  const t = v.trim();
  if (!t || t.toLowerCase() === 'sin límite') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export async function saveCapacitiesAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const repos = await getRepos();
  const { config: base } = await eventConfig(repos);
  const current = (await repos.settings.eventSettings()).config;
  const roles = base.roles.map((r) => ({ ...r, capacity: fd.has(`role.${r.code}.unlimited`) ? null : intOrNull(str(fd, `role.${r.code}.capacity`)) }));
  const ageCategories = base.ageCategories.map((c) => ({ ...c, capacity: fd.has(`cat.${c.code}.unlimited`) ? null : intOrNull(str(fd, `cat.${c.code}.capacity`)) }));
  const settings: EventSettings['config'] = {
    ...current, roles, ageCategories,
    companions: { perParticipant: fd.has('companions.perUnlimited') ? null : intOrNull(str(fd, 'companions.perParticipant')), total: fd.has('companions.totalUnlimited') ? null : intOrNull(str(fd, 'companions.total')) },
    totalCapacity: fd.has('totalUnlimited') ? null : intOrNull(str(fd, 'totalCapacity'))
  };
  await repos.settings.saveEventConfig(settings);
  await repos.settings.audit(user.email, 'SAVE_CAPACITIES', undefined, { roles: roles.map((r) => [r.code, r.capacity]), companions: settings.companions, totalCapacity: settings.totalCapacity });
  revalidatePath('/');
  revalidatePath('/panel');
  back('/panel/cupos', { ok: 'Cupos guardados. El formulario ya usa los nuevos límites.' });
}

// ─── Evento ────────────────────────────────────────────────────────────────

export async function saveEventAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const repos = await getRepos();
  const { config: base } = await eventConfig(repos);
  const current = (await repos.settings.eventSettings()).config;
  const roles = base.roles.map((r) => ({
    ...r,
    name: str(fd, `role.${r.code}.name`) || r.name,
    requiresPhoto: fd.has(`role.${r.code}.requiresPhoto`),
    allowsDigital: fd.has(`role.${r.code}.allowsDigital`)
  }));
  const ageCategories: EventSettings['config']['ageCategories'] = [];
  for (let i = 0; i < 20; i++) {
    const code = str(fd, `cat.${i}.code`).toUpperCase();
    if (!code) continue;
    const name = str(fd, `cat.${i}.name`) || code;
    const minAge = Number(str(fd, `cat.${i}.min`)); const maxRaw = str(fd, `cat.${i}.max`);
    if (!Number.isFinite(minAge)) back('/panel/evento', { error: `Revisa la edad mínima de ${name}.` });
    const prev = base.ageCategories.find((c) => c.code === code);
    ageCategories.push({ code, name, minAge, maxAge: maxRaw ? Number(maxRaw) : null, capacity: prev?.capacity ?? null });
  }
  const startDate = str(fd, 'startDate'); const endDate = str(fd, 'endDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) back('/panel/evento', { error: 'Revisa las fechas del evento.' });
  const settings: EventSettings['config'] = { ...current, name: str(fd, 'name') || base.name, startDate, endDate, roles, ageCategories: ageCategories.length ? ageCategories : undefined };
  await repos.settings.saveEventConfig(settings);
  await repos.settings.audit(user.email, 'SAVE_EVENT', undefined, { name: settings.name, startDate, endDate, categories: ageCategories.map((c) => c.code) });
  revalidatePath('/');
  revalidatePath('/panel');
  back('/panel/evento', { ok: 'Configuración guardada. El formulario ya usa los nuevos datos.' });
}

export async function saveFormAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const repos = await getRepos();
  const toIso = (v: string) => (v ? new Date(v.length === 16 ? `${v}:00-05:00` : v).toISOString() : '');
  const form = { intro: str(fd, 'intro'), successNote: str(fd, 'successNote'), privacyNotice: str(fd, 'privacyNotice'), opensAt: toIso(str(fd, 'opensAt')), closesAt: toIso(str(fd, 'closesAt')) };
  if (form.opensAt && form.closesAt && form.closesAt < form.opensAt) back('/panel/evento', { error: 'El cierre no puede ser antes de la apertura.' });
  if (!form.privacyNotice) back('/panel/evento', { error: 'El aviso de privacidad no puede quedar vacío (Ley 1581 de 2012).' });
  await repos.settings.saveFormSettings(form);
  await repos.settings.audit(user.email, 'SAVE_FORM');
  revalidatePath('/');
  back('/panel/evento', { ok: 'Textos y fechas del formulario guardados.' });
}

// ─── Clubes e inscriptores ─────────────────────────────────────────────────

export async function createDelegationAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin', 'coord']);
  const name = str(fd, 'name');
  if (!name) back('/panel/delegaciones', { error: 'Escribe el nombre del club o academia.' });
  const repos = await getRepos();
  const d = await repos.users.createDelegation({ name, city: str(fd, 'city') || undefined });
  await repos.settings.audit(user.email, 'CREATE_DELEGATION', d.id, { name });
  revalidatePath('/panel/delegaciones');
  back('/panel/delegaciones', { ok: `Club "${d.name}" listo. Ahora puedes invitar a su inscriptor.` });
}

export async function deleteDelegationAction(fd: FormData): Promise<void> {
  const user = await requireUserOrThrow(['admin']);
  const repos = await getRepos();
  await repos.users.deleteDelegation(str(fd, 'id'));
  await repos.settings.audit(user.email, 'DELETE_DELEGATION', str(fd, 'id'));
  revalidatePath('/panel/delegaciones');
  back('/panel/delegaciones', { ok: 'Club borrado. Sus inscripciones se conservan.' });
}

export async function inviteUserAction(fd: FormData): Promise<void> {
  const inviter = await requireUserOrThrow(['admin', 'coord']);
  const parsed = inviteSchema.safeParse(formToObject(fd));
  if (!parsed.success) back('/panel/delegaciones', { error: firstError(zodErrors(parsed.error)) });
  const { email, role } = parsed.data; const name = parsed.data.name || ''; const delegationId = parsed.data.delegationId || undefined;
  if (role !== 'club' && inviter.role !== 'admin') back('/panel/delegaciones', { error: 'Solo un administrador puede invitar coordinadores o administradores.' });
  if (role === 'club' && !delegationId) back('/panel/delegaciones', { error: 'Elige el club del inscriptor.' });
  const repos = await getRepos();
  if (await repos.users.byEmail(email)) back('/panel/delegaciones', { error: 'Ya existe un usuario con ese correo. Usa "Reenviar invitación".' });
  const token = secureToken(); const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  const u = await repos.users.create({ email, name: name || email.split('@')[0], role, delegationId, inviteToken: token, inviteExpiresAt: expiresAt });
  const delegation = delegationId ? await repos.users.delegationById(delegationId) : undefined;
  const mail = await sendMail(inviteMail(email, inviter.name || inviter.email, delegation?.name, token, expiresAt));
  await repos.settings.audit(inviter.email, 'INVITE_USER', u.id, { role, delegationId });
  revalidatePath('/panel/delegaciones');
  back('/panel/delegaciones', { ok: mail.ok ? `Invitación enviada a ${email}. Vence en 7 días.` : `Usuario creado, pero el correo no salió (${mail.error}). Reenvía la invitación más tarde.` });
}

export async function resendInviteAction(fd: FormData): Promise<void> {
  const inviter = await requireUserOrThrow(['admin', 'coord']);
  const repos = await getRepos();
  const u = await repos.users.byId(str(fd, 'id'));
  if (!u) back('/panel/delegaciones', { error: 'No encontré ese usuario.' });
  if (u.role !== 'club' && inviter.role !== 'admin') back('/panel/delegaciones', { error: 'Solo un administrador puede reenviar invitaciones a coordinadores o administradores.' });
  const token = secureToken(); const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  await repos.users.setInvite(u.id, token, expiresAt);
  const delegation = u.delegationId ? await repos.users.delegationById(u.delegationId) : undefined;
  const mail = await sendMail(inviteMail(u.email, inviter.name || inviter.email, delegation?.name, token, expiresAt));
  await repos.settings.audit(inviter.email, 'RESEND_INVITE', u.id);
  revalidatePath('/panel/delegaciones');
  back('/panel/delegaciones', mail.ok ? { ok: `Invitación reenviada a ${u.email}. Si ya tenía contraseña, con el enlace puede definir una nueva.` } : { error: `No se pudo enviar el correo: ${mail.error}` });
}

export async function deleteUserAction(fd: FormData): Promise<void> {
  const admin = await requireUserOrThrow(['admin']);
  const id = str(fd, 'id');
  if (id === admin.id) back('/panel/delegaciones', { error: 'No puedes borrar tu propio usuario.' });
  const repos = await getRepos();
  await repos.users.delete(id);
  await repos.settings.audit(admin.email, 'DELETE_USER', id);
  revalidatePath('/panel/delegaciones');
  back('/panel/delegaciones', { ok: 'Usuario borrado.' });
}

/** Para el formulario público: si hay sesión de inscriptor, precarga su delegación. */
export async function whoAmI(): Promise<{ email: string; role: UserRole; delegationId?: string } | null> {
  const u = await currentUser();
  return u ? { email: u.email, role: u.role, delegationId: u.delegationId } : null;
}
