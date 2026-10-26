/**
 * Eventos de dispositivo (no escaneos) que viajan por la misma cola de sync:
 * `zone_change`, `mode_change`, `shift_start`, `shift_end`. Se guardan en
 * IndexedDB como pendientes y `sync.ts` los sube con `POST /sync/events`.
 */
import { buildDeviceEvent, describeDeviceEvent, type ManualMetaInput } from '@tatami/core';
import { enqueueEvent, getSetting, nextLocalSeq, type DeviceSettings, type LocalScan } from './db.js';

type DeviceMetaInput = Extract<ManualMetaInput, { type: 'zone_change' | 'mode_change' | 'shift_start' | 'shift_end' }>;

async function nowIso(): Promise<string> {
  const skew = (await getSetting<number>('clockSkewMs')) ?? 0;
  return new Date(Date.now() + skew).toISOString();
}

export async function recordDeviceEvent(dev: DeviceSettings, meta: DeviceMetaInput): Promise<LocalScan> {
  const seq = await nextLocalSeq(dev.deviceId);
  const full = { ...meta, reason: describeDeviceEvent(meta) } as Parameters<typeof buildDeviceEvent>[0]['meta'];
  const event = buildDeviceEvent({ deviceId: dev.deviceId, seq, zone: dev.zone, at: await nowIso(), meta: full });
  return enqueueEvent(event);
}
