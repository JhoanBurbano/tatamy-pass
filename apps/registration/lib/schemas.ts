/**
 * Esquemas zod de entrada. Validan forma y tamaño (tipos, longitudes, formatos) antes de que la
 * lógica de negocio (`lib/validate.ts`) decida sobre edad, cupos y consentimiento. Los mensajes
 * siguen docs/70-UX-WRITING.md §5.3: cortos, sin culpar y con qué hacer.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max, `Máximo ${max} caracteres.`);
const optionalText = (max: number) => text(max).optional().or(z.literal('').transform(() => undefined));
const bool = z.union([z.boolean(), z.literal('true'), z.literal('on'), z.literal('1'), z.literal('false'), z.literal('')]).transform((v) => v === true || v === 'true' || v === 'on' || v === '1').optional();

export const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Revisa la fecha de nacimiento. Escríbela como día / mes / año.');
export const email = z.string().trim().toLowerCase().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Revisa el correo. Ejemplo: nombre@correo.com').max(160);
export const documentNumber = z.string().trim().regex(/^[A-Za-z0-9.-]{0,30}$/, 'Escribe el documento sin puntos ni espacios.');
/** Data URL JPEG/PNG; el tamaño real lo revisa `decodePhoto` (2 MB). */
export const photoDataUrl = z.string().regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/, 'No pude leer la foto. Prueba con otra en JPG o PNG.').max(3 * 1024 * 1024, 'La foto pesa demasiado. Recórtala de nuevo o usa una más liviana.');

export const companionSchema = z.object({
  name: optionalText(120),
  document: optionalText(30),
  relationship: optionalText(60),
  photo: photoDataUrl.optional().or(z.literal('').transform(() => undefined))
});

export const registerSchema = z.object({
  firstName: optionalText(80),
  lastName: optionalText(80),
  birthDate: optionalText(10),
  documentNumber: optionalText(30),
  club: optionalText(120),
  delegationId: optionalText(64),
  email: optionalText(160),
  roleCode: optionalText(16),
  categoryCode: optionalText(16),
  guardianName: optionalText(120),
  guardianDocument: optionalText(30),
  guardianConsent: bool,
  delegation: optionalText(80),
  emergencyName: optionalText(120),
  emergencyPhone: optionalText(30),
  epsName: optionalText(80),
  epsRegime: optionalText(40),
  privacyConsent: bool,
  acceptWaitlist: bool,
  photo: photoDataUrl.optional().or(z.literal('').transform(() => undefined)),
  companions: z.array(companionSchema).max(20, 'Demasiados acompañantes.').optional()
});

export type RegisterBody = z.infer<typeof registerSchema>;

/** Edición desde el panel (ficha de inscripción). */
export const editRegistrationSchema = z.object({
  firstName: text(80).min(1, 'Escribe el nombre.'),
  lastName: text(80).min(1, 'Escribe el apellido.'),
  birthDate: isoDate.or(z.literal('')),
  documentNumber: documentNumber.optional().or(z.literal('')),
  club: text(120).optional().or(z.literal('')),
  email: email.optional().or(z.literal('')),
  categoryCode: text(16).optional().or(z.literal('')),
  guardianName: text(120).optional().or(z.literal('')),
  guardianDocument: text(30).optional().or(z.literal('')),
  relationship: text(60).optional().or(z.literal(''))
});

export const loginSchema = z.object({
  email: email,
  password: z.string().min(1, 'Escribe la contraseña.').max(200),
  next: z.string().max(300).optional()
});

export const inviteSchema = z.object({
  email: email,
  name: text(120).optional().or(z.literal('')),
  role: z.enum(['admin', 'coord', 'club'], { message: 'Elige un rol válido.' }),
  delegationId: text(64).optional().or(z.literal(''))
});

/** Primer mensaje legible de un error zod, por campo. */
export function zodErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Convierte un FormData en objeto plano (solo strings; las casillas quedan como 'on'). */
export function formToObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') o[k] = v;
  return o;
}
