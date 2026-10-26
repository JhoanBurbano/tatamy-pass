import { COMPANION_ROLE, isIsoDate, isMinor, remainingCapacity, splitFullName, validateCategory, validateCompanions, type EventConfig } from '@tatami/core';
import type { Repos } from './repo';
import type { FormSettings, Registration } from './repo/types';
import { registrationWindow } from './config';
import { decodePhoto, storePhoto } from './photos';

export interface RegisterInput {
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  documentNumber?: string;
  club?: string;
  delegationId?: string;
  email?: string;
  roleCode?: string;
  categoryCode?: string;
  guardianName?: string;
  guardianDocument?: string;
  guardianConsent?: boolean;
  /** Delegación (departamento/región) para la credencial. */
  delegation?: string;
  /** Contacto de emergencia y EPS (reverso de la credencial); obligatorios si `config.registration.requireEmergencyContact`. */
  emergencyName?: string;
  emergencyPhone?: string;
  epsName?: string;
  epsRegime?: string;
  /** Aviso de privacidad aceptado por quien inscribe. */
  privacyConsent?: boolean;
  acceptWaitlist?: boolean;
  /** Foto cuadrada recortada en el navegador (data URL JPEG/PNG). */
  photo?: string;
  companions?: CompanionInput[];
}

export interface CompanionInput {
  name?: string;
  document?: string;
  relationship?: string;
  photo?: string;
}

export type RegisterOutcome =
  | { ok: true; status: 'PENDING' | 'WAITLIST'; registration: Registration; companions: Registration[]; created: boolean; message: string }
  | { ok: false; code: 'VALIDATION' | 'CAPACITY_FULL' | 'CLOSED'; errors: Record<string, string>; message: string; remaining?: number };

export interface ProcessOptions {
  config: EventConfig;
  form?: FormSettings;
  now?: Date;
  /** Para tests: no guarda fotos en disco. */
  storePhoto?: (id: string, photo: { buffer: Buffer; mime: string }) => Promise<string>;
}

