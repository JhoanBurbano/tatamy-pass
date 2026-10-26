import { createDefaultConfig, formatCredentialId, generateKeyPair, resolveZones } from '../src/index.js';
import type { Credential, EventConfig, KeyPair, ScanEvent } from '../src/index.js';

export const KEY: KeyPair = generateKeyPair('k1');
export const OTHER_KEY: KeyPair = generateKeyPair('k9');

export function makeConfig(overrides: Partial<EventConfig> = {}): EventConfig {
  return createDefaultConfig({ signingKeys: [{ kid: KEY.kid, publicKeyHex: KEY.publicKeyHex }], ...overrides });
}

export const CONFIG = makeConfig();

/** 2026-11-20 09:00 Colombia (UTC-5) = 14:00Z, primer día del evento. */
export const DAY1_9AM = Date.parse('2026-11-20T14:00:00.000Z');

export function makeCredential(seq: number, roleCode: string, overrides: Partial<Credential> = {}, config: EventConfig = CONFIG): Credential {
  const role = config.roles.find((r) => r.code === roleCode)!;
  return {
    id: formatCredentialId(config.idPrefix, seq),
    seq,
    eventId: config.eventId,
    personId: `p${seq}`,
    displayName: `Juan Pérez ${seq}`,
    club: 'Academia Caucana',
    roleCode,
    zones: resolveZones(role.zones, config),
    validFrom: config.startDate,
    validTo: config.endDate,
    version: 1,
    status: 'DELIVERED',
    kid: KEY.kid,
    issuedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  };
}

export function makeScan(partial: Partial<ScanEvent> & { deviceId: string; seq: number }): ScanEvent {
  return {
    id: `${partial.deviceId}:${partial.seq}`,
    credentialId: null,
    zone: 'G',
    direction: 'IN',
    decision: 'ALLOW',
    reasonCode: 'OK',
    at: new Date(DAY1_9AM).toISOString(),
    ...partial
  };
}
