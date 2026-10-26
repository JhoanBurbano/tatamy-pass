/**
 * IndexedDB (Dexie): copia local completa de credenciales, reglas y escaneos.
 * v2 añade la caché de fotos (`photos`) y el modo de la puerta en `device`.
 */
import Dexie, { type EntityTable } from 'dexie';
import type { Credential, EventConfig, GateMode, RevocationEntry, ScanEvent } from '@tatami/core';
import { searchCredentials } from './lib/search.js';

export interface LocalScan extends ScanEvent {
  /** 1 = ya confirmado por el host, 0 = pendiente de subir. */
  synced: 0 | 1;
}

export interface Setting {
  key: string;
  value: unknown;
}

export interface CachedPhoto {
  url: string;
  blob: Blob;
  at: string;
}

export interface DeviceSettings {
  hostUrl: string;
  deviceId: string;
  deviceToken: string;
  name: string;
  zone: string;
  /** Modo de la puerta (§3 del encargo): Entrada, Salida o Entrada+Salida. */
  mode?: GateMode;
  role: 'CONTROL' | 'SUPERVISOR';
  pinHash: string;
  enrolledAt: string;
}

export class ScannerDb extends Dexie {
  settings!: EntityTable<Setting, 'key'>;
  credentials!: EntityTable<Credential, 'id'>;
  revocations!: EntityTable<RevocationEntry & { key: string }, 'key'>;
  scans!: EntityTable<LocalScan, 'id'>;
  photos!: EntityTable<CachedPhoto, 'url'>;

  constructor() {
    super('tatami-pass-scanner');
    this.version(1).stores({
      settings: 'key',
      credentials: 'id, seq, personId',
      revocations: 'key, credentialId',
      scans: 'id, [deviceId+seq], credentialId, at, synced'
    });
    this.version(2).stores({
      photos: 'url'
    });
  }
}

export const db = new ScannerDb();

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const s = await db.settings.get(key);
  return s?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getDevice(): Promise<DeviceSettings | undefined> {
  return getSetting<DeviceSettings>('device');
}

export async function getConfig(): Promise<EventConfig | undefined> {
  return getSetting<EventConfig>('config');
}

export async function replaceSnapshot(snapshot: { config: EventConfig; credentials: Credential[]; revocations: RevocationEntry[]; serverTime: string }): Promise<void> {
  await db.transaction('rw', db.settings, db.credentials, db.revocations, async () => {
    await db.settings.put({ key: 'config', value: snapshot.config });
    await db.settings.put({ key: 'snapshotAt', value: snapshot.serverTime });
    await db.credentials.clear();
    await db.credentials.bulkPut(snapshot.credentials);
    await db.revocations.clear();
    await db.revocations.bulkPut(snapshot.revocations.map((r) => ({ ...r, key: `${r.credentialId}|${r.at}` })));
  });
}

export async function nextLocalSeq(deviceId: string): Promise<number> {
  const last = await db.scans.where('[deviceId+seq]').between([deviceId, Dexie.minKey], [deviceId, Dexie.maxKey]).last();
  return (last?.seq ?? 0) + 1;
}

export async function recentScansFor(credentialId: string, sinceIso: string): Promise<ScanEvent[]> {
  const rows = await db.scans.where('credentialId').equals(credentialId).toArray();
  return rows.filter((s) => s.at >= sinceIso);
}

export async function pendingCount(): Promise<number> {
  return db.scans.where('synced').equals(0).count();
}

/** Escaneos pendientes en orden de secuencia (la cola que se sube al host). */
export async function pendingScans(): Promise<LocalScan[]> {
  return db.scans.where('synced').equals(0).sortBy('seq');
}

/** Escaneos propios desde `sinceIso` (para el resumen de turno). */
export async function ownScansSince(deviceId: string, sinceIso: string): Promise<LocalScan[]> {
  const rows = await db.scans.where('at').aboveOrEqual(sinceIso).toArray();
  return rows.filter((s) => s.deviceId === deviceId);
}

/** Búsqueda local por ID corto o nombre (cuando el QR no se lee). */
export async function searchLocal(query: string, limit = 8): Promise<Credential[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const all = await db.credentials.toArray();
  return searchCredentials(all, q, limit);
}

/** Guarda en la cola (pendiente de subir) un evento ya construido; asigna el seq si no lo trae. */
export async function enqueueEvent(event: Omit<ScanEvent, 'id' | 'seq'> & { seq?: number }): Promise<LocalScan> {
  const seq = event.seq ?? (await nextLocalSeq(event.deviceId));
  const row: LocalScan = { ...event, seq, id: `${event.deviceId}:${seq}`, synced: 0 };
  await db.scans.put(row);
  return row;
}

export async function resetDevice(): Promise<void> {
  await db.delete();
  await db.open();
}