export async function processRegistration(repos: Repos, input: RegisterInput, opts: ProcessOptions): Promise<RegisterOutcome> {
  const { config } = opts;
  const { registrations } = repos;
  if (opts.form) {
    const w = registrationWindow(opts.form, opts.now);
    if (!w.open) return { ok: false, code: 'CLOSED', errors: {}, message: w.reason! };
  }

  const errors: Record<string, string> = {};
  const firstName = input.firstName?.trim() ?? '';
  const lastName = input.lastName?.trim() ?? '';
  const birthDate = input.birthDate?.trim() ?? '';
  const roleCode = input.roleCode?.trim() || 'COMP';
  const role = config.roles.find((r) => r.code === roleCode);

  if (!firstName) errors.firstName = 'Escribe el nombre.';
  if (!lastName) errors.lastName = 'Escribe el apellido.';
  if (!isIsoDate(birthDate)) errors.birthDate = 'Revisa la fecha de nacimiento. Escríbela como día / mes / año.';
  if (!role || role.code === COMPANION_ROLE) errors.roleCode = 'Elige un tipo de inscripción válido.';
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) errors.email = 'Revisa el correo. Ejemplo: nombre@correo.com';
  if (input.privacyConsent === false) errors.privacyConsent = 'Para continuar, lee el aviso de privacidad y marca la casilla.';
  const emergencyName = input.emergencyName?.trim() ?? '';
  const emergencyPhone = input.emergencyPhone?.trim() ?? '';
  if (config.registration?.requireEmergencyContact) {
    if (!emergencyName) errors.emergencyName = 'Escribe el nombre de a quién llamar en una emergencia.';
    if (!emergencyPhone) errors.emergencyPhone = 'Escribe el teléfono del contacto de emergencia.';
  }
  if ((emergencyName && !emergencyPhone) || (!emergencyName && emergencyPhone)) errors[emergencyName ? 'emergencyPhone' : 'emergencyName'] = 'El contacto de emergencia necesita nombre y teléfono.';
  if (emergencyPhone && !/^[+\d][\d\s().-]{6,29}$/.test(emergencyPhone)) errors.emergencyPhone = 'Revisa el teléfono. Ejemplo: 310 234 5678';

  const decoded = decodePhoto(input.photo);
  const photo = decoded === 'TOO_BIG' ? null : decoded;
  if (decoded === 'TOO_BIG') errors.photo = 'La foto pesa demasiado. Recórtala de nuevo o usa una más liviana.';
  else if (input.photo && !photo) errors.photo = 'No pude leer la foto. Prueba con otra en JPG o PNG.';
  else if (!photo && role?.requiresPhoto && process.env.PHOTO_REQUIRED === '1') errors.photo = 'Sube una foto de frente, con la cara completa y fondo claro. Se usa para la credencial.';

  let categoryCode: string | undefined;
  if (role && role.code !== COMPANION_ROLE && isIsoDate(birthDate)) {
    if (role.code === 'COMP') {
      if (!input.categoryCode) errors.categoryCode = 'Elige la categoría.';
      else {
        const v = validateCategory({ birthDate, eventStartDate: config.startDate, categoryCode: input.categoryCode, categories: config.ageCategories, usedByCategory: await registrations.countByCategory() });
        if (!v.ok) {
          if (v.reason === 'CAPACITY_FULL' && input.acceptWaitlist) categoryCode = input.categoryCode;
          else errors.categoryCode = v.message;
        } else categoryCode = v.category.code;
      }
    }
    if (isMinor(birthDate, config.startDate)) {
      if (!input.guardianName?.trim()) errors.guardianName = 'Para menores de edad, escribe el nombre del acudiente.';
      if (!input.guardianDocument?.trim()) errors.guardianDocument = 'Escribe el documento del acudiente.';
      if (!input.guardianConsent) errors.guardianConsent = 'El acudiente debe autorizar el tratamiento de datos del menor (Ley 1581 de 2012).';
    }
  }

  // Acompañantes: nombre obligatorio; límites por participante, cupo total y aforo (core).
  const companions = (input.companions ?? []).map((c) => ({ name: c.name?.trim() ?? '', document: c.document?.trim() || undefined, relationship: c.relationship?.trim() || undefined, photo: c.photo }));
  if (companions.some((c) => !c.name)) errors.companions = 'Cada acompañante necesita un nombre.';
  else if (companions.some((c) => c.photo && !decodePhoto(c.photo))) errors.companions = 'No pude leer la foto de un acompañante. Prueba con otra o quítala.';
  else if (companions.length > 0) {
    const v = validateCompanions({
      participantCompanionsCount: 0, adding: companions.length, config,
      usedCompanionsTotal: await registrations.countCompanions(), usedTotalEvent: (await registrations.countActive()) + 1
    });
    if (!v.ok) errors.companions = v.message;
  }

  if (Object.keys(errors).length) {
    return { ok: false, code: 'VALIDATION', errors, message: 'Revisa los campos marcados.' };
  }

  const used = (await registrations.countByRole())[role!.code] ?? 0;
  const remaining = remainingCapacity(role!.capacity, used);
  const eventRemaining = remainingCapacity(config.totalCapacity, await registrations.countActive());
  const full = remaining <= 0 || eventRemaining <= 0;
  if (full && !input.acceptWaitlist) {
    const message = remaining <= 0
      ? `El cupo para ${role!.name} está lleno. Puedes quedar en lista de espera: si se libera un lugar te avisamos por correo.`
      : 'El evento alcanzó su cupo total. Puedes quedar en lista de espera: si se libera un lugar te avisamos por correo.';
    return { ok: false, code: 'CAPACITY_FULL', errors: {}, remaining: 0, message };
  }

  const minor = isMinor(birthDate, config.startDate);
  const status: 'PENDING' | 'WAITLIST' = full ? 'WAITLIST' : 'PENDING';
  const club = input.club?.trim() || undefined;
  let delegationId = input.delegationId?.trim() || undefined;
  if (!delegationId && club) delegationId = (await repos.users.delegationByName(club))?.id;
  const delegationName = delegationId ? (await repos.users.delegationById(delegationId))?.name : undefined;
  const now = (opts.now ?? new Date()).toISOString();

  const { registration: saved, created } = await registrations.upsert({
    firstName, lastName, birthDate, documentNumber: input.documentNumber?.trim() || undefined, club: club ?? delegationName, delegationId,
    email: input.email?.trim() || undefined, roleCode: role!.code, categoryCode, status, source: 'online',
    guardian: minor ? { name: input.guardianName!.trim(), document: input.guardianDocument!.trim(), consentAt: now } : undefined,
    delegation: input.delegation?.trim() || undefined,
    emergencyContact: emergencyName && emergencyPhone ? { name: emergencyName, phone: emergencyPhone } : undefined,
    eps: input.epsName?.trim() ? { name: input.epsName.trim(), regime: input.epsRegime?.trim() || undefined } : undefined,
    consentAt: input.privacyConsent ? now : undefined
  });
  let registration = saved;
  if (photo) {
    const url = await (opts.storePhoto ?? storePhoto)(registration.id, photo);
    await registrations.update(registration.id, { photoUrl: url });
    registration = (await registrations.byId(registration.id))!;
  }

  // Los acompañantes se registran ligados al participante y heredan su estado (rol ACOMP, credencial digital).
  const existingCompanions = created ? [] : await registrations.companionsOf(registration.id);
  if (!created && companions.length > 0) {
    const v = validateCompanions({
      participantCompanionsCount: existingCompanions.length, adding: companions.length, config,
      usedCompanionsTotal: await registrations.countCompanions(), usedTotalEvent: await registrations.countActive()
    });
    if (!v.ok) return { ok: false, code: 'VALIDATION', errors: { companions: v.message }, message: 'Revisa los acompañantes.' };
  }
  const companionRegs: Registration[] = [];
  for (const c of companions) {
    const { firstName: cf, lastName: cl } = splitFullName(c.name);
    const r = await registrations.upsert({
      firstName: cf, lastName: cl, birthDate: '', documentNumber: c.document, club: registration.club, delegationId, roleCode: COMPANION_ROLE,
      status: registration.status === 'APPROVED' ? 'APPROVED' : status, source: 'online', companionOf: registration.id, relationship: c.relationship
    });
    let reg = r.registration;
    const cp = decodePhoto(c.photo);
    if (cp && cp !== 'TOO_BIG' && r.created) {
      const url = await (opts.storePhoto ?? storePhoto)(reg.id, cp);
      await registrations.update(reg.id, { photoUrl: url });
      reg = (await registrations.byId(reg.id))!;
    }
    companionRegs.push(reg);
  }

  return {
    ok: true, status, registration, companions: [...existingCompanions, ...companionRegs], created,
    message: status === 'WAITLIST'
      ? `Quedaste en lista de espera para ${role!.name}. Te avisamos si se libera un cupo.`
      : created ? `Listo, ${firstName}. Tu inscripción quedó registrada y pasa a revisión del coordinador.` : 'Ya tenías una inscripción con estos datos; la actualizamos.'
  };
}
