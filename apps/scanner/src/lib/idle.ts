/**
 * Bloqueo por inactividad (§8): tras `timeoutMs` sin tocar la pantalla se
 * pide el PIN otra vez (la sesión del turno sigue viva). Puro: recibe `now`.
 */
export const IDLE_LOCK_MS = 5 * 60_000;

export interface IdleState {
  lastActivityAt: number;
}

export function touch(_state: IdleState, now: number): IdleState {
  return { lastActivityAt: now };
}

export function isIdle(state: IdleState, now: number, timeoutMs = IDLE_LOCK_MS): boolean {
  return now - state.lastActivityAt >= timeoutMs;
}

export function idleRemainingMs(state: IdleState, now: number, timeoutMs = IDLE_LOCK_MS): number {
  return Math.max(0, timeoutMs - (now - state.lastActivityAt));
}

/**
 * Vigilante con temporizador: `touch()` en cada gesto, `onIdle` cuando vence.
 * Inyectable para pruebas (setTimeout/clearTimeout/now).
 */
export function createIdleWatcher(opts: {
  timeoutMs?: number;
  onIdle: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}) {
  const timeoutMs = opts.timeoutMs ?? IDLE_LOCK_MS;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let state: IdleState = { lastActivityAt: now() };
  let timer: unknown;
  let stopped = false;

  const arm = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = setTimer(() => {
      timer = undefined;
      if (stopped) return;
      if (isIdle(state, now(), timeoutMs)) opts.onIdle();
      else arm();
    }, idleRemainingMs(state, now(), timeoutMs) || 1);
  };

  arm();
  return {
    touch() { if (stopped) return; state = touch(state, now()); if (timer === undefined) arm(); },
    stop() { stopped = true; if (timer !== undefined) clearTimer(timer); timer = undefined; },
    state: () => state
  };
}
