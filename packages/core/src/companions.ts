/**
 * Acompañantes por participante y aforo total del evento (§7 de 00-DECISIONES).
 * Puro: recibe los conteos ya calculados y devuelve ok | error con mensaje humano.
 */
import type { EventConfig } from './types.js';

export const COMPANION_ROLE = 'ACOMP';

export interface CompanionLimits {
  /** Acompañantes por participante. `null` = sin límite. */
  perParticipant: number | null;
  /** Total de acompañantes del evento. `null` = sin límite. */
  total: number | null;
}

export const DEFAULT_COMPANIONS: CompanionLimits = { perParticipant: 2, total: null };

/** Cuántos quedan; `Infinity` cuando el límite es `null`. */
export function remainingFor(limit: number | null, used: number): number {
  if (limit === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - used);
}

export function remainingCompanionsForParticipant(config: Pick<EventConfig, 'companions'>, participantCompanionsCount: number): number {
  return remainingFor(config.companions.perParticipant, participantCompanionsCount);
}

export function remainingCompanionsTotal(config: Pick<EventConfig, 'companions'>, usedCompanionsTotal: number): number {
  return remainingFor(config.companions.total, usedCompanionsTotal);
}

export function remainingEventCapacity(config: Pick<EventConfig, 'totalCapacity'>, usedTotalEvent: number): number {
  return remainingFor(config.totalCapacity, usedTotalEvent);
}

export type CompanionsValidation =
  | { ok: true; remainingForParticipant: number; remainingTotal: number; remainingEvent: number }
  | { ok: false; reason: 'PER_PARTICIPANT_LIMIT' | 'TOTAL_LIMIT' | 'EVENT_CAPACITY'; message: string; allowed: number };

export interface ValidateCompanionsArgs {
  /** Acompañantes que ya tiene este participante. */
  participantCompanionsCount: number;
  /** Cuántos se quieren agregar ahora. */
  adding: number;
  config: Pick<EventConfig, 'companions' | 'totalCapacity'>;
  /** Acompañantes ya registrados en todo el evento. */
  usedCompanionsTotal?: number;
  /** Personas ya registradas en el evento (participantes + acompañantes + otros). */
  usedTotalEvent?: number;
}

/**
 * Valida que se puedan agregar `adding` acompañantes a un participante.
 * Orden: límite por participante → cupo total de acompañantes → aforo total del evento.
 */
export function validateCompanions(args: ValidateCompanionsArgs): CompanionsValidation {
  const { participantCompanionsCount, adding, config } = args;
  const usedCompanionsTotal = args.usedCompanionsTotal ?? 0;
  const usedTotalEvent = args.usedTotalEvent ?? 0;
  if (!Number.isInteger(adding) || adding < 0) throw new Error(`adding inválido: ${adding}`);

  const perRemaining = remainingFor(config.companions.perParticipant, participantCompanionsCount);
  if (adding > perRemaining) {
    const max = config.companions.perParticipant!;
    const message = participantCompanionsCount >= max
      ? `Este participante ya tiene ${participantCompanionsCount} acompañante${participantCompanionsCount === 1 ? '' : 's'}, el máximo permitido.`
      : `Cada participante puede tener máximo ${max} acompañante${max === 1 ? '' : 's'}; solo puedes agregar ${perRemaining} más.`;
    return { ok: false, reason: 'PER_PARTICIPANT_LIMIT', message, allowed: perRemaining };
  }

  const totalRemaining = remainingFor(config.companions.total, usedCompanionsTotal);
  if (adding > totalRemaining) {
    const message = totalRemaining === 0
      ? 'Se llenó el cupo de acompañantes del evento.'
      : `Solo quedan ${totalRemaining} cupo${totalRemaining === 1 ? '' : 's'} de acompañantes en el evento.`;
    return { ok: false, reason: 'TOTAL_LIMIT', message, allowed: totalRemaining };
  }

  const eventRemaining = remainingFor(config.totalCapacity, usedTotalEvent);
  if (adding > eventRemaining) {
    const message = eventRemaining === 0
      ? 'El evento llegó a su aforo total.'
      : `El evento está casi lleno: solo quedan ${eventRemaining} lugar${eventRemaining === 1 ? '' : 'es'}.`;
    return { ok: false, reason: 'EVENT_CAPACITY', message, allowed: eventRemaining };
  }

  return { ok: true, remainingForParticipant: perRemaining - adding, remainingTotal: totalRemaining - adding, remainingEvent: eventRemaining - adding };
}

/** Texto del contador para el formulario: "1 de 2" o "sin límite". */
export function companionsCounterLabel(count: number, perParticipant: number | null): string {
  return perParticipant === null ? `${count} · sin límite` : `${count} de ${perParticipant}`;
}
