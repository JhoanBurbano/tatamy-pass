/**
 * Modo de la puerta (§3): Entrada, Salida o Entrada+Salida. Puro.
 * - `IN` / `OUT`: cada lectura va con esa dirección, sin preguntar.
 * - `BOTH`: tras cada lectura se pregunta la dirección con dos botones grandes.
 */
import type { GateMode } from '@tatami/core';

export type Direction = 'IN' | 'OUT';

export const GATE_MODES: Array<{ code: GateMode; label: string; hint: string }> = [
  { code: 'IN', label: 'Entrada', hint: 'Solo registra entradas' },
  { code: 'OUT', label: 'Salida', hint: 'Solo registra salidas' },
  { code: 'BOTH', label: 'Entrada + Salida', hint: 'Pregunta en cada lectura' }
];

export function modeLabel(mode: GateMode | undefined): string {
  return GATE_MODES.find((m) => m.code === (mode ?? 'IN'))?.label ?? 'Entrada';
}

/** Normaliza un modo guardado (dispositivos enrolados antes de v2 no lo tienen). */
export function normalizeMode(mode: unknown): GateMode {
  return mode === 'OUT' || mode === 'BOTH' ? mode : 'IN';
}

/** `true` si hay que preguntar la dirección antes de procesar la lectura. */
export function needsDirectionPrompt(mode: GateMode): boolean {
  return mode === 'BOTH';
}

/**
 * Dirección efectiva de una lectura. En `IN`/`OUT` la del modo manda (aunque
 * se pase otra); en `BOTH` hace falta `chosen`, si no, `undefined` = preguntar.
 */
export function directionFor(mode: GateMode, chosen?: Direction): Direction | undefined {
  if (mode === 'IN') return 'IN';
  if (mode === 'OUT') return 'OUT';
  return chosen;
}
