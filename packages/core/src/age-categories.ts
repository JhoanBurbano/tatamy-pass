/**
 * Edad a la fecha del evento y validación de categoría/cupo (§7).
 */
import type { AgeCategory, IsoDate } from './types.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Edad cumplida en `onDate` (ambas `YYYY-MM-DD`). */
export function ageOn(birthDate: IsoDate, onDate: IsoDate): number {
  if (!isIsoDate(birthDate)) throw new Error(`Fecha de nacimiento inválida: ${birthDate}`);
  if (!isIsoDate(onDate)) throw new Error(`Fecha inválida: ${onDate}`);
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [oy, om, od] = onDate.split('-').map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age--;
  return age;
}

export function isMinor(birthDate: IsoDate, onDate: IsoDate, adultAge = 18): boolean {
  return ageOn(birthDate, onDate) < adultAge;
}

export function categoryForAge(age: number, categories: AgeCategory[]): AgeCategory | undefined {
  return categories.find((c) => age >= c.minAge && (c.maxAge === null || age <= c.maxAge));
}

export type CategoryValidation =
  | { ok: true; category: AgeCategory; age: number }
  | { ok: false; reason: 'INVALID_BIRTHDATE' | 'UNKNOWN_CATEGORY' | 'AGE_MISMATCH' | 'NO_CATEGORY' | 'CAPACITY_FULL'; message: string; age?: number; suggested?: AgeCategory };

/**
 * Valida que la categoría elegida corresponda a la edad a la fecha del evento
 * y que haya cupo. `usedByCategory` = inscritos ya aceptados por categoría.
 */
export function validateCategory(args: {
  birthDate: IsoDate;
  eventStartDate: IsoDate;
  categoryCode: string;
  categories: AgeCategory[];
  usedByCategory?: Record<string, number>;
}): CategoryValidation {
  const { birthDate, eventStartDate, categoryCode, categories, usedByCategory = {} } = args;
  if (!isIsoDate(birthDate)) {
    return { ok: false, reason: 'INVALID_BIRTHDATE', message: 'La fecha de nacimiento no es válida. Usa el formato AAAA-MM-DD.' };
  }
  const age = ageOn(birthDate, eventStartDate);
  const category = categories.find((c) => c.code === categoryCode);
  if (!category) {
    return { ok: false, reason: 'UNKNOWN_CATEGORY', message: 'Esa categoría no existe en este evento.', age };
  }
  const suggested = categoryForAge(age, categories);
  const fits = age >= category.minAge && (category.maxAge === null || age <= category.maxAge);
  if (!fits) {
    const rango = category.maxAge === null ? `${category.minAge} años o más` : `${category.minAge} a ${category.maxAge} años`;
    const sug = suggested ? ` Según la edad, le corresponde ${suggested.name}.` : ' No hay una categoría para esa edad en este evento.';
    return {
      ok: false,
      reason: 'AGE_MISMATCH',
      message: `Al primer día del evento tendrá ${age} años y ${category.name} es para ${rango}.${sug}`,
      age,
      suggested
    };
  }
  if (category.capacity !== null && (usedByCategory[category.code] ?? 0) >= category.capacity) {
    return { ok: false, reason: 'CAPACITY_FULL', message: `La categoría ${category.name} ya llenó su cupo. Puedes quedar en lista de espera.`, age };
  }
  return { ok: true, category, age };
}

/** Cupo por rol: devuelve cuántos quedan (`Infinity` si no hay límite). */
export function remainingCapacity(capacity: number | null, used: number): number {
  if (capacity === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, capacity - used);
}
