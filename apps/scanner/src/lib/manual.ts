/**
 * Ingreso manual (§4): validación del ID corto en el cliente (dígito
 * verificador Luhn mod 36) y del motivo (catálogo + texto). Puro.
 */
import {
  EXCEPTION_REASONS, MANUAL_ENTRY_REASONS, luhnMod36Validate, normalizeCredentialInput, parseCredentialId, type ReasonOption
} from '@tatami/core';

export { EXCEPTION_REASONS, MANUAL_ENTRY_REASONS };
export type { ReasonOption };

export const MIN_REASON_TEXT = 5;

export type IdCheck =
  | { ok: true; id: string; seq: number }
  | { ok: false; state: 'empty' | 'incomplete' | 'format' | 'check'; error: string };

/**
 * Valida lo que escribe el operador. Tolera minúsculas, espacios y guiones
 * faltantes. Distingue "aún falta" de "el dígito verificador no coincide".
 */
export function checkManualId(raw: string): IdCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, state: 'empty', error: 'Escribe el ID corto impreso bajo el QR (ej. TP-2026-00123-C).' };
  const compact = trimmed.toUpperCase().replace(/[\s\-_.]/g, '');
  if (compact.length < 12) {
    if (/^[A-Z]{0,2}\d{0,9}[0-9A-Z]?$/.test(compact)) return { ok: false, state: 'incomplete', error: 'Faltan caracteres: el ID tiene 2 letras, 4 dígitos del año, 5 del número y 1 de control.' };
    return { ok: false, state: 'format', error: 'Eso no parece un ID corto. Tiene la forma TP-2026-00123-C.' };
  }
  const m = /^([A-Z]{2})(\d{4})(\d{5})([0-9A-Z])$/.exec(compact);
  if (!m) return { ok: false, state: 'format', error: 'Eso no parece un ID corto. Tiene la forma TP-2026-00123-C.' };
  if (!luhnMod36Validate(m[2] + m[3] + m[4])) {
    return { ok: false, state: 'check', error: 'El último carácter no coincide: revisa el ID, probablemente hay un número mal escrito.' };
  }
  const parsed = parseCredentialId(normalizeCredentialInput(trimmed));
  if (!parsed) return { ok: false, state: 'format', error: 'Eso no parece un ID corto. Tiene la forma TP-2026-00123-C.' };
  return { ok: true, id: normalizeCredentialInput(trimmed), seq: parsed.seq };
}

export interface ReasonChoice {
  code: string;
  text: string;
}

export type ReasonCheck = { ok: true; reason: string; reasonCode: string } | { ok: false; error: string };

/** Motivo = opción del catálogo + texto (obligatorio en "Otro"). */
export function checkReason(choice: ReasonChoice | undefined, catalog: ReasonOption[]): ReasonCheck {
  if (!choice?.code) return { ok: false, error: 'Elige un motivo.' };
  const opt = catalog.find((o) => o.code === choice.code);
  if (!opt) return { ok: false, error: 'Elige un motivo de la lista.' };
  const text = choice.text.trim();
  if (opt.requiresText && text.length < MIN_REASON_TEXT) return { ok: false, error: `Explica el motivo (mínimo ${MIN_REASON_TEXT} caracteres).` };
  const reason = text ? `${opt.label}: ${text}` : opt.label;
  return { ok: true, reason, reasonCode: opt.code };
}
