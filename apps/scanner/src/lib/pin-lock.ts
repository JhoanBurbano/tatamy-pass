/**
 * Bloqueo de PIN (RF-072 / TC-074): 5 intentos incorrectos → 15 minutos de
 * bloqueo con cuenta regresiva. Lógica pura y serializable: el estado se
 * guarda en localStorage para que sobreviva a recargas.
 */
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60_000;

export interface PinLockState {
  fails: number;
  /** Epoch ms hasta el que está bloqueado; `null` = no bloqueado. */
  lockedUntil: number | null;
}

export const initialPinLock: PinLockState = { fails: 0, lockedUntil: null };

export type PinAttempt =
  | { ok: true; state: PinLockState }
  | { ok: false; state: PinLockState; locked: boolean; remainingAttempts: number; lockedForMs: number; message: string };

export function isLocked(state: PinLockState, now: number): boolean {
  return state.lockedUntil !== null && now < state.lockedUntil;
}

export function lockRemainingMs(state: PinLockState, now: number): number {
  return state.lockedUntil === null ? 0 : Math.max(0, state.lockedUntil - now);
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Registra un intento. `correct` indica si el PIN coincidía. Durante el
 * bloqueo todo intento (incluso correcto) se rechaza y NO reinicia el contador.
 */
export function attemptPin(state: PinLockState, correct: boolean, now: number): PinAttempt {
  if (isLocked(state, now)) {
    const left = lockRemainingMs(state, now);
    return { ok: false, state, locked: true, remainingAttempts: 0, lockedForMs: left, message: `Dispositivo bloqueado. Espera ${formatCountdown(left)}.` };
  }
  // Bloqueo vencido: limpio.
  const base: PinLockState = state.lockedUntil !== null ? { fails: 0, lockedUntil: null } : state;
  if (correct) return { ok: true, state: { fails: 0, lockedUntil: null } };
  const fails = base.fails + 1;
  if (fails >= MAX_PIN_ATTEMPTS) {
    const until = now + PIN_LOCK_MS;
    return { ok: false, state: { fails, lockedUntil: until }, locked: true, remainingAttempts: 0, lockedForMs: PIN_LOCK_MS, message: `Demasiados intentos. Dispositivo bloqueado ${formatCountdown(PIN_LOCK_MS)}.` };
  }
  const remaining = MAX_PIN_ATTEMPTS - fails;
  return {
    ok: false, state: { fails, lockedUntil: null }, locked: false, remainingAttempts: remaining, lockedForMs: 0,
    message: `PIN incorrecto. Te queda${remaining === 1 ? '' : 'n'} ${remaining} intento${remaining === 1 ? '' : 's'}.`
  };
}

const KEY = 'tp.pinLock';

export function loadPinLock(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): PinLockState {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return initialPinLock;
    const p = JSON.parse(raw) as Partial<PinLockState>;
    return { fails: Number(p.fails ?? 0), lockedUntil: typeof p.lockedUntil === 'number' ? p.lockedUntil : null };
  } catch {
    return initialPinLock;
  }
}

export function savePinLock(state: PinLockState, storage: Pick<Storage, 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(state));
  } catch {
    /* sin almacenamiento */
  }
}
