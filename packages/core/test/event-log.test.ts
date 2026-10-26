import { describe, expect, it } from 'vitest';
import {
  appendEvents, createEventLog, eventKey, listEvents, mergeConfigLww, mergeRevocationsLww, missingFor, nextSeq, reconcile
} from '../src/event-log.js';
import type { RevocationEntry } from '../src/types.js';
import { CONFIG, makeConfig, makeScan } from './fixtures.js';

describe('event log', () => {
  it('append es idempotente por (deviceId, seq)', () => {
    const log = createEventLog();
    const e1 = makeScan({ deviceId: 'd1', seq: 1 });
    const r1 = appendEvents(log, [e1, e1, { ...e1, zone: 'T' }]);
    expect(r1.added).toHaveLength(1);
    expect(r1.duplicates).toBe(2);
    expect(log.events.get('d1:1')?.zone).toBe('G'); // gana el primero: append-only
    expect(nextSeq(log, 'd1')).toBe(2);
    expect(nextSeq(log, 'd2')).toBe(1);
  });

  it('rechaza ids inconsistentes', () => {
    const log = createEventLog();
    expect(() => appendEvents(log, [{ ...makeScan({ deviceId: 'd1', seq: 1 }), id: 'otro' }])).toThrow();
  });

  it('listEvents filtra por since/deviceId y ordena', () => {
    const log = createEventLog([
      makeScan({ deviceId: 'd2', seq: 1, at: '2026-11-20T14:02:00Z' }),
      makeScan({ deviceId: 'd1', seq: 2, at: '2026-11-20T14:01:00Z' }),
      makeScan({ deviceId: 'd1', seq: 1, at: '2026-11-20T14:00:00Z' })
    ]);
    expect(listEvents(log).map(eventKey)).toEqual(['d1:1', 'd1:2', 'd2:1']);
    expect(listEvents(log, { since: '2026-11-20T14:00:00Z' }).map(eventKey)).toEqual(['d1:2', 'd2:1']);
    expect(listEvents(log, { deviceId: 'd2' })).toHaveLength(1);
  });

  it('missingFor devuelve lo que el otro no tiene', () => {
    const log = createEventLog([makeScan({ deviceId: 'd1', seq: 1 }), makeScan({ deviceId: 'd1', seq: 2 }), makeScan({ deviceId: 'd3', seq: 1 })]);
    const missing = missingFor(log, new Map([['d1', 1]]));
    expect(missing.map(eventKey)).toEqual(['d1:2', 'd3:1']);
  });
});

describe('LWW', () => {
  it('config: gana la versión mayor, luego updatedAt', () => {
    const a = makeConfig({ configVersion: 2, updatedAt: '2026-01-01T00:00:00Z', name: 'A' });
    const b = makeConfig({ configVersion: 3, updatedAt: '2025-01-01T00:00:00Z', name: 'B' });
    expect(mergeConfigLww(a, b).name).toBe('B');
    const c = makeConfig({ configVersion: 3, updatedAt: '2026-06-01T00:00:00Z', name: 'C' });
    expect(mergeConfigLww(b, c).name).toBe('C');
    expect(mergeConfigLww(c, b).name).toBe('C');
  });

  it('revocaciones: por credencial gana la más reciente', () => {
    const r1: RevocationEntry = { credentialId: 'X', version: 1, reason: 'a', at: '2026-11-20T10:00:00Z', by: 'u' };
    const r2: RevocationEntry = { credentialId: 'X', version: null, reason: 'b', at: '2026-11-20T11:00:00Z', by: 'u' };
    const r3: RevocationEntry = { credentialId: 'Y', version: null, reason: 'c', at: '2026-11-20T09:00:00Z', by: 'u' };
    const merged = mergeRevocationsLww([r1, r3], [r2]);
    expect(merged).toEqual([r2, r3]);
    expect(mergeRevocationsLww([r2], [r1, r3])).toEqual([r2, r3]);
    // mismo instante: gana "todas las versiones" (null) o la versión mayor
    const sameA: RevocationEntry = { ...r1, at: '2026-11-20T12:00:00Z', version: 2 };
    const sameB: RevocationEntry = { ...r1, at: '2026-11-20T12:00:00Z', version: 3 };
    expect(mergeRevocationsLww([sameA], [sameB])[0].version).toBe(3);
    expect(mergeRevocationsLww([sameB], [{ ...sameA, version: null }])[0].version).toBeNull();
  });
});

describe('reconcile', () => {
  it('calcula lo que falta en cada lado y fusiona sin duplicar', () => {
    const shared = makeScan({ deviceId: 'd1', seq: 1 });
    const local = {
      events: [shared, makeScan({ deviceId: 'd1', seq: 2 }), makeScan({ deviceId: 'd1', seq: 3 })],
      revocations: [] as RevocationEntry[],
      config: CONFIG
    };
    const remote = {
      events: [shared, makeScan({ deviceId: 'd2', seq: 1 }), makeScan({ deviceId: 'd2', seq: 2 })],
      revocations: [{ credentialId: 'X', version: null, reason: 'r', at: '2026-11-20T10:00:00Z', by: 'u' }],
      config: makeConfig({ configVersion: 5, name: 'nuevo' })
    };
    const r = reconcile(local, remote);
    expect(r.toLocal.map(eventKey)).toEqual(['d2:1', 'd2:2']);
    expect(r.toRemote.map(eventKey)).toEqual(['d1:2', 'd1:3']);
    expect(r.merged.events).toHaveLength(5);
    expect(r.duplicatesIgnored).toBe(1);
    expect(r.merged.config.name).toBe('nuevo');
    expect(r.merged.revocations).toHaveLength(1);
    // simétrico
    const r2 = reconcile(remote, local);
    expect(r2.merged.events.map(eventKey)).toEqual(r.merged.events.map(eventKey));
  });

  it('reconciliar dos veces no cambia nada', () => {
    const local = { events: [makeScan({ deviceId: 'd1', seq: 1 })], revocations: [], config: CONFIG };
    const remote = { events: [makeScan({ deviceId: 'd2', seq: 1 })], revocations: [], config: CONFIG };
    const first = reconcile(local, remote);
    const again = reconcile(first.merged, first.merged);
    expect(again.toLocal).toHaveLength(0);
    expect(again.toRemote).toHaveLength(0);
    expect(again.merged.events).toHaveLength(2);
  });
});
