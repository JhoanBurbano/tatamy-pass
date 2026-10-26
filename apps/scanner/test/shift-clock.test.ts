import { describe, expect, it } from 'vitest';
import type { ScanEvent } from '@tatami/core';
import { SESSION_MS, sessionActive, sessionRemainingMs, summarizeShift } from '../src/lib/shift.js';
import { clockOutOfSync, describeSkew, estimateSkewMs } from '../src/lib/clock.js';

const T0 = Date.parse('2026-11-20T13:00:00.000Z');

function ev(seq: number, at: number, patch: Partial<ScanEvent> = {}): ScanEvent & { synced?: 0 | 1 } {
  return { id: `dev:${seq}`, deviceId: 'dev', seq, credentialId: 'TP-2026-00001-X', zone: 'T', direction: 'IN', decision: 'ALLOW', reasonCode: 'OK', at: new Date(at).toISOString(), ...patch };
}

describe('sesión de 12 h', () => {
  it('activa dentro de 12 h, vencida después', () => {
    const s = { unlockedAt: T0, shiftStartedAt: T0 };
    expect(sessionActive(s, T0 + SESSION_MS - 1)).toBe(true);
    expect(sessionActive(s, T0 + SESSION_MS)).toBe(false);
    expect(sessionActive(undefined, T0)).toBe(false);
    expect(sessionRemainingMs(s, T0 + 3600_000)).toBe(SESSION_MS - 3600_000);
    expect(sessionRemainingMs(undefined, T0)).toBe(0);
  });
});

describe('resumen de turno', () => {
  it('cuenta escaneos, manuales y pendientes solo del dispositivo y del turno', () => {
    const scans = [
      ev(1, T0 + 1000, { synced: 1 }),
      ev(2, T0 + 2000, { decision: 'DENY', reasonCode: 'ANTI_PASSBACK', synced: 1 }),
      ev(3, T0 + 3000, { direction: 'OUT', reasonCode: 'OK_EXIT', synced: 0 }),
      ev(4, T0 + 4000, { reasonCode: 'OK_MANUAL', manual: { reason: 'credencial dañada', by: 'Puerta 1' }, synced: 0 }),
      ev(5, T0 + 5000, { decision: 'ALERT', reasonCode: 'DUPLICATE', synced: 1 }),
      ev(6, T0 - 5000, { synced: 1 }), // antes del turno
      { ...ev(7, T0 + 6000), deviceId: 'otro', id: 'otro:7' } // otra puerta
    ];
    const s = summarizeShift(scans, { deviceId: 'dev', startedAt: T0, now: T0 + 10_000 });
    expect(s.scans).toBe(5);
    expect(s.allowed).toBe(3);
    expect(s.denied).toBe(1);
    expect(s.alerts).toBe(1);
    expect(s.manual).toBe(1);
    expect(s.exits).toBe(1);
    expect(s.pending).toBe(2);
    expect(s.byReason).toEqual({ OK: 1, ANTI_PASSBACK: 1, OK_EXIT: 1, OK_MANUAL: 1, DUPLICATE: 1 });
  });
});

describe('reloj desincronizado', () => {
  it('estima la deriva compensando el viaje de red', () => {
    const serverIso = new Date(T0 + 7 * 60_000).toISOString();
    expect(estimateSkewMs(serverIso, T0, T0 + 200)).toBe(7 * 60_000 - 100);
    expect(estimateSkewMs('no-es-fecha', T0, T0)).toBe(0);
  });

  it('avisa solo por encima de 5 minutos', () => {
    expect(clockOutOfSync(4 * 60_000)).toBe(false);
    expect(clockOutOfSync(-4 * 60_000)).toBe(false);
    expect(clockOutOfSync(6 * 60_000)).toBe(true);
    expect(clockOutOfSync(-6 * 60_000)).toBe(true);
    expect(clockOutOfSync(undefined)).toBe(false);
    expect(describeSkew(6 * 60_000)).toContain('atrasado 6 min');
    expect(describeSkew(-7 * 60_000)).toContain('adelantado 7 min');
  });
});
