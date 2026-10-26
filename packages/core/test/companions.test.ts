import { describe, expect, it } from 'vitest';
import { companionsCounterLabel, remainingCompanionsForParticipant, remainingCompanionsTotal, remainingEventCapacity, remainingFor, validateCompanions } from '../src/companions.js';
import { createDefaultConfig, DEFAULT_ROLES } from '../src/default-config.js';

const cfg = (companions: { perParticipant: number | null; total: number | null }, totalCapacity: number | null) => ({ companions, totalCapacity });

describe('remaining*', () => {
  it('Infinity cuando el límite es null, nunca negativo', () => {
    expect(remainingFor(null, 99)).toBe(Infinity);
    expect(remainingFor(2, 1)).toBe(1);
    expect(remainingFor(2, 5)).toBe(0);
    expect(remainingCompanionsForParticipant(cfg({ perParticipant: null, total: 10 }, 20), 3)).toBe(Infinity);
    expect(remainingCompanionsTotal(cfg({ perParticipant: 2, total: null }, 20), 3)).toBe(Infinity);
    expect(remainingEventCapacity(cfg({ perParticipant: 2, total: null }, null), 3)).toBe(Infinity);
    expect(remainingEventCapacity(createDefaultConfig(), 1990)).toBe(10);
  });
});

describe('validateCompanions', () => {
  it('config por defecto: 2 por participante, aforo 2000 y rol ACOMP existe', () => {
    const c = createDefaultConfig();
    expect(c.companions).toEqual({ perParticipant: 2, total: null });
    expect(c.totalCapacity).toBe(2000);
    expect(DEFAULT_ROLES.find((r) => r.code === 'ACOMP')).toMatchObject({ zones: ['G'], allowsDigital: true, capacity: null });
  });

  it('permite hasta el límite por participante y rechaza el siguiente con mensaje humano', () => {
    const config = cfg({ perParticipant: 2, total: null }, null);
    expect(validateCompanions({ participantCompanionsCount: 0, adding: 2, config })).toMatchObject({ ok: true, remainingForParticipant: 0 });
    const r = validateCompanions({ participantCompanionsCount: 2, adding: 1, config });
    expect(r).toMatchObject({ ok: false, reason: 'PER_PARTICIPANT_LIMIT', allowed: 0 });
    if (!r.ok) expect(r.message).toBe('Este participante ya tiene 2 acompañantes, el máximo permitido.');
    const r2 = validateCompanions({ participantCompanionsCount: 1, adding: 2, config });
    if (r2.ok) throw new Error();
    expect(r2.message).toContain('solo puedes agregar 1 más');
    expect(r2.allowed).toBe(1);
  });

  it('sin límite por participante', () => {
    const r = validateCompanions({ participantCompanionsCount: 50, adding: 10, config: cfg({ perParticipant: null, total: null }, null) });
    expect(r).toMatchObject({ ok: true, remainingForParticipant: Infinity, remainingTotal: Infinity, remainingEvent: Infinity });
  });

  it('cupo total de acompañantes', () => {
    const config = cfg({ perParticipant: null, total: 100 }, null);
    expect(validateCompanions({ participantCompanionsCount: 0, adding: 1, config, usedCompanionsTotal: 99 }).ok).toBe(true);
    const r = validateCompanions({ participantCompanionsCount: 0, adding: 1, config, usedCompanionsTotal: 100 });
    expect(r).toMatchObject({ ok: false, reason: 'TOTAL_LIMIT', allowed: 0 });
    if (!r.ok) expect(r.message).toBe('Se llenó el cupo de acompañantes del evento.');
    const r2 = validateCompanions({ participantCompanionsCount: 0, adding: 3, config, usedCompanionsTotal: 98 });
    if (r2.ok) throw new Error();
    expect(r2.message).toContain('Solo quedan 2 cupos');
  });

  it('aforo total del evento', () => {
    const config = cfg({ perParticipant: null, total: null }, 2000);
    expect(validateCompanions({ participantCompanionsCount: 0, adding: 1, config, usedTotalEvent: 1999 }).ok).toBe(true);
    const r = validateCompanions({ participantCompanionsCount: 0, adding: 1, config, usedTotalEvent: 2000 });
    expect(r).toMatchObject({ ok: false, reason: 'EVENT_CAPACITY', allowed: 0 });
    if (!r.ok) expect(r.message).toBe('El evento llegó a su aforo total.');
    const r2 = validateCompanions({ participantCompanionsCount: 0, adding: 2, config, usedTotalEvent: 1999 });
    if (r2.ok) throw new Error();
    expect(r2.message).toContain('solo quedan 1 lugar');
  });

  it('orden de evaluación: participante antes que total antes que aforo', () => {
    const config = cfg({ perParticipant: 1, total: 0 }, 0);
    expect(validateCompanions({ participantCompanionsCount: 1, adding: 1, config }).ok === false && validateCompanions({ participantCompanionsCount: 1, adding: 1, config })).toMatchObject({ reason: 'PER_PARTICIPANT_LIMIT' });
    expect(validateCompanions({ participantCompanionsCount: 0, adding: 1, config })).toMatchObject({ reason: 'TOTAL_LIMIT' });
    expect(validateCompanions({ participantCompanionsCount: 0, adding: 1, config: cfg({ perParticipant: 1, total: null }, 0) })).toMatchObject({ reason: 'EVENT_CAPACITY' });
    expect(validateCompanions({ participantCompanionsCount: 0, adding: 0, config })).toMatchObject({ ok: true });
    expect(() => validateCompanions({ participantCompanionsCount: 0, adding: -1, config })).toThrow();
  });

  it('etiqueta del contador', () => {
    expect(companionsCounterLabel(1, 2)).toBe('1 de 2');
    expect(companionsCounterLabel(3, null)).toBe('3 · sin límite');
  });
});
