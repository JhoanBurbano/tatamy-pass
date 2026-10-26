/**
 * PIN de supervisor sin host (§3): rol `super` enrolado en el mismo dispositivo
 * o PIN de supervisor del snapshot.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '@tatami/core';
import { hashPin, hasLocalSupervisorPin, verifySupervisorPinLocal } from '../src/lib/supervisor.js';

const control = { name: 'P1', role: 'CONTROL' as const, pinHash: hashPin('111111') };
const superDev = { name: 'SUP-1', role: 'SUPERVISOR' as const, pinHash: hashPin('222222') };

describe('PIN de supervisor local', () => {
  it('sin fuentes locales no autoriza y lo dice (hay que ir al host)', () => {
    expect(hasLocalSupervisorPin({ device: control, config: createDefaultConfig() })).toBe(false);
    const r = verifySupervisorPinLocal('111111', { device: control, config: createDefaultConfig() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.none).toBe(true);
  });
  it('el PIN del propio dispositivo vale si está enrolado como supervisor', () => {
    const r = verifySupervisorPinLocal('222222', { device: superDev, config: createDefaultConfig() });
    expect(r).toEqual({ ok: true, by: 'SUP-1', method: 'device' });
    const bad = verifySupervisorPinLocal('111111', { device: superDev });
    expect(bad.ok).toBe(false);
    if (!bad.ok) { expect(bad.none).toBe(false); expect(bad.error).toContain('incorrecto'); }
  });
  it('acepta los PIN de supervisor que vengan en el snapshot', () => {
    const config = { ...createDefaultConfig(), supervisorPins: [{ username: 'super', pinHash: hashPin('654321') }] };
    const r = verifySupervisorPinLocal('654321', { device: control, config });
    expect(r).toEqual({ ok: true, by: 'super', method: 'snapshot' });
    expect(verifySupervisorPinLocal('123456', { device: control, config }).ok).toBe(false);
    const single = { ...createDefaultConfig(), supervisorPinHash: hashPin('999999') };
    expect(verifySupervisorPinLocal('999999', { device: control, config: single })).toMatchObject({ ok: true, by: 'supervisor' });
  });
  it('rechaza formatos que no son 6 dígitos', () => {
    expect(verifySupervisorPinLocal('12', { device: superDev }).ok).toBe(false);
  });
});
