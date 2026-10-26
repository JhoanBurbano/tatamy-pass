import { describe, expect, it } from 'vitest';
import { MAX_PIN_ATTEMPTS, PIN_LOCK_MS, attemptPin, formatCountdown, initialPinLock, isLocked, loadPinLock, savePinLock, type PinLockState } from '../src/lib/pin-lock.js';

const T0 = 1_700_000_000_000;

describe('bloqueo de PIN (TC-074)', () => {
  it('cuenta intentos y avisa cuántos quedan', () => {
    let s: PinLockState = initialPinLock;
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      const r = attemptPin(s, false, T0 + i);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error();
      expect(r.locked).toBe(false);
      expect(r.remainingAttempts).toBe(MAX_PIN_ATTEMPTS - i);
      expect(r.message).toMatch(/PIN incorrecto\. Te queda/);
      s = r.state;
    }
    expect(s.fails).toBe(4);
    expect(attemptPin({ fails: 3, lockedUntil: null }, false, T0).message).toBe('PIN incorrecto. Te queda 1 intento.');
  });

  it('el quinto incorrecto bloquea 15 minutos', () => {
    let s: PinLockState = { fails: 4, lockedUntil: null };
    const r = attemptPin(s, false, T0);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error();
    expect(r.locked).toBe(true);
    expect(r.state.lockedUntil).toBe(T0 + PIN_LOCK_MS);
    expect(r.message).toContain('15:00');
    s = r.state;
    expect(isLocked(s, T0 + 1)).toBe(true);
    expect(isLocked(s, T0 + PIN_LOCK_MS)).toBe(false);
  });

  it('durante el bloqueo rechaza incluso el PIN correcto sin reiniciar el contador', () => {
    const locked: PinLockState = { fails: 5, lockedUntil: T0 + PIN_LOCK_MS };
    const r = attemptPin(locked, true, T0 + 60_000);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error();
    expect(r.locked).toBe(true);
    expect(r.state).toEqual(locked);
    expect(r.message).toContain('14:00');
  });

  it('al vencer el bloqueo el PIN correcto entra y limpia el estado', () => {
    const locked: PinLockState = { fails: 5, lockedUntil: T0 + PIN_LOCK_MS };
    const r = attemptPin(locked, true, T0 + PIN_LOCK_MS + 1);
    expect(r.ok).toBe(true);
    expect(r.state).toEqual(initialPinLock);
  });

  it('al vencer el bloqueo un PIN incorrecto empieza de cero', () => {
    const locked: PinLockState = { fails: 5, lockedUntil: T0 + PIN_LOCK_MS };
    const r = attemptPin(locked, false, T0 + PIN_LOCK_MS + 1);
    expect(r.state.fails).toBe(1);
    expect(r.state.lockedUntil).toBeNull();
  });

  it('un acierto reinicia los fallos', () => {
    const r = attemptPin({ fails: 3, lockedUntil: null }, true, T0);
    expect(r.ok).toBe(true);
    expect(r.state.fails).toBe(0);
  });

  it('formatea la cuenta regresiva', () => {
    expect(formatCountdown(PIN_LOCK_MS)).toBe('15:00');
    expect(formatCountdown(61_000)).toBe('01:01');
    expect(formatCountdown(0)).toBe('00:00');
  });

  it('persiste y recupera el estado (y tolera basura)', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    savePinLock({ fails: 2, lockedUntil: null }, storage);
    expect(loadPinLock(storage)).toEqual({ fails: 2, lockedUntil: null });
    store.set('tp.pinLock', '{nope');
    expect(loadPinLock(storage)).toEqual(initialPinLock);
    expect(loadPinLock({ getItem: () => null })).toEqual(initialPinLock);
  });
});
