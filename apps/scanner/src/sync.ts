/**
 * Sync con el host por fetch (polling cada 15 s, con reintentos exponenciales).
 * - Sube escaneos pendientes en lotes idempotentes.
 * - Baja escaneos de otras puertas (para anti-passback y duplicados).
 * - Refresca el snapshot (credenciales, revocaciones, config) cada 5 min y
 *   siempre que se recupera la conexión (así una revocación hecha mientras el
 *   scanner estaba sin red llega en el primer tick tras reconectar).
 * - Mide la deriva de reloj contra `serverTime` y la expone en el estado.
 */
import { sha256Hex, type Credential, type EventConfig, type RevocationEntry, type ScanEvent } from '@tatami/core';
import { db, getDevice, getSetting, pendingScans, replaceSnapshot, setSetting, type DeviceSettings } from './db.js';
import { estimateSkewMs } from './lib/clock.js';
import { prefetchPhotos } from './lib/photo-cache.js';

export type ConnectionState = 'online' | 'offline' | 'syncing';

export interface SyncStatus {
  state: ConnectionState;
  pending: number;
  lastSyncAt?: string;
  lastError?: string;
  snapshotAt?: string;
  credentials: number;
  /** Host − dispositivo, en ms (positivo = el dispositivo va atrasado). */
  skewMs?: number;
  hostUrl?: string;
}

type Listener = (s: SyncStatus) => void;

export const SNAPSHOT_TTL_MS = 5 * 60_000;
export const POLL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8000;

export class SyncClient {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private backoffMs = POLL_MS;
  private nextRetryAt: number | undefined;
  private wasOffline = false;
  private inFlight: Promise<void> | undefined;
  status: SyncStatus = { state: 'offline', pending: 0, credentials: 0 };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private emit(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  async refreshCounters() {
    const pending = await db.scans.where('synced').equals(0).count();
    const credentials = await db.credentials.count();
    const snapshotAt = await getSetting<string>('snapshotAt');
    const skewMs = await getSetting<number>('clockSkewMs');
    const dev = await getDevice();
    this.emit({ pending, credentials, snapshotAt, skewMs, hostUrl: dev?.hostUrl });
  }

  start() {
    this.stop();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
  }

  private onOnline = () => void this.tick(true);

  /** Un ciclo de sync. `force` ignora el backoff y refresca el snapshot. */
  tick(force = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run(force).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async run(force: boolean) {
    const dev = await getDevice();
    if (!dev) return;
    if (!force && this.backoffMs > POLL_MS && Date.now() < (this.nextRetryAt ?? 0)) return;
    this.emit({ state: 'syncing' });
    try {
      await this.pushPending(dev);
      await this.pullEvents(dev);
      const snapshotAt = await getSetting<string>('snapshotAt');
      const stale = !snapshotAt || Date.now() - Date.parse(snapshotAt) > SNAPSHOT_TTL_MS;
      if (force || stale || this.wasOffline) await this.pullSnapshot(dev);
      this.backoffMs = POLL_MS;
      this.wasOffline = false;
      this.emit({ state: 'online', lastSyncAt: new Date().toISOString(), lastError: undefined });
    } catch (e) {
      this.backoffMs = Math.min(this.backoffMs * 2, 2 * 60_000);
      this.nextRetryAt = Date.now() + this.backoffMs;
      this.wasOffline = true;
      this.emit({ state: 'offline', lastError: (e as Error).message });
    } finally {
      await this.refreshCounters();
    }
  }

  private async api<T>(dev: DeviceSettings, path: string, init: RequestInit = {}): Promise<{ body: T; sentAt: number; receivedAt: number }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const sentAt = Date.now();
    try {
      const res = await fetch(`${dev.hostUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${dev.deviceToken}`, ...(init.headers ?? {}) }
      });
      if (!res.ok) throw new Error(`Host respondió ${res.status}`);
      return { body: (await res.json()) as T, sentAt, receivedAt: Date.now() };
    } finally {
      clearTimeout(t);
    }
  }

  async pushPending(dev: DeviceSettings) {
    const pending = await pendingScans();
    for (let i = 0; i < pending.length; i += 200) {
      const batch = pending.slice(i, i + 200).map(({ synced: _s, ...e }) => e);
      await this.api(dev, '/sync/events', { method: 'POST', body: JSON.stringify({ events: batch }) });
      await db.scans.bulkPut(batch.map((e) => ({ ...e, synced: 1 as const })));
    }
  }

  async pullEvents(dev: DeviceSettings) {
    const since = await getSetting<string>('eventsCursor');
    const res = await this.api<{ events: ScanEvent[]; cursor: string | null }>(dev, `/sync/events?since=${encodeURIComponent(since ?? '')}&limit=5000`);
    const foreign = res.body.events.filter((e) => e.deviceId !== dev.deviceId);
    if (foreign.length) {
      await db.scans.bulkPut(foreign.map((e) => ({ ...e, synced: 1 as const })));
    }
    if (res.body.cursor) await setSetting('eventsCursor', res.body.cursor);
  }

  async pullSnapshot(dev: DeviceSettings) {
    const res = await this.api<{ config: EventConfig; credentials: Credential[]; revocations: RevocationEntry[]; serverTime: string }>(dev, '/sync/snapshot');
    await replaceSnapshot(res.body);
    await setSetting('clockSkewMs', estimateSkewMs(res.body.serverTime, res.sentAt, res.receivedAt));
    // Fotos a la caché en segundo plano (solo en el navegador; no bloquea el sync).
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const urls = res.body.credentials.map((c) => c.photoUrl).filter((u): u is string => !!u);
      void prefetchPhotos(urls, { concurrency: 3 }).catch(() => undefined);
    }
  }
}

