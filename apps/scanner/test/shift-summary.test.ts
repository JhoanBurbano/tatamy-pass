/**
 * Resumen de turno (§6): ingresos, salidas, denegados por motivo, alertas,
 * manuales y excepciones; los eventos de dispositivo no cuentan como escaneos.
 */
import { describe, expect, it } from 'vitest';
import { buildDeviceEvent, type ScanEvent } from '@tatami/core';
import { summarizeShift, totalsOf } from '../src/lib/shift.js';

const T0 = Date.parse('2026-11-20T13:00:00.000Z');
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
function ev(seq: number, p: Partial<ScanEvent> & { synced?: 0 | 1 }): ScanEvent & { synced?: 0 | 1 } {
  return { id: `d1:${seq}`, deviceId: 'd1', seq, credentialId: `TP-2026-0000${seq}-X`, zone: 'T', direction: 'IN', decision: 'ALLOW', reasonCode: 'OK', at: at(seq), synced: 1, ...p };
}

describe('resumen de turno', () => {
  it('cuenta por tipo y por motivo de rechazo', () => {
    const scans = [
      ev(1, {}), ev(2, { reasonCode: 'OK_PHOTO_CHECK' }),
      ev(3, { direction: 'OUT', reasonCode: 'OK_EXIT' }),
      ev(4, { decision: 'DENY', reasonCode: 'ANTI_PASSBACK' }), ev(5, { decision: 'DENY', reasonCode: 'ANTI_PASSBACK', synced: 0 }), ev(6, { decision: 'DENY', reasonCode: 'ZONE_NOT_ALLOWED' }),
      ev(7, { decision: 'ALERT', reasonCode: 'DUPLICATE' }),
      ev(8, { reasonCode: 'OK', manual: { type: 'manual_entry', reasonCode: 'QR_UNREADABLE', reason: 'QR no se lee', by: 'Ana' } as ScanEvent['manual'] }),
      ev(9, { reasonCode: 'OK_MANUAL', manual: { type: 'exception', reasonCode: 'GATE_ERROR', reason: 'Error de puerta', by: 'Ana', authorizedBy: 'super', overrides: 'ANTI_PASSBACK' } as ScanEvent['manual'], synced: 0 }),
      { ...buildDeviceEvent({ deviceId: 'd1', seq: 10, zone: 'T', at: at(10), meta: { type: 'zone_change', reason: 'x', by: 'Ana', authorizedBy: 'super', from: 'G', to: 'T' } }), synced: 0 as const },
      ev(11, { deviceId: 'otro', id: 'otro:11' })
    ];
    const s = summarizeShift(scans, { deviceId: 'd1', startedAt: T0, now: T0 + 3600_000 });
    expect(s.scans).toBe(9);
    expect(s.entries).toBe(4); // 1, 2, 8, 9
    expect(s.exits).toBe(1);
    expect(s.denied).toBe(3);
    expect(s.deniedByReason).toEqual({ ANTI_PASSBACK: 2, ZONE_NOT_ALLOWED: 1 });
    expect(s.alerts).toBe(1);
    expect(s.manual).toBe(1);
    expect(s.exceptions).toBe(1);
    expect(s.pending).toBe(3);
    expect(s.deviceEvents).toBe(1);
    expect(totalsOf(s)).toEqual({ scans: 9, entries: 4, exits: 1, denied: 3, deniedByReason: { ANTI_PASSBACK: 2, ZONE_NOT_ALLOWED: 1 }, alerts: 1, manual: 1, exceptions: 1, pending: 3 });
  });
  it('ignora lo anterior al inicio del turno', () => {
    const s = summarizeShift([ev(1, { at: at(-30) }), ev(2, {})], { deviceId: 'd1', startedAt: T0, now: T0 + 1000 * 60 * 5 });
    expect(s.scans).toBe(1);
  });
});
