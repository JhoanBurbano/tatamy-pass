import { randomBytes } from 'node:crypto';

let counter = 0;

/**
 * Id interno corto: `r_<tiempo base36>_<contador>_<azar>`. El contador hace que dos filas creadas
 * en el mismo milisegundo queden ordenadas por id en el mismo orden en que se crearon (la lista de
 * espera ordena por `created_at, id`).
 */
export function newId(prefix: string): string {
  counter = (counter + 1) % 46656; // 36^3
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36).padStart(3, '0')}${randomBytes(3).toString('hex')}`;
}

/** Alfabeto sin caracteres confusos (0/O, 1/I/L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Código público de inscripción `N26-XXXXXX` (6 caracteres, ~887 millones de combinaciones). */
export function publicCode(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `N26-${out}`;
}

/** Token opaco para enlaces por correo (confirmación de cupo, invitación). */
export function secureToken(): string {
  return randomBytes(24).toString('base64url');
}
