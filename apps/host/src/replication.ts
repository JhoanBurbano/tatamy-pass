/**
 * Host standby (§2, §8 de 00-DECISIONES): el equipo de respaldo es un cliente de
 * sync más del primario.
 *
 * - `TP_ROLE=standby` (alias `TP_MODE`) + `TP_PRIMARY_URL` + `TP_REPLICA_KEY` (clave compartida).
 * - Al arrancar pide el snapshot completo; luego cada 10 s pide los cambios
 *   incrementales: escaneos, revocaciones, credenciales, personas, dispositivos
 *   (con token y PIN, para que los scanners no tengan que re-enrolarse),
 *   usuarios, alertas, lotes, config y auditoría (misma cadena de hashes).
 * - Todo se aplica con upserts idempotentes; el cursor se toma del reloj del
 *   primario con 2 s de solape para no perder filas escritas durante la consulta.
 * - `promote()` lo convierte en primario: deja de replicar, acepta escrituras y
 *   registra PROMOTED en la auditoría (continúa la cadena del primario).
 * - El primario expone `/replication/snapshot` y `/replication/changes`
 *   protegidos por la cabecera `x-tatami-replica-key`.
 */
import type { AuditRecord, EventConfig, RevocationEntry } from '@tatami/core';
import { scanRawSince, scanUpsertRaw } from './repos.js';
import type { AppContext } from './server.js';

export type HostMode = 'primary' | 'standby';

export interface ReplicationPayload {
  serverTime: string;
  full: boolean;
  config: EventConfig | null;
  users: Record<string, unknown>[];
  persons: Record<string, unknown>[];
  credentials: Record<string, unknown>[];
  revocations: RevocationEntry[];
  devices: Record<string, unknown>[];
  scans: Record<string, unknown>[];
  audit: AuditRecord[];
  alerts: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  meta: Record<string, string | undefined>;
}

const OVERLAP_MS = 2000;

/** Lado primario: lo que hay que mandar al standby desde `since` (o todo si no hay cursor). */
export function replicationPayload(ctx: AppContext, since?: string, auditSeq = 0, knownConfigVersion = 0): ReplicationPayload {
  const serverTime = new Date().toISOString();
  const s = since ? new Date(Date.parse(since) - OVERLAP_MS).toISOString() : undefined;
  return {
    serverTime, full: !since,
    config: ctx.config.configVersion > knownConfigVersion || !since ? ctx.config : null,
    users: ctx.users.rawSince(s), persons: ctx.persons.plainSince(s), credentials: ctx.credentials.rawSince(s),
    revocations: ctx.credentials.revocations(s), devices: ctx.devices.rawSince(s), scans: scanRawSince(ctx.db, s),
    audit: ctx.audit.since(auditSeq), alerts: ctx.alerts.rawSince(s), batches: ctx.batches.rawSince(s),
    meta: { cloudCursor: ctx.meta.get('cloudCursor'), lastCloudSyncAt: ctx.meta.get('lastCloudSyncAt') }
  };
}

/** Lado standby: aplica un payload. Devuelve conteos. */
export function applyReplication(ctx: AppContext, p: ReplicationPayload): Record<string, number> {
  const counts: Record<string, number> = { users: 0, persons: 0, credentials: 0, revocations: 0, devices: 0, scans: 0, audit: 0, alerts: 0, batches: 0 };
  ctx.db.transaction(() => {
    for (const r of p.users) { ctx.users.upsertRaw(r); counts.users++; }
    for (const r of p.persons) { ctx.persons.upsertPlain(r); counts.persons++; }
    for (const r of p.credentials) { ctx.credentials.upsertRaw(r); counts.credentials++; }
    for (const r of p.revocations) { ctx.credentials.upsertRevocation(r); counts.revocations++; }
    for (const r of p.devices) { ctx.devices.upsertRaw(r); counts.devices++; }
    for (const r of p.scans) counts.scans += scanUpsertRaw(ctx.db, r);
    for (const r of p.audit) { ctx.audit.insertRaw(r); counts.audit++; }
    for (const r of p.alerts) { ctx.alerts.upsertRaw(r); counts.alerts++; }
    for (const r of p.batches) { ctx.batches.upsertRaw(r); counts.batches++; }
    for (const [k, v] of Object.entries(p.meta)) if (v !== undefined) ctx.meta.set(k, v);
    if (p.config) ctx.applyConfig(p.config, { persist: true });
  })();
  return counts;
}

export type FetchJson = (path: string) => Promise<unknown>;

export interface ReplicaStatus {
  mode: HostMode;
  primaryUrl: string | null;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lagSeconds: number | null;
  online: boolean | null;
  lastError: string | null;
  lastCounts: Record<string, number> | null;
  message: string;
}

export class Replica {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastSyncAt: string | null = null;
  private lastAttemptAt: string | null = null;
  private online: boolean | null = null;
  private lastError: string | null = null;
  private lastCounts: Record<string, number> | null = null;
  private cursor: string | undefined;

