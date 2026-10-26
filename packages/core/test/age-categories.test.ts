import { describe, expect, it } from 'vitest';
import { ageOn, categoryForAge, isIsoDate, isMinor, remainingCapacity, validateCategory } from '../src/age-categories.js';
import { DEFAULT_AGE_CATEGORIES } from '../src/default-config.js';

const EVENT = '2026-11-20';

describe('isIsoDate / ageOn', () => {
  it('valida fechas reales', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('20/11/2026')).toBe(false);
  });

  it('calcula la edad al día del evento', () => {
    expect(ageOn('2008-11-20', EVENT)).toBe(18); // cumple ese día
    expect(ageOn('2008-11-21', EVENT)).toBe(17); // cumple al día siguiente
    expect(ageOn('2020-01-15', EVENT)).toBe(6);
    expect(() => ageOn('x', EVENT)).toThrow();
    expect(() => ageOn('2008-11-20', 'x')).toThrow();
  });

  it('isMinor', () => {
    expect(isMinor('2010-05-01', EVENT)).toBe(true);
    expect(isMinor('2000-05-01', EVENT)).toBe(false);
  });
});

describe('categorías', () => {
  it('categoryForAge cubre todos los rangos', () => {
    expect(categoryForAge(6, DEFAULT_AGE_CATEGORIES)?.code).toBe('INF_A');
    expect(categoryForAge(13, DEFAULT_AGE_CATEGORIES)?.code).toBe('INF_B');
    expect(categoryForAge(17, DEFAULT_AGE_CATEGORIES)?.code).toBe('JUV');
    expect(categoryForAge(35, DEFAULT_AGE_CATEGORIES)?.code).toBe('ADU');
    expect(categoryForAge(70, DEFAULT_AGE_CATEGORIES)?.code).toBe('SEN');
    expect(categoryForAge(4, DEFAULT_AGE_CATEGORIES)).toBeUndefined();
  });

  it('validateCategory OK', () => {
    const r = validateCategory({ birthDate: '2010-03-03', eventStartDate: EVENT, categoryCode: 'JUV', categories: DEFAULT_AGE_CATEGORIES });
    expect(r).toMatchObject({ ok: true, age: 16 });
  });

  it('bloquea si la edad no corresponde y sugiere la correcta', () => {
    const r = validateCategory({ birthDate: '2010-03-03', eventStartDate: EVENT, categoryCode: 'ADU', categories: DEFAULT_AGE_CATEGORIES });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('AGE_MISMATCH');
    expect(r.message).toContain('16 años');
    expect(r.message).toContain('Juvenil');
    expect(r.suggested?.code).toBe('JUV');
  });

  it('mensaje para categoría sin tope y edad sin categoría', () => {
    const r = validateCategory({ birthDate: '2023-01-01', eventStartDate: EVENT, categoryCode: 'SEN', categories: DEFAULT_AGE_CATEGORIES });
    if (r.ok) throw new Error();
    expect(r.message).toContain('36 años o más');
    expect(r.message).toContain('No hay una categoría');
  });

  it('errores de fecha y categoría', () => {
    expect(validateCategory({ birthDate: 'ayer', eventStartDate: EVENT, categoryCode: 'JUV', categories: DEFAULT_AGE_CATEGORIES })).toMatchObject({ ok: false, reason: 'INVALID_BIRTHDATE' });
    expect(validateCategory({ birthDate: '2010-01-01', eventStartDate: EVENT, categoryCode: 'NOPE', categories: DEFAULT_AGE_CATEGORIES })).toMatchObject({ ok: false, reason: 'UNKNOWN_CATEGORY' });
  });

  it('cupo lleno por categoría', () => {
    const cats = DEFAULT_AGE_CATEGORIES.map((c) => (c.code === 'JUV' ? { ...c, capacity: 2 } : c));
    const full = validateCategory({ birthDate: '2010-01-01', eventStartDate: EVENT, categoryCode: 'JUV', categories: cats, usedByCategory: { JUV: 2 } });
    expect(full).toMatchObject({ ok: false, reason: 'CAPACITY_FULL' });
    const ok = validateCategory({ birthDate: '2010-01-01', eventStartDate: EVENT, categoryCode: 'JUV', categories: cats, usedByCategory: { JUV: 1 } });
    expect(ok.ok).toBe(true);
  });

  it('remainingCapacity', () => {
    expect(remainingCapacity(null, 5)).toBe(Number.POSITIVE_INFINITY);
    expect(remainingCapacity(10, 4)).toBe(6);
    expect(remainingCapacity(10, 14)).toBe(0);
  });
});
