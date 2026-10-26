/**
 * Actualización desde la nube (apps/registration → host).
 * - `pull()` trae inscripciones aprobadas nuevas/actualizadas desde el último cursor,
 *   crea/actualiza personas y emite credenciales. Idempotente por id de inscripción
 *   (guardado como `external_id` de la persona).
 * - Scheduler con setInterval que nunca solapa ejecuciones y tolera no tener internet.
 * - Si no hay `TP_CLOUD_URL`, `pull()` lanza `CloudNotConfigured` (el endpoint responde 409).
 */
import { ageOn, categoryForAge, COMPANION_ROLE, type Person } from '@tatami/core';
import type { AppContext } from './server.js';

export interface CloudSettings {
  url?: string;
  key?: string;
  /** 0 = solo manual. */
  intervalMinutes: number;
}

export function cloudSettingsFromEnv(): CloudSettings {
  return {
    url: process.env.TP_CLOUD_URL?.replace(/\/$/, '') || undefined,
    key: process.env.TP_CLOUD_KEY || undefined,
    intervalMinutes: process.env.TP_CLOUD_INTERVAL_MIN === undefined ? 5 : Math.max(0, Number(process.env.TP_CLOUD_INTERVAL_MIN) || 0)
  };
}

export class CloudNotConfigured extends Error {
  constructor() { super('La nube no está configurada: define TP_CLOUD_URL y TP_CLOUD_KEY en el host.'); }
}

/**
 * Resultado de `POST /api/host-report` (host → nube): qué credenciales se reportaron y
 * cuántas aplicó la nube. `sent = 0` significa que no había nada nuevo que contar.
 */
export interface CloudReportResult {
  at: string;
  ok: boolean;
  error?: string;
  /** Credenciales incluidas en el reporte (solo las que cambiaron desde el último reporte exitoso). */
  sent: number;
  /** Lo que la nube dice haber aplicado / no reconocido (ids de inscripción que la nube no tiene). */
  applied?: number;
  unknown?: string[];
}

export interface CloudPullResult {
  at: string;
  ok: boolean;
  error?: string;
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  companionsCreated: number;
  cursor: string | null;
  /** Reporte host → nube hecho tras el pull (IDs y versiones emitidos). Puede fallar sin afectar `ok`. */
  report?: CloudReportResult;
}

export interface CloudStatus {
  configured: boolean;
  url: string | null;
  intervalMinutes: number;
  lastCloudSyncAt: string | null;
  lastAttemptAt: string | null;
  online: boolean | null;
  lastResult: CloudPullResult | null;
  /** Último reporte host → nube (`POST /api/host-report`). */
  lastReport: CloudReportResult | null;
  running: boolean;
  nextRunAt: string | null;
  message: string;
}

interface CloudRegistration {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  documentNumber?: string;
  club?: string;
  roleCode: string;
  categoryCode?: string;
  guardian?: Person['guardian'];
  relationship?: string;
  delegation?: string;
  emergencyContact?: Person['emergencyContact'];
  eps?: Person['eps'];
  updatedAt: string;
  companions: CloudRegistration[];
}

export class CloudSync {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private nextRunAt: string | null = null;
  private lastAttemptAt: string | null = null;
  private online: boolean | null = null;

  constructor(private ctx: AppContext, public settings: CloudSettings, private log: (msg: string) => void = (m) => console.log(`[cloud] ${m}`)) {}

  get configured(): boolean {
    return Boolean(this.settings.url && this.settings.key);
  }

