/**
 * Doble confirmación para "Promover a principal": paso 1 confirma que el
 * principal no responde; paso 2 exige escribir PROMOVER. Sin estado global: el
 * renderer manda el paso y el texto, y aquí se decide.
 */
import type { HostMode } from '../shared/ipc.js';

export const PROMOTE_WORD = 'PROMOVER';
export const PROMOTE_STEP1 = 'SI';

export interface PromoteCheck { ok: boolean; message: string; nextStep?: 2 }

export function promoteGuard(mode: HostMode, step: 1 | 2, text: string): PromoteCheck {
  if (mode === 'primary') return { ok: false, message: 'Este equipo ya es el principal. Nada que hacer.' };
  const t = text.trim().toUpperCase().replace('Í', 'I');
  if (step === 1) {
    if (t !== PROMOTE_STEP1) return { ok: false, message: 'Escribe SI para confirmar que el principal no responde. Si responde, no promuevas: habría dos fuentes de verdad.' };
    return { ok: true, message: 'Paso 2 de 2: escribe PROMOVER. Después tendrás que apuntar cada scanner a este equipo.', nextStep: 2 };
  }
  if (t !== PROMOTE_WORD) return { ok: false, message: 'Escribe PROMOVER exactamente para convertir este equipo en principal.' };
  return { ok: true, message: 'Este equipo ahora es el principal.' };
}
