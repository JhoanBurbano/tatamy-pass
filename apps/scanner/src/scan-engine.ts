/**
 * Puente entre la cámara/entrada manual y @tatami/core: valida offline y
 * guarda el escaneo en IndexedDB.
 */
import {
  credentialIdFromPayload, decodeToken, evaluateScan, isValidCredentialId, normalizeCredentialInput,
  toScanEvent, verifyToken, type Credential, type EventConfig, type ScanEvent, type ScanResult, type ScanSource
} from '@tatami/core';
import { db, getSetting, nextLocalSeq, recentScansFor, type DeviceSettings } from './db.js';

export interface ScanOutcome {
  result: ScanResult;
  credential?: Credential;
  /** Milisegundos desde lectura hasta decisión. */
  elapsedMs: number;
  /** Instante (hora del host) en que se decidió. */
  at: string;
  /** ID corto leído/escrito aunque no esté en la lista local (para excepciones). */
  inputId?: string;
  /** Evento guardado en la cola. */
  event: ScanEvent;
  direction: 'IN' | 'OUT';
}

async function now(): Promise<number> {
  const skew = (await getSetting<number>('clockSkewMs')) ?? 0;
  return Date.now() + skew;
}

export interface ManualInfo {
  reason: string;
  by: string;
  /** Metadatos extra (tipo, catálogo, quién autorizó) que viajan en `manual`. */
  meta?: Record<string, unknown>;
}

export interface ProcessOptions {
  direction?: 'IN' | 'OUT';
  /** Excepción autorizada: pasa con motivo (`OK_MANUAL`). */
  override?: ManualInfo;
  /**
   * Ingreso manual con motivo: el ID se escribió a mano. Las reglas deciden
   * igual; el motivo queda en `manual` del evento.
   */
  manual?: ManualInfo;
}

function manualField(info: ManualInfo | undefined): ScanEvent['manual'] | undefined {
  if (!info) return undefined;
  return { ...(info.meta ?? {}), reason: info.reason, by: info.by } as ScanEvent['manual'];
}

export async function processInput(raw: string, dev: DeviceSettings, config: EventConfig, opts: ProcessOptions = {}): Promise<ScanOutcome> {
  const t0 = performance.now();
  const text = raw.trim();
  let source: ScanSource;
  let credential: Credential | undefined;
  let inputId: string | undefined;

  if (opts.override) {
    const id = normalizeCredentialInput(text);
    credential = await db.credentials.get(id);
    inputId = id;
    // En el mensaje de pantalla manda quién autorizó (supervisor); en el evento, `manual.by` es el operador.
    const authorizedBy = typeof opts.override.meta?.authorizedBy === 'string' ? opts.override.meta.authorizedBy : undefined;
    source = { kind: 'override', credentialId: id, reason: opts.override.reason, by: authorizedBy ?? opts.override.by };
  } else if (text.startsWith('TP1.')) {
    const verification = verifyToken(text, config.signingKeys);
    source = { kind: 'token', verification };
    const payload = verification.ok ? verification.payload : decodeToken(text);
    if (payload) credential = await db.credentials.where('seq').equals(Number(payload.c)).first();
    if (payload && credential && credential.id !== credentialIdFromPayload(payload, config)) credential = undefined;
    if (payload) { try { inputId = credentialIdFromPayload(payload, config); } catch { /* seq fuera de rango */ } }
  } else if (isValidCredentialId(text)) {
    const id = normalizeCredentialInput(text);
    credential = await db.credentials.get(id);
    inputId = id;
    source = { kind: 'manual-id', credentialId: id };
  } else {
    // Ni token ni ID válido (p. ej. ID con dígito verificador mal escrito).
    source = { kind: 'token', verification: { ok: false, reason: 'MALFORMED', raw: text } };
  }

  const nowMs = await now();
  const sinceIso = new Date(nowMs - 24 * 3600_000).toISOString();
  const recentScans = credential ? await recentScansFor(credential.id, sinceIso) : [];
  const revocations = credential ? await db.revocations.where('credentialId').equals(credential.id).toArray() : [];

  const result = evaluateScan({
    source, credential, zone: dev.zone, direction: opts.direction, now: nowMs,
    device: { id: dev.deviceId, zone: dev.zone, role: dev.role }, recentScans, revocations, config
  });

  const seq = await nextLocalSeq(dev.deviceId);
  const event = toScanEvent({ deviceId: dev.deviceId, seq, zone: dev.zone, direction: opts.direction, at: nowMs, result, credentialId: credential?.id ?? null, manual: manualField(opts.override ?? opts.manual) });
  await db.scans.put({ ...event, synced: 0 });

  return { result, credential, elapsedMs: performance.now() - t0, at: event.at, inputId, event, direction: event.direction };
}