  status(): CloudStatus {
    const last = this.ctx.meta.get('lastCloudResult');
    const lastResult = last ? (JSON.parse(last) as CloudPullResult) : null;
    const lastCloudSyncAt = this.ctx.meta.get('lastCloudSyncAt') ?? null;
    const rep = this.ctx.meta.get('lastCloudReport');
    const lastReport = rep ? (JSON.parse(rep) as CloudReportResult) : null;
    let message: string;
    if (!this.configured) message = 'Sin nube configurada: define TP_CLOUD_URL y TP_CLOUD_KEY.';
    else if (this.running) message = 'Actualizando desde la nube…';
    else if (this.online === false) message = this.settings.intervalMinutes > 0 ? `Sin conexión a la nube, se reintenta en ${this.settings.intervalMinutes} min.` : 'Sin conexión a la nube. Pulsa "Actualizar desde la nube" para reintentar.';
    else if (lastCloudSyncAt) message = `Última actualización ${lastCloudSyncAt}.`;
    else message = 'Todavía no se ha actualizado desde la nube.';
    return {
      configured: this.configured, url: this.settings.url ?? null, intervalMinutes: this.settings.intervalMinutes,
      lastCloudSyncAt, lastAttemptAt: this.lastAttemptAt, online: this.online, lastResult, lastReport, running: this.running, nextRunAt: this.nextRunAt, message
    };
  }

  private wanted = false;

  startScheduler(): void {
    this.stopScheduler();
    this.wanted = true;
    if (!this.configured || this.settings.intervalMinutes <= 0) {
      this.log(this.configured ? 'Actualización periódica desactivada (TP_CLOUD_INTERVAL_MIN=0); solo manual.' : 'Nube no configurada; la actualización periódica no se activa.');
      return;
    }
    const ms = this.settings.intervalMinutes * 60_000;
    this.nextRunAt = new Date(Date.now() + ms).toISOString();
    this.timer = setInterval(() => {
      this.nextRunAt = new Date(Date.now() + ms).toISOString();
      void this.pull().catch(() => undefined);
    }, ms);
    this.timer.unref?.();
    this.log(`Actualización periódica cada ${this.settings.intervalMinutes} min desde ${this.settings.url}.`);
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.nextRunAt = null;
    this.wanted = false;
  }

  /** Trae lo nuevo. Si ya hay una ejecución en curso, devuelve su resultado al terminar. */
  async pull(): Promise<CloudPullResult> {
    if (!this.configured) throw new CloudNotConfigured();
    if (this.running && this.inflight) return this.inflight;
    this.running = true;
    this.inflight = this.doPull().finally(() => { this.running = false; this.inflight = undefined; });
    return this.inflight;
  }
  private inflight: Promise<CloudPullResult> | undefined;

