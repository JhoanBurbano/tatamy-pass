import { describe, expect, it } from 'vitest';
import { capacityWarnings, validateEventConfig } from '../src/config-validation.js';
import { createDefaultConfig } from '../src/default-config.js';

describe('validateEventConfig', () => {
  it('la config por defecto es válida', () => {
    expect(validateEventConfig(createDefaultConfig())).toEqual([]);
  });

  it('rechaza lo que no es un objeto', () => {
    expect(validateEventConfig(null)[0].message).toMatch(/objeto/);
    expect(validateEventConfig('x')).toHaveLength(1);
  });

  it('detecta fechas, prefijo y desfase inválidos', () => {
    const c = createDefaultConfig({ startDate: '2026-11-22', endDate: '2026-11-20', idPrefix: 'tp 2026', utcOffsetMinutes: 1.5 });
    const paths = validateEventConfig(c).map((e) => e.path);
    expect(paths).toContain('endDate');
    expect(paths).toContain('idPrefix');
    expect(paths).toContain('utcOffsetMinutes');
  });

  it('roles: código repetido, zona inexistente, color y cupo', () => {
    const c = createDefaultConfig();
    c.roles.push({ ...c.roles[0], code: 'GEN' });
    c.roles[1].zones = ['G', 'ZZ'];
    c.roles[2].color = 'azul';
    c.roles[3].capacity = -1;
    c.roles[4].days = ['2026-12-01'];
    const errs = validateEventConfig(c);
    expect(errs.find((e) => e.path === `roles[${c.roles.length - 1}].code`)?.message).toMatch(/repetido/);
    expect(errs.find((e) => e.path === 'roles[1].zones')?.message).toMatch(/ZZ no existe/);
    expect(errs.find((e) => e.path === 'roles[2].color')).toBeTruthy();
    expect(errs.find((e) => e.path === 'roles[3].capacity')).toBeTruthy();
    expect(errs.find((e) => e.path === 'roles[4].days')?.message).toMatch(/fuera del evento/);
  });

  it('categorías: solape y edades', () => {
    const c = createDefaultConfig();
    c.ageCategories[1].minAge = 9; // solapa con Infantil A (6–9)
    const errs = validateEventConfig(c);
    expect(errs.find((e) => e.path === 'ageCategories')?.message).toMatch(/solapan/);
    c.ageCategories[1].minAge = 10;
    c.ageCategories[1].maxAge = 5;
    expect(validateEventConfig(c).some((e) => e.path === 'ageCategories[1].maxAge')).toBe(true);
  });

  it('acompañantes y aforo admiten null (sin límite) pero no negativos', () => {
    const ok = createDefaultConfig({ companions: { perParticipant: null, total: null }, totalCapacity: null });
    expect(validateEventConfig(ok)).toEqual([]);
    const bad = createDefaultConfig({ companions: { perParticipant: 2, total: -3 }, totalCapacity: 1.5 });
    const paths = validateEventConfig(bad).map((e) => e.path);
    expect(paths).toContain('companions.total');
    expect(paths).toContain('totalCapacity');
  });

  it('zonas: al menos una, código y nombre', () => {
    const c = createDefaultConfig();
    c.zones = [];
    expect(validateEventConfig(c).some((e) => e.path === 'zones')).toBe(true);
    c.zones = [{ code: 'g', name: '', tracksExit: true }];
    const paths = validateEventConfig(c).map((e) => e.path);
    expect(paths).toContain('zones[0].code');
    expect(paths).toContain('zones[0].name');
  });
});

describe('capacityWarnings', () => {
  it('avisa cuando el cupo queda por debajo de lo emitido', () => {
    const c = createDefaultConfig();
    c.roles[0].capacity = 10;
    const w = capacityWarnings(c, { GEN: 12, COMP: 5 });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/12 credenciales emitidas para General/);
    expect(capacityWarnings(c, { GEN: 10 })).toEqual([]);
  });
});
