/**
 * Configuración por defecto del evento `nac2026` (§5 de 00-DECISIONES).
 * El host la carga desde `event.config.json`; esto es el valor inicial.
 */
import type { AccessRole, AgeCategory, EventConfig, Zone } from './types.js';
import { createDefaultRadioConfig } from './radio.js';

export const DEFAULT_ZONES: Zone[] = [
  { code: 'G', name: 'Gradería', tracksExit: false },
  { code: 'W', name: 'Área de calentamiento', tracksExit: true },
  { code: 'T', name: 'Tatamis', tracksExit: true },
  { code: 'P', name: 'Pesaje', tracksExit: true },
  { code: 'J', name: 'Sala de jueces', tracksExit: true },
  { code: 'V', name: 'Palco', tracksExit: true },
  { code: 'H', name: 'Zona de hospitalidad', tracksExit: true },
  { code: 'S', name: 'Stands', tracksExit: false },
  { code: 'M', name: 'Zona de prensa', tracksExit: true }
];

export const DEFAULT_ROLES: AccessRole[] = [
  { code: 'GEN', name: 'General', zones: ['G'], days: null, capacity: 1500, requiresPhoto: false, color: '#64748B', allowsDigital: true, antiPassbackZones: [] },
  { code: 'COMP', name: 'Competidor', zones: ['G', 'W', 'T', 'P'], days: null, capacity: 1200, requiresPhoto: true, color: '#1C4FD1', allowsDigital: false, antiPassbackZones: ['W', 'T', 'P'] },
  { code: 'COACH', name: 'Coach / Entrenador', zones: ['G', 'W', 'T'], days: null, capacity: 300, requiresPhoto: true, color: '#0E7490', allowsDigital: false, antiPassbackZones: ['W', 'T'] },
  { code: 'JUR', name: 'Jurado / Árbitro', zones: ['G', 'W', 'T', 'J'], days: null, capacity: 80, requiresPhoto: true, color: '#0F172A', allowsDigital: false, antiPassbackZones: ['J'] },
  { code: 'VIP', name: 'VIP', zones: ['G', 'V', 'H'], days: null, capacity: 100, requiresPhoto: true, color: '#B45309', allowsDigital: false, antiPassbackZones: ['V'] },
  { code: 'SPON', name: 'Patrocinador', zones: ['G', 'H', 'S'], days: null, capacity: 60, requiresPhoto: true, color: '#7C3AED', allowsDigital: false, antiPassbackZones: [] },
  { code: 'PRESS', name: 'Prensa', zones: ['G', 'M', 'T'], days: null, capacity: 40, requiresPhoto: true, color: '#DB2777', allowsDigital: false, antiPassbackZones: ['M'] },
  { code: 'MED', name: 'Médico', zones: ['*'], days: null, capacity: 20, requiresPhoto: true, color: '#16A34A', allowsDigital: false, antiPassbackZones: [] },
  { code: 'STAFF', name: 'Staff / Organización', zones: ['*'], days: null, capacity: 150, requiresPhoto: true, color: '#E0323B', allowsDigital: false, antiPassbackZones: [] },
  { code: 'ACOMP', name: 'Acompañante', zones: ['G'], days: null, capacity: null, requiresPhoto: false, color: '#6B7F99', allowsDigital: true, antiPassbackZones: [] }
];

export const DEFAULT_AGE_CATEGORIES: AgeCategory[] = [
  { code: 'INF_A', name: 'Infantil A', minAge: 6, maxAge: 9, capacity: null },
  { code: 'INF_B', name: 'Infantil B', minAge: 10, maxAge: 13, capacity: null },
  { code: 'JUV', name: 'Juvenil', minAge: 14, maxAge: 17, capacity: null },
  { code: 'ADU', name: 'Adulto', minAge: 18, maxAge: 35, capacity: null },
  { code: 'SEN', name: 'Senior', minAge: 36, maxAge: null, capacity: null }
];

export function createDefaultConfig(overrides: Partial<EventConfig> = {}): EventConfig {
  return {
    eventId: 'nac2026',
    name: 'Campeonato Nacional de Taekwondo ITF 2026',
    idPrefix: 'TP-2026',
    startDate: '2026-11-20',
    endDate: '2026-11-22',
    utcOffsetMinutes: -300,
    zones: DEFAULT_ZONES.map((z) => ({ ...z })),
    roles: DEFAULT_ROLES.map((r) => ({ ...r, zones: [...r.zones], antiPassbackZones: [...r.antiPassbackZones] })),
    ageCategories: DEFAULT_AGE_CATEGORIES.map((c) => ({ ...c })),
    duplicateWindowSeconds: 120,
    digitalTokenWindowSeconds: 60,
    clockToleranceSeconds: 300,
    signingKeys: [],
    companions: { perParticipant: 2, total: null },
    totalCapacity: 2000,
    radio: createDefaultRadioConfig(),
    configVersion: 1,
    updatedAt: '2026-10-09T00:00:00.000Z',
    ...overrides
  };
}

/** Expande `['*']` a la lista real de zonas. */
export function resolveZones(zones: string[], config: EventConfig): string[] {
  if (zones.includes('*')) return config.zones.map((z) => z.code);
  return zones;
}

export function findRole(config: EventConfig, code: string): AccessRole | undefined {
  return config.roles.find((r) => r.code === code);
}