  private async fetchExport(since: string | undefined): Promise<{ registrations: CloudRegistration[]; cursor: string | null }> {
    const url = `${this.settings.url}/api/export${since ? `?since=${encodeURIComponent(since)}` : ''}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(url, { headers: { 'x-tatami-key': this.settings.key! }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`la nube respondió ${res.status}`);
      return (await res.json()) as { registrations: CloudRegistration[]; cursor: string | null };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Mira qué hay en la nube desde el último cursor **sin aplicar nada**: lo que
   * el panel muestra como "pendiente de traer". No mueve el cursor.
   */
  async preview(): Promise<{ ok: boolean; error?: string; count: number; newCount: number; updatedCount: number; items: Array<{ id: string; name: string; club?: string; roleCode: string; companions: number; isNew: boolean; updatedAt: string }> }> {
    if (!this.configured) throw new CloudNotConfigured();
    try {
      const body = await this.fetchExport(this.ctx.meta.get('cloudCursor'));
      this.online = true;
      const items = body.registrations.map((r) => {
        const existing = this.ctx.persons.byExternalId(r.id);
        return { id: r.id, name: `${r.firstName} ${r.lastName}`.trim(), club: r.club, roleCode: r.roleCode, companions: r.companions?.length ?? 0, isNew: !existing, updatedAt: r.updatedAt };
      });
      return { ok: true, count: items.length, newCount: items.filter((i) => i.isNew).length, updatedCount: items.filter((i) => !i.isNew).length, items };
    } catch (e) {
      this.online = false;
      return { ok: false, error: (e as Error).name === 'AbortError' ? 'tiempo de espera agotado' : (e as Error).message, count: 0, newCount: 0, updatedCount: 0, items: [] };
    }
  }

  /** Cambia el intervalo (0 = solo manual), lo persiste en `meta` y reprograma si el scheduler estaba activo. */
  setIntervalMinutes(minutes: number): void {
    const m = Math.max(0, Math.min(1440, Math.round(minutes)));
    this.settings = { ...this.settings, intervalMinutes: m };
    this.ctx.meta.set('cloudIntervalMinutes', String(m));
    if (this.wanted) this.startScheduler();
  }

  private async doPull(): Promise<CloudPullResult> {
    const at = new Date().toISOString();
    this.lastAttemptAt = at;
    const since = this.ctx.meta.get('cloudCursor');
    const result: CloudPullResult = { at, ok: false, received: 0, created: 0, updated: 0, unchanged: 0, companionsCreated: 0, cursor: since ?? null };
    try {
      const body = await this.fetchExport(since);
      this.online = true;
      result.received = body.registrations.length;
      this.ctx.db.transaction(() => {
        for (const reg of body.registrations) this.applyRegistration(reg, result);
      })();
      if (body.cursor) { this.ctx.meta.set('cloudCursor', body.cursor); result.cursor = body.cursor; }
      this.ctx.meta.set('lastCloudSyncAt', at);
      result.ok = true;
      this.ctx.audit.append('cloud-sync', 'CLOUD_PULL', { received: result.received, created: result.created, updated: result.updated, companionsCreated: result.companionsCreated, cursor: result.cursor });
      this.log(`OK: ${result.received} recibidas, ${result.created} nuevas, ${result.updated} actualizadas, ${result.companionsCreated} acompañantes nuevos.`);
      // Tras traer, contar a la nube qué IDs/versiones emitió el host (así la credencial digital
      // del participante pasa a READY). Si falla, el pull sigue siendo OK y se reintenta en el siguiente.
      result.report = await this.report();
    } catch (e) {
      this.online = false;
      result.error = (e as Error).name === 'AbortError' ? 'tiempo de espera agotado' : (e as Error).message;
      this.log(`Sin conexión a la nube (${result.error})${this.settings.intervalMinutes > 0 ? `, se reintenta en ${this.settings.intervalMinutes} min` : ''}.`);
    }
    this.ctx.meta.set('lastCloudResult', JSON.stringify(result));
    return result;
  }

  /**
   * Reporte host → nube (`POST /api/host-report`, contrato en apps/registration/lib/host-report.ts):
   * por cada credencial cuya persona vino de la nube (`external_id`) manda id corto, versión y estado.
   * - Idempotente: la nube hace upsert por id de inscripción; aquí solo se envían las que cambiaron
   *   desde el último reporte exitoso (`meta.hostReportSent` guarda `{credId: "version:status"}`),
   *   salvo `force`, que reenvía todas.
   * - Tolerante a fallo: sin internet devuelve `ok: false`, no lanza, no toca el estado enviado, y el
   *   siguiente pull (o `force`) lo vuelve a intentar.
   */
  async report(opts: { force?: boolean } = {}): Promise<CloudReportResult> {
    const at = new Date().toISOString();
    const result: CloudReportResult = { at, ok: false, sent: 0 };
    if (!this.configured) { result.error = new CloudNotConfigured().message; return result; }
    const rows = this.ctx.db.prepare(
      'SELECT c.id, c.version, c.status, c.updated_at, p.external_id FROM credentials c JOIN persons p ON p.id = c.person_id WHERE p.external_id IS NOT NULL ORDER BY c.seq'
    ).all() as { id: string; version: number; status: string; updated_at: string; external_id: string }[];
    const sentRaw = this.ctx.meta.get('hostReportSent');
    const sent: Record<string, string> = opts.force || !sentRaw ? {} : (JSON.parse(sentRaw) as Record<string, string>);
    const changed = rows.filter((r) => sent[r.id] !== `${r.version}:${r.status}`);
    result.sent = changed.length;
    if (changed.length === 0) { result.ok = true; this.ctx.meta.set('lastCloudReport', JSON.stringify(result)); return result; }
    const body = {
      hostId: this.ctx.meta.get('hostId') ?? this.ctx.config.eventId, at,
      summary: { scans: this.ctx.scans.count(), credentials: this.ctx.credentials.count() },
      credentials: changed.map((r) => ({ externalId: r.external_id, credentialId: r.id, version: r.version, status: r.status, updatedAt: r.updated_at }))
    };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch(`${this.settings.url}/api/host-report`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-tatami-key': this.settings.key! }, body: JSON.stringify(body), signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`la nube respondió ${res.status}`);
      const j = (await res.json()) as { applied?: number; unknown?: string[] };
      for (const r of changed) sent[r.id] = `${r.version}:${r.status}`;
      this.ctx.meta.set('hostReportSent', JSON.stringify(sent));
      result.ok = true; result.applied = j.applied; result.unknown = j.unknown ?? [];
      this.ctx.audit.append('cloud-sync', 'CLOUD_REPORT', { sent: result.sent, applied: result.applied, unknown: result.unknown.length });
      this.log(`Reporte a la nube: ${result.sent} credenciales, ${result.applied ?? '?'} aplicadas${result.unknown.length ? `, ${result.unknown.length} desconocidas` : ''}.`);
    } catch (e) {
      result.error = (e as Error).name === 'AbortError' ? 'tiempo de espera agotado' : (e as Error).message;
      this.log(`No se pudo reportar a la nube (${result.error}); se reintenta en el siguiente pull.`);
    } finally {
      clearTimeout(t);
    }
    this.ctx.meta.set('lastCloudReport', JSON.stringify(result));
    return result;
  }

  private applyRegistration(reg: CloudRegistration, result: CloudPullResult, companionOf?: string): void {
    const { persons, credentials, config } = this.ctx;
    const existing = persons.byExternalId(reg.id);
    const person: Person = {
      id: existing?.id ?? `cloud_${reg.id}`, firstName: reg.firstName, lastName: reg.lastName, birthDate: reg.birthDate || '1900-01-01',
      documentNumber: reg.documentNumber, club: reg.club, guardian: reg.guardian ?? undefined, source: 'online', externalId: reg.id,
      companionOf: companionOf ?? null, relationship: reg.relationship,
      delegation: reg.delegation, emergencyContact: reg.emergencyContact ?? undefined, eps: reg.eps ?? undefined
    };
    const saved = existing ? persons.updateById(person) : persons.upsert(person);
    let cred = credentials.byPersonId(saved.id);
    const roleCode = companionOf ? COMPANION_ROLE : reg.roleCode;
    if (!cred) {
      const categoryCode = roleCode === 'COMP' && reg.birthDate ? (reg.categoryCode ?? categoryForAge(ageOn(reg.birthDate, config.startDate), config.ageCategories)?.code) : undefined;
      cred = credentials.issue({ person: saved, roleCode, categoryCode, companionOf: companionOf ?? null });
      if (companionOf) result.companionsCreated++; else result.created++;
    } else if (!companionOf) {
      const displayName = `${reg.firstName} ${reg.lastName}`.trim();
      if (cred.displayName !== displayName || (cred.club ?? null) !== (reg.club ?? null) || (reg.categoryCode && cred.categoryCode !== reg.categoryCode)) {
        credentials.updateDetails(cred.id, { displayName, club: reg.club, categoryCode: reg.categoryCode ?? cred.categoryCode });
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
    if (!companionOf) for (const c of reg.companions ?? []) this.applyRegistration(c, result, cred.id);
  }
}
