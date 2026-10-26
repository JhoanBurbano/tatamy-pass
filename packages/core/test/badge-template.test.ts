import { describe, expect, it } from 'vitest';
import {
  accessText, badgeTextsFromConfig, defaultBadgeTemplate, displayCredentialId, eventDateLine, filterPersonForBadge, resolveBadgeFields, roleBandStyle, validateBadgeTemplate, type BadgeTemplate
} from '../src/badge-template.js';
import { createDefaultConfig, resolveZones } from '../src/default-config.js';
import { formatCredentialId } from '../src/credential-id.js';
import type { Credential, Person } from '../src/types.js';

const config = createDefaultConfig({ startDate: '2026-11-14', endDate: '2026-11-16' });
const cred: Credential = {
  id: formatCredentialId('TP-2026', 428), seq: 428, eventId: 'nac2026', personId: 'p1', displayName: 'Jhoan Pérez', club: 'Academia Gran Maestro', roleCode: 'COMP',
  zones: resolveZones(['G', 'W', 'T', 'P'], config), validFrom: config.startDate, validTo: config.endDate, version: 1, status: 'ISSUED', kid: 'k1', categoryCode: 'ADU',
  issuedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z'
};
const person: Person = {
  id: 'p1', firstName: 'Jhoan', lastName: 'Pérez', birthDate: '2000-01-01', documentNumber: '1061234567', club: 'Academia Gran Maestro', delegation: 'Bogotá D.C. - Cundinamarca',
  emergencyContact: { name: 'María Pérez', phone: '+57 310 234 5678' }, eps: { name: 'EPS Sura', regime: 'Contributivo' }, source: 'seed'
};

describe('defaultBadgeTemplate', () => {
  it('es válida, serializable y referencia solo assets que existen', () => {
    const t = defaultBadgeTemplate();
    expect(validateBadgeTemplate(t)).toEqual([]);
    const round = JSON.parse(JSON.stringify(t)) as BadgeTemplate;
    expect(round).toEqual(t);
    for (const id of [...t.front.footer.logos, ...t.back.sponsors.logos, ...t.back.footer.logos, t.header.skylineAsset!]) expect(t.assets[id]).toBeDefined();
    expect(t.size).toEqual({ widthMm: 100, heightMm: 150 });
    expect(t.back.infoBox.items).toHaveLength(5);
    expect(t.privacy).toEqual({ printDocument: true, printEps: true, printEmergency: true });
  });
});

