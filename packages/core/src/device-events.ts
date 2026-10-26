/**
 * Eventos del dispositivo que viajan por el MISMO log de sync que los escaneos
 * (`POST /sync/events`), para que el host los reciba sin cambios de API:
 *
 * - `manual_entry`: el operador escribió el ID corto porque el QR no se leyó.
 *   Es un escaneo normal (las reglas deciden) con `manual.type = 'manual_entry'`
 *   y el motivo del catálogo.
 * - `exception`: un supervisor autorizó con su PIN el paso tras un rojo/ámbar.
 *   Es un escaneo `OK_MANUAL` con `manual.type = 'exception'` y `authorizedBy`.
 * - `zone_change`, `mode_change`, `shift_start`, `shift_end`: no son escaneos.
 *   Van con `decision: 'EVENT'` y `credentialId: null`; el host los guarda tal
 *   cual (no hay CHECK sobre `decision`) y los reportes de entradas/salidas los
 *   ignoran porque no son `ALLOW`/`DENY`/`ALERT`.
 *
 * Todo el detalle extra viaja dentro de `manual` (único campo JSON libre que el
 * host persiste, `manual_json`). `manual.reason` y `manual.by` siempre existen
 * para que el host actual los muestre como texto legible.
 */
import type { Decision, ReasonCode, ScanEvent } from './types.js';

export type DeviceEventType = 'manual_entry' | 'exception' | 'zone_change' | 'mode_change' | 'shift_start' | 'shift_end';

/** Modo de la puerta: solo entradas, solo salidas o pregunta en cada lectura. */
export type GateMode = 'IN' | 'OUT' | 'BOTH';

/** `decision` de los eventos que no son escaneos. */
export const DEVICE_EVENT_DECISION = 'EVENT' as const;

export const DEVICE_EVENT_REASON: Record<Exclude<DeviceEventType, 'manual_entry' | 'exception'>, string> = {
  zone_change: 'ZONE_CHANGE',
  mode_change: 'MODE_CHANGE',
  shift_start: 'SHIFT_START',
  shift_end: 'SHIFT_END'
};

export interface ReasonOption {
  code: string;
  label: string;
  /** Si `true`, el operador debe escribir un texto adicional. */
  requiresText?: boolean;
}

/** Motivos de ingreso manual (manual del Control de entradas, "Cómo hacer un ingreso manual"). */
export const MANUAL_ENTRY_REASONS: ReasonOption[] = [
  { code: 'QR_UNREADABLE', label: 'QR no se lee' },
  { code: 'PROVISIONAL', label: 'Credencial provisional' },
  { code: 'SUPERVISOR_OK', label: 'Autorizado por supervisor' },
  { code: 'SHEET', label: 'Planilla (modo degradado)' },
  { code: 'OTHER', label: 'Otro', requiresText: true }
];

/** Motivos de excepción de supervisor (manual del Supervisor, "Autorizar una excepción"). */
export const EXCEPTION_REASONS: ReasonOption[] = [
  { code: 'LEFT_WITHOUT_SCAN', label: 'Salió sin escanear' },
  { code: 'GATE_ERROR', label: 'Error de puerta' },
  { code: 'COORDINATOR', label: 'Autorización del Coordinador' },
  { code: 'OTHER', label: 'Otro', requiresText: true }
];

export interface ShiftTotals {
  scans: number;
  entries: number;
  exits: number;
  denied: number;
  deniedByReason: Record<string, number>;
  alerts: number;
  manual: number;
  exceptions: number;
  pending: number;
}

export type ManualMeta =
  | { type: 'manual_entry'; reasonCode: string; reason: string; by: string }
  | { type: 'exception'; reasonCode: string; reason: string; by: string; authorizedBy: string; overrides: string }
  | { type: 'zone_change'; reason: string; by: string; authorizedBy: string; from: string; to: string }
  | { type: 'mode_change'; reason: string; by: string; authorizedBy: string; from: GateMode; to: GateMode }
  | { type: 'shift_start'; reason: string; by: string; gate: string; zone: string; mode: GateMode }
  | { type: 'shift_end'; reason: string; by: string; gate: string; zone: string; mode: GateMode; startedAt: string; totals: ShiftTotals };

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type ManualMetaInput = DistributiveOmit<ManualMeta, 'reason'>;

/** Texto legible (`manual.reason`) de cada evento de dispositivo. */
export function describeDeviceEvent(meta: ManualMetaInput): string {
  switch (meta.type) {
    case 'manual_entry': return `Ingreso manual · ${meta.reasonCode}`;
    case 'exception': return `Excepción autorizada por ${meta.authorizedBy} · ${meta.reasonCode} (anulaba ${meta.overrides})`;
    case 'zone_change': return `Cambio de zona ${meta.from} → ${meta.to} autorizado por ${meta.authorizedBy}`;
    case 'mode_change': return `Cambio de modo ${meta.from} → ${meta.to} autorizado por ${meta.authorizedBy}`;
    case 'shift_start': return `Inicio de turno de ${meta.by} en ${meta.gate} · zona ${meta.zone} · modo ${meta.mode}`;
    case 'shift_end': return `Fin de turno de ${meta.by} en ${meta.gate}: ${meta.totals.entries} entradas · ${meta.totals.exits} salidas · ${meta.totals.denied} negados · ${meta.totals.manual} manuales`;
  }
}

/**
 * Construye un evento de dispositivo (no escaneo) con la forma de `ScanEvent`
 * que acepta `POST /sync/events`.
 */
export function buildDeviceEvent(args: {
  deviceId: string; seq: number; zone: string; at: string;
  meta: Extract<ManualMeta, { type: 'zone_change' | 'mode_change' | 'shift_start' | 'shift_end' }>;
}): ScanEvent {
  const { deviceId, seq, zone, at, meta } = args;
  return {
    id: `${deviceId}:${seq}`,
    deviceId, seq, zone, at,
    credentialId: null,
    direction: 'IN',
    decision: DEVICE_EVENT_DECISION as unknown as Decision,
    reasonCode: DEVICE_EVENT_REASON[meta.type] as ReasonCode,
    manual: meta
  };
}

export function isDeviceEvent(e: Pick<ScanEvent, 'decision'>): boolean {
  return (e.decision as string) === DEVICE_EVENT_DECISION;
}

/** Metadatos tipados de `manual` (si el evento los lleva). */
export function deviceEventMeta(e: Pick<ScanEvent, 'manual'>): ManualMeta | undefined {
  const m = e.manual as (ManualMeta & { type?: string }) | undefined;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string') return undefined;
  return m;
}

export function deviceEventType(e: Pick<ScanEvent, 'manual' | 'decision' | 'reasonCode'>): DeviceEventType | 'scan' {
  return deviceEventMeta(e)?.type ?? 'scan';
}