  constructor(
    private ctx: AppContext,
    public readonly primaryUrl: string | null,
    private readonly key: string | undefined,
    private fetchJson?: FetchJson,
    public readonly intervalMs = 10_000,
    private log: (m: string) => void = (m) => console.log(`[standby] ${m}`)
  ) {
    this.cursor = ctx.meta.get('replicaCursor') ?? undefined;
  }

  get configured(): boolean { return Boolean(this.primaryUrl && (this.key || this.fetchJson)); }

  status(): ReplicaStatus {
    const lag = this.lastSyncAt ? Math.round((Date.now() - Date.parse(this.lastSyncAt)) / 1000) : null;
    let message: string;
    if (this.ctx.mode === 'primary') message = 'Este equipo es el principal.';
    else if (!this.configured) message = 'Equipo de respaldo sin principal configurado: define TP_PRIMARY_URL y TP_REPLICA_KEY.';
    else if (this.online === false) message = `Sin conexión con el principal${lag !== null ? ` hace ${lag} s` : ''}. Si no responde, promueve este equipo.`;
    else if (this.lastSyncAt) message = `Replicando del principal · al día hace ${lag} s.`;
    else message = 'Todavía no se ha sincronizado con el principal.';
    return { mode: this.ctx.mode, primaryUrl: this.primaryUrl, lastSyncAt: this.lastSyncAt, lastAttemptAt: this.lastAttemptAt, lagSeconds: lag, online: this.online, lastError: this.lastError, lastCounts: this.lastCounts, message };
  }

  start(): void {
    this.stop();
    if (this.ctx.mode !== 'standby' || !this.configured) return;
    void this.syncOnce().catch(() => undefined);
    this.timer = setInterval(() => {
      // promoción desde la CLI (npm run promote): el proceso en marcha lo detecta aquí
      if (this.ctx.meta.get('hostMode') === 'primary' && this.ctx.mode === 'standby') { promote(this.ctx, 'cli'); return; }
      void this.syncOnce().catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref?.();
    this.log(`Replicando de ${this.primaryUrl} cada ${this.intervalMs / 1000} s.`);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  private async get(path: string): Promise<unknown> {
    if (this.fetchJson) return this.fetchJson(path);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${this.primaryUrl}${path}`, { headers: { 'x-tatami-replica-key': this.key! }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`el principal respondió ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  /** Un ciclo: snapshot si no hay cursor, cambios incrementales si lo hay. */
  async syncOnce(): Promise<Record<string, number>> {
    if (this.running) return this.lastCounts ?? {};
    if (this.ctx.mode !== 'standby') throw new Error('Este equipo ya es el principal.');
    this.running = true;
    this.lastAttemptAt = new Date().toISOString();
    try {
      const auditSeq = this.ctx.audit.last()?.seq ?? 0;
      const path = this.cursor
        ? `/replication/changes?since=${encodeURIComponent(this.cursor)}&auditSeq=${auditSeq}&configVersion=${this.ctx.config.configVersion}`
        : `/replication/snapshot?auditSeq=${auditSeq}`;
      const payload = (await this.get(path)) as ReplicationPayload;
      const counts = applyReplication(this.ctx, payload);
      this.cursor = payload.serverTime;
      this.ctx.meta.set('replicaCursor', this.cursor);
      this.lastSyncAt = new Date().toISOString();
      this.online = true;
      this.lastError = null;
      this.lastCounts = counts;
      return counts;
    } catch (e) {
      this.online = false;
      this.lastError = (e as Error).name === 'AbortError' ? 'tiempo de espera agotado' : (e as Error).message;
      this.log(`Sin conexión con el principal (${this.lastError}).`);
      throw e;
    } finally {
      this.running = false;
    }
  }
}

export function resolveMode(ctx: Pick<AppContext, 'meta'>): HostMode {
  const stored = ctx.meta.get('hostMode');
  if (stored === 'primary' || stored === 'standby') return stored;
  const env = (process.env.TP_ROLE ?? process.env.TP_MODE ?? '').toLowerCase();
  return env === 'standby' ? 'standby' : 'primary';
}

/** Convierte el standby en primario. Idempotente. */
export function promote(ctx: AppContext, by: string): { mode: HostMode; promotedAt: string; previousPrimary: string | null } {
  const promotedAt = new Date().toISOString();
  if (ctx.mode === 'primary') return { mode: 'primary', promotedAt, previousPrimary: null };
  ctx.replica.stop();
  ctx.mode = 'primary';
  ctx.meta.set('hostMode', 'primary');
  ctx.meta.set('promotedAt', promotedAt);
  ctx.audit.append(by, 'PROMOTED', { from: ctx.replica.primaryUrl, promotedAt });
  return { mode: 'primary', promotedAt, previousPrimary: ctx.replica.primaryUrl };
}