export const syncClient = new SyncClient();

function hostError(body: { error?: string }, status: number): string {
  return body.error ?? `El host respondió ${status}`;
}

/** Enrola el dispositivo contra el host. */
export async function enrollDevice(hostUrl: string, enrollToken: string, pin: string): Promise<DeviceSettings> {
  const res = await fetch(`${hostUrl.replace(/\/$/, '')}/devices/enroll`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: enrollToken, pin })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(hostError(body, res.status));
  const settings: DeviceSettings = {
    hostUrl: hostUrl.replace(/\/$/, ''), deviceId: body.deviceId, deviceToken: body.deviceToken, name: body.name,
    zone: body.zone, role: body.role, pinHash: sha256Hex(`tatami:${pin}`), enrolledAt: body.enrolledAt
  };
  await setSetting('device', settings);
  return settings;
}

/** Comprueba que una URL responde como host de Tatami Pass (`/health`). */
export async function checkHost(hostUrl: string): Promise<{ ok: true; event: string } | { ok: false; error: string }> {
  const url = hostUrl.replace(/\/$/, '');
  if (!/^https?:\/\//.test(url)) return { ok: false, error: 'La dirección debe empezar por http:// o https://' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, error: `El host respondió ${res.status}` };
    const body = (await res.json()) as { ok?: boolean; event?: string };
    if (!body.ok) return { ok: false, error: 'Esa dirección no es un host de Tatami Pass.' };
    return { ok: true, event: body.event ?? '' };
  } catch (e) {
    return { ok: false, error: `No se pudo conectar: ${(e as Error).message}` };
  } finally {
    clearTimeout(t);
  }
}

/** Cambia la dirección del host (p. ej. para apuntar al standby). Se valida con `/health`. */
export async function changeHostUrl(dev: DeviceSettings, hostUrl: string): Promise<DeviceSettings> {
  const check = await checkHost(hostUrl);
  if (!check.ok) throw new Error(check.error);
  const next = { ...dev, hostUrl: hostUrl.replace(/\/$/, '') };
  await setSetting('device', next);
  try { localStorage.setItem('tp.hostUrl', next.hostUrl); } catch { /* sin almacenamiento */ }
  return next;
}

/**
 * Autorización de supervisor validada por el host: usuario + PIN/contraseña
 * contra `POST /auth/login`; solo roles SUPERVISOR o ADMIN autorizan.
 * Sin conexión con el host no hay autorización (es una decisión de seguridad).
 */
export async function verifySupervisor(hostUrl: string, username: string, secret: string): Promise<{ ok: true; username: string; role: string } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${hostUrl.replace(/\/$/, '')}/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: secret }), signal: ctrl.signal
    });
    const body = await res.json().catch(() => ({})) as { error?: string; user?: { username: string; role: string } };
    if (!res.ok) return { ok: false, error: res.status === 401 ? 'Usuario o PIN de supervisor incorrectos.' : hostError(body, res.status) };
    const role = body.user?.role ?? '';
    if (role !== 'SUPERVISOR' && role !== 'ADMIN') return { ok: false, error: `El usuario ${body.user?.username ?? username} no es supervisor.` };
    return { ok: true, username: body.user!.username, role };
  } catch (e) {
    return { ok: false, error: `Sin conexión con el host: ${(e as Error).message}. Solo el host puede autorizar este cambio.` };
  } finally {
    clearTimeout(t);
  }
}
