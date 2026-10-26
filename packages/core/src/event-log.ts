/**
 * Log de eventos append-only para sync (§8).
 * - Cada ScanEvent se identifica por `(deviceId, seq)` → idempotente.
 * - Config y revocaciones son LWW (last-writer-wins) por `updatedAt`/`at`.
 * - `reconcile(local, remote)` calcula qué falta a cada lado y devuelve el
 *   estado fusionado. Es determinista: el mismo par de entradas da el mismo
 *   resultado sin importar el orden.
 */
import type { EventConfig, RevocationEntry, ScanEvent } from './types.js';

export function eventKey(e: Pick<ScanEvent, 'deviceId' | 'seq'>): string {
  return `${e.deviceId}:${e.seq}`;
}

export interface EventLogState {
  /** Mapa `deviceId:seq` → evento. */
  events: Map<string, ScanEvent>;
  /** Último seq visto por dispositivo. */
  cursors: Map<string, number>;
}

export function createEventLog(initial: ScanEvent[] = []): EventLogState {
  const log: EventLogState = { events: new Map(), cursors: new Map() };
  appendEvents(log, initial);
  return log;
}

export interface AppendResult {
  added: ScanEvent[];
  duplicates: number;
}

/**
 * Inserta eventos ignorando los que ya existen (misma clave). Si llega un evento
 * con la misma clave pero distinto contenido, gana el que ya estaba (append-only:
 * un hecho no se reescribe) y se cuenta como duplicado.
 */
export function appendEvents(log: EventLogState, incoming: ScanEvent[]): AppendResult {
  const added: ScanEvent[] = [];
  let duplicates = 0;
  for (const e of incoming) {
    const key = eventKey(e);
    if (e.id !== key) throw new Error(`id inconsistente: ${e.id} ≠ ${key}`);
    if (log.events.has(key)) {
      duplicates++;
      continue;
    }
    log.events.set(key, e);
    added.push(e);
    const cur = log.cursors.get(e.deviceId) ?? 0;
    if (e.seq > cur) log.cursors.set(e.deviceId, e.seq);
  }
  return { added, duplicates };
}

/** Siguiente seq para un dispositivo (monotónico). */
export function nextSeq(log: EventLogState, deviceId: string): number {
  return (log.cursors.get(deviceId) ?? 0) + 1;
}

/** Eventos ordenados por `at` y luego por clave (orden estable). */
export function listEvents(log: EventLogState, opts: { since?: string; deviceId?: string } = {}): ScanEvent[] {
  const out: ScanEvent[] = [];
  for (const e of log.events.values()) {
    if (opts.deviceId && e.deviceId !== opts.deviceId) continue;
    if (opts.since && e.at <= opts.since) continue;
    out.push(e);
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : eventKey(a).localeCompare(eventKey(b))));
}

/** Eventos de `log` que `other` no tiene (según cursores por dispositivo). */
export function missingFor(log: EventLogState, otherCursors: Map<string, number>): ScanEvent[] {
  const out: ScanEvent[] = [];
  for (const e of log.events.values()) {
    const seen = otherCursors.get(e.deviceId) ?? 0;
    if (e.seq > seen) out.push(e);
  }
  return out.sort((a, b) => a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq);
}

// ---------- LWW ----------

export function mergeConfigLww(a: EventConfig, b: EventConfig): EventConfig {
  if (a.configVersion !== b.configVersion) return a.configVersion > b.configVersion ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

/** Une listas de revocación: por credencial gana la entrada más reciente (`at`). */
export function mergeRevocationsLww(a: RevocationEntry[], b: RevocationEntry[]): RevocationEntry[] {
  const byCred = new Map<string, RevocationEntry>();
  for (const r of [...a, ...b]) {
    const cur = byCred.get(r.credentialId);
    if (!cur || r.at > cur.at || (r.at === cur.at && (r.version === null || (cur.version !== null && r.version > cur.version)))) {
      byCred.set(r.credentialId, r);
    }
  }
  return [...byCred.values()].sort((x, y) => x.credentialId.localeCompare(y.credentialId));
}

// ---------- reconcile ----------

export interface Replica {
  events: ScanEvent[];
  revocations: RevocationEntry[];
  config: EventConfig;
}

export interface ReconcileResult {
  merged: Replica;
  /** Lo que `local` debe recibir de `remote`. */
  toLocal: ScanEvent[];
  /** Lo que `remote` debe recibir de `local`. */
  toRemote: ScanEvent[];
  duplicatesIgnored: number;
}

export function reconcile(local: Replica, remote: Replica): ReconcileResult {
  const localLog = createEventLog(local.events);
  const remoteLog = createEventLog(remote.events);
  const toLocal = missingFor(remoteLog, localLog.cursors).filter((e) => !localLog.events.has(eventKey(e)));
  const toRemote = missingFor(localLog, remoteLog.cursors).filter((e) => !remoteLog.events.has(eventKey(e)));
  const mergedLog = createEventLog(local.events);
  const res = appendEvents(mergedLog, remote.events);
  return {
    merged: {
      events: listEvents(mergedLog),
      revocations: mergeRevocationsLww(local.revocations, remote.revocations),
      config: mergeConfigLww(local.config, remote.config)
    },
    toLocal,
    toRemote,
    duplicatesIgnored: res.duplicates
  };
}