describe('validateBadgeTemplate', () => {
  it('rechaza lo que no es un objeto', () => {
    expect(validateBadgeTemplate(null)[0].message).toMatch(/objeto JSON/);
    expect(validateBadgeTemplate('x')).toHaveLength(1);
  });

  it('explica cada error con un mensaje humano', () => {
    const t = defaultBadgeTemplate();
    t.colors.primary = 'azul';
    t.front.qr.sizeMm = 10;
    t.front.footer.logos.push('no-existe');
    t.front.fields.push({ ...t.front.fields[0] });
    t.back.infoBox.items[0].text = '';
    t.credentialDisplay.prefix = 'cn itf';
    t.header.skylineAsset = 'nada';
    t.background.opacity = 2;
    (t.back.infoBox.items[1] as { icon: string }).icon = 'unicornio';
    const errors = validateBadgeTemplate(t);
    const paths = errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['colors.primary', 'front.qr.sizeMm', 'front.footer.logos[4]', 'front.fields[4].key', 'back.infoBox.items[0].text', 'credentialDisplay.prefix', 'header.skylineAsset', 'background.opacity', 'back.infoBox.items[1].icon']));
    expect(errors.find((e) => e.path === 'front.qr.sizeMm')!.message).toMatch(/scanners fallan/);
    expect(errors.find((e) => e.path === 'front.footer.logos[4]')!.message).toMatch(/no existe/);
  });

  it('limita assets a 1 MB y valida mime e id', () => {
    const t = defaultBadgeTemplate();
    t.assets['Logo Grande'] = { name: 'x', mime: 'image/png', dataBase64: 'a'.repeat(1_500_000) };
    (t.assets['raro'] as { mime: string }) = { name: 'x', mime: 'image/gif', dataBase64: '' } as never;
    const errors = validateBadgeTemplate(t);
    expect(errors.some((e) => e.path === 'assets.Logo Grande' )).toBe(true);
    expect(errors.some((e) => e.path === 'assets.Logo Grande.dataBase64' && /1 MB/.test(e.message))).toBe(true);
    expect(errors.some((e) => e.path === 'assets.raro.mime')).toBe(true);
    expect(errors.some((e) => e.path === 'assets.raro.dataBase64')).toBe(true);
  });

  it('secciones faltantes', () => {
    const errors = validateBadgeTemplate({ id: 'x', version: 2 });
    expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining(['id', 'name', 'version', 'size', 'colors', 'fonts', 'header', 'background', 'credentialDisplay', 'front', 'back', 'assets', 'privacy']));
    const partial = validateBadgeTemplate({ ...defaultBadgeTemplate(), front: { fields: 'x', photo: {}, roleBand: 1, access: {}, accreditation: {}, qr: {}, footer: {} }, back: { infoBox: {}, sponsors: {}, barcode: { symbology: 'ean' }, footer: {} }, privacy: { printDocument: 'sí' } });
    expect(partial.map((e) => e.path)).toEqual(expect.arrayContaining(['front.fields', 'front.photo', 'front.roleBand', 'front.access', 'front.accreditation', 'front.qr.sizeMm', 'front.footer.logos', 'back.infoBox', 'back.sponsors', 'back.barcode', 'back.footer.logos', 'privacy.printDocument']));
    const tooMany = defaultBadgeTemplate();
    tooMany.front.fields = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, label: 'L', source: 'custom' as const, labelColor: 'primary', visible: true }));
    tooMany.back.infoBox.items = Array.from({ length: 9 }, () => ({ icon: 'info' as const, text: 'x' }));
    tooMany.front.footer.logos = Array(7).fill('logo-itf');
    tooMany.back.sponsors.logos = Array(7).fill('logo-itf');
    expect(validateBadgeTemplate(tooMany).map((e) => e.path)).toEqual(expect.arrayContaining(['front.fields', 'back.infoBox.items', 'front.footer.logos', 'back.sponsors.logos']));
    const bad = defaultBadgeTemplate();
    bad.front.fields[0].labelColor = 'rojo';
    (bad.front.fields[1] as { source: string }).source = 'otra';
    (bad.front.fields[2] as { key: unknown }).key = '';
    (bad.front.roleBand.icons as Record<string, string>).COMP = 'x';
    bad.back.infoBox.items[0].text = 'x'.repeat(200);
    bad.background.imageAsset = 'nope';
    expect(validateBadgeTemplate(bad).map((e) => e.path)).toEqual(expect.arrayContaining(['front.fields[0].labelColor', 'front.fields[1].source', 'front.fields[2].key', 'front.roleBand.icons.COMP', 'back.infoBox.items[0].text', 'background.imageAsset']));
  });
});

