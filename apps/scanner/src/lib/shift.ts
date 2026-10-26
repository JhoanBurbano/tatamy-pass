/**
 * Turno del operador (§6): la sesión (PIN) dura 12 h o hasta "Terminar turno".
 * Guarda quién, puerta, zona y modo; el resumen se calcula sobre los escaneos
 * locales. Puro.
 */
import { deviceEventMeta, isDeviceEvent, type GateMode, type ScanEvent, type ShiftTotals } from '@tatami/core';

export const SESSION_MS = 12 * 3600_000;

export interface SessionInfo {
  unlockedAt: number;
  shiftStartedAt: number;
  /** Nombre del operador (quién). Si no lo escribió, el de la puerta. */
  operator?: string;
}

export function sessionActive(s: SessionInfo | undefined, now: number): boolean {
  return !!s && s.unlockedAt > 0 && now - s.unlockedAt < SESSION_MS;
}

export function sessionRemainingMs(s: SessionInfo | undefined, now: number): number {
  if (!s) return 0;
  return Math.max(0, SESSION_MS - (now - s.unlockedAt));
}

export interface ShiftSummary extends ShiftTotals {
  startedAt: number;
  endedAt: number;
  /** Lo que se mostraba antes como "allowed" (entradas + salidas). */
  allowed: number;
  byReason: Record<string, number>;
  /** Eventos de dispositivo del turno (cambios de zona/modo). */
  deviceEvents: number;
}

export function emptyTotals(): ShiftTotals {
  return { scans: 0, entries: 0, exits: 0, denied: 0, deniedByReason: {}, alerts: 0, manual: 0, exceptions: 0, pending: 0 };
}

export function summarizeShift(
  scans: Array<ScanEvent & { synced?: 0 | 1 }>,
  args: { deviceId: string; startedAt: number; now: number }
): ShiftSummary {
  const own = scans.filter((s) => s.deviceId === args.deviceId && Date.parse(s.at) >= args.startedAt && Date.parse(s.at) <= args.now + 60_000);
  const byReason: Record<string, number> = {};
  const summary: ShiftSummary = { ...emptyTotals(), startedAt: args.startedAt, endedAt: args.now, allowed: 0, byReason, deviceEvents: 0 };
  for (const s of own) {
    if (s.synced === 0) summary.pending++;
    if (isDeviceEvent(s)) { summary.deviceEvents++; continue; }
    summary.scans++;
    byReason[s.reasonCode] = (byReason[s.reasonCode] ?? 0) + 1;
    if (s.decision === 'ALLOW') {
      summary.allowed++;
      if (s.direction === 'OUT') summary.exits++; else summary.entries++;
    } else if (s.decision === 'DENY') {
      summary.denied++;
      summary.deniedByReason[s.reasonCode] = (summary.deniedByReason[s.reasonCode] ?? 0) + 1;
    } else {
      summary.alerts++;
    }
    const meta = deviceEventMeta(s);
    if (meta?.type === 'exception') summary.exceptions++;
    else if (s.manual || s.reasonCode === 'OK_MANUAL') summary.manual++;
  }
  return summary;
}

export function totalsOf(s: ShiftSummary): ShiftTotals {
  const { scans, entries, exits, denied, deniedByReason, alerts, manual, exceptions, pending } = s;
  return { scans, entries, exits, denied, deniedByReason, alerts, manual, exceptions, pending };
}

export function describeMode(mode: GateMode | undefined): string {
  return mode === 'OUT' ? 'Salida' : mode === 'BOTH' ? 'Entrada + Salida' : 'Entrada';
}
