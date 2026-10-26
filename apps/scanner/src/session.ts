/**
 * Sesión del operador en el dispositivo: se abre con el PIN, dura 12 h o
 * hasta "Terminar turno". Persistida en localStorage (sobrevive recargas).
 */
import { sessionActive, type SessionInfo } from './lib/shift.js';

const KEY = 'tp.session';

export function loadSession(): SessionInfo | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as Partial<SessionInfo>;
    if (typeof p.unlockedAt !== 'number') return undefined;
    return { unlockedAt: p.unlockedAt, shiftStartedAt: typeof p.shiftStartedAt === 'number' ? p.shiftStartedAt : p.unlockedAt, operator: typeof p.operator === 'string' ? p.operator : undefined };
  } catch {
    return undefined;
  }
}

export function openSession(now = Date.now(), operator?: string): SessionInfo {
  const prev = loadSession();
  // Si el turno sigue abierto (p. ej. recarga dentro de las 12 h) se conserva su inicio y su operador.
  const active = prev && sessionActive(prev, now);
  const s: SessionInfo = { unlockedAt: now, shiftStartedAt: active ? prev.shiftStartedAt : now, operator: operator ?? (active ? prev.operator : undefined) };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
  return s;
}

/** Cambia el operador del turno abierto (pantalla "Inicio de turno"). */
export function setSessionOperator(operator: string): SessionInfo | undefined {
  const s = loadSession();
  if (!s) return undefined;
  const next = { ...s, operator };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
  return next;
}

export function closeSession(): void {
  try { localStorage.removeItem(KEY); } catch { /* nada */ }
}

export function currentSession(now = Date.now()): SessionInfo | undefined {
  const s = loadSession();
  return s && sessionActive(s, now) ? s : undefined;
}