describe('textos desde la config', () => {
  it('eventDateLine en español y mayúsculas', () => {
    expect(eventDateLine('2026-11-14', '2026-11-16')).toBe('14 AL 16 DE NOVIEMBRE DE 2026');
    expect(eventDateLine('2026-11-14', '2026-11-14')).toBe('14 DE NOVIEMBRE DE 2026');
    expect(eventDateLine('2026-10-30', '2026-11-02')).toBe('30 DE OCTUBRE AL 2 DE NOVIEMBRE DE 2026');
    expect(eventDateLine('2026-12-30', '2027-01-02')).toBe('30 DE DICIEMBRE DE 2026 AL 2 DE ENERO DE 2027');
    expect(eventDateLine('x', 'y')).toBe('');
    expect(eventDateLine('2026-11-14', 'y')).toBe('14 DE NOVIEMBRE DE 2026');
  });

  it('badgeTextsFromConfig respeta lo escrito y calcula lo vacío', () => {
    const t = defaultBadgeTemplate();
    expect(badgeTextsFromConfig(t, config)).toMatchObject({ year: '2026', dateLine: '14 AL 16 DE NOVIEMBRE DE 2026', city: 'POPAYÁN', badgeNumber: '21' });
    t.header.dateLine = 'FECHA FIJA'; t.header.year = '2027';
    expect(badgeTextsFromConfig(t, config)).toMatchObject({ year: '2027', dateLine: 'FECHA FIJA' });
  });

  it('displayCredentialId cambia el prefijo y conserva secuencial y verificador', () => {
    expect(displayCredentialId('TP-2026-00428-' + cred.id.slice(-1), 'CNITF2026')).toBe(`CNITF2026-00428-${cred.id.slice(-1)}`);
    expect(displayCredentialId(cred.id, null)).toBe(cred.id);
    expect(displayCredentialId('raro', 'X')).toBe('raro');
  });

  it('accessText: fijo, zonas por nombre o todas', () => {
    const t = defaultBadgeTemplate();
    expect(accessText(t, cred, config)).toBe('Gradería · Área de calentamiento · Tatamis · Pesaje');
    expect(accessText(t, { zones: ['*'] }, config)).toBe('Todas las zonas');
    t.front.access.text = 'Área de competencia';
    expect(accessText(t, cred, config)).toBe('Área de competencia');
  });

  it('resolveBadgeFields y privacidad', () => {
    const t = defaultBadgeTemplate();
    const fields = resolveBadgeFields(t, cred, filterPersonForBadge(t, person), config);
    expect(fields.map((f) => f.value)).toEqual(['Jhoan Pérez', '1061234567', 'Academia Gran Maestro', 'Bogotá D.C. - Cundinamarca']);
    expect(fields[3].labelColor).toBe(t.colors.accent);
    t.privacy.printDocument = false;
    const p2 = filterPersonForBadge(t, person)!;
    expect(p2.documentNumber).toBeUndefined();
    expect(resolveBadgeFields(t, cred, p2, config)[1].value).toBe('');
    t.privacy.printEps = false; t.privacy.printEmergency = false;
    expect(filterPersonForBadge(t, person)).toEqual({ documentNumber: undefined, delegation: person.delegation, emergencyContact: undefined, eps: undefined });
    expect(filterPersonForBadge(t, undefined)).toBeUndefined();
    t.front.fields = [
      { key: 'cat', label: 'CATEGORÍA', source: 'credential.category', labelColor: '#123456', visible: true },
      { key: 'role', label: 'ROL', source: 'credential.role', labelColor: 'primary', visible: true },
      { key: 'fixed', label: 'SEDE', source: 'custom', customText: 'Coliseo La Estancia', labelColor: 'primary', visible: true },
      { key: 'hidden', label: 'X', source: 'custom', labelColor: 'primary', visible: false }
    ];
    const f2 = resolveBadgeFields(t, cred, undefined, config);
    expect(f2.map((f) => f.value)).toEqual(['Adulto', 'Competidor', 'Coliseo La Estancia']);
    expect(f2[0].labelColor).toBe('#123456');
    expect(resolveBadgeFields(t, { ...cred, categoryCode: 'ZZ' }, undefined, config)[0].value).toBe('ZZ');
  });

  it('roleBandStyle: COMP en rosa por defecto, otros con su color, desconocido con icono genérico', () => {
    const t = defaultBadgeTemplate();
    expect(roleBandStyle(t, 'COMP', config)).toEqual({ color: t.colors.roleBandDefault, icon: 'kick', name: 'COMPETIDOR' });
    expect(roleBandStyle(t, 'COACH', config)).toMatchObject({ color: '#0E7490', icon: 'whistle' });
    expect(roleBandStyle(t, 'NOPE', config)).toEqual({ color: t.colors.roleBandDefault, icon: 'id-card', name: 'NOPE' });
    t.front.roleBand.useRoleColor = false;
    expect(roleBandStyle(t, 'COACH', config).color).toBe(t.colors.roleBandDefault);
  });
});
