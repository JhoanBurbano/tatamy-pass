/**
 * Bloqueo de pantalla con PIN tras 5 min sin uso (§8).
 */
import { describe, expect, it, vi } from 'vitest';
import { createIdleWatcher, IDLE_LOCK_MS, isIdle, touch } from '../src/lib/idle.js';

describe('inactividad', () => {
  it('5 minutos exactos', () => {
    expect(IDLE_LOCK_MS).toBe(5 * 60_000);
    const s = touch({ lastActivityAt: 0 }, 1000);
    expect(isIdle(s, 1000 + IDLE_LOCK_MS - 1)).toBe(false);
    expect(isIdle(s, 1000 + IDLE_LOCK_MS)).toBe(true);
  });
  it('el vigilante bloquea al vencer y se pospone con cada toque', () => {
    vi.useFakeTimers();
    try {
      const onIdle = vi.fn();
      const w = createIdleWatcher({ onIdle });
      vi.advanceTimersByTime(4 * 60_000);
      w.touch();
      vi.advanceTimersByTime(4 * 60_000);
      expect(onIdle).not.toHaveBeenCalled();
      vi.advanceTimersByTime(60_000 + 10);
      expect(onIdle).toHaveBeenCalledTimes(1);
      w.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
