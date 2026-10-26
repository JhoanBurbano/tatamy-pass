/**
 * Arma el `DesktopState` que ve la ventana a partir del host en marcha, los
 * ajustes y Caddy. Función pura sobre el contexto del host (se prueba con un
 * contexto falso).
 */
import type { DesktopState, DeviceSummary, Settings } from '../shared/ipc.js';
import { hostUrls } from './lan.js';
import type { CaddyStatus } from './caddy.js';
import type { HostContext } from './host-runner.js';

export interface StateInput {
  version: string;
  platform: NodeJS.Platform;
  settings: Settings;
  ctx: HostContext | null;
  running: boolean;
  starting: boolean;
  hostError: string | null;
  lanIps: string[];
  caddy: CaddyStatus;
  passphraseSet: boolean;
  passphraseStorage: DesktopState['passphraseStorage'];
  dataDir: string;
  now?: number;
}

const OFFLINE_MS = 5 * 60_000;

export function buildState(i: StateInput): DesktopState {
  const s = i.settings;
  const ctx = i.ctx;
  const httpsRunning = s.httpsEnabled && i.caddy.running;
  const devices: DeviceSummary[] = ctx ? ctx.devices.all().map((d) => ({
    id: d.id, name: d.name, zone: d.zone, role: d.role, lastSeenAt: d.lastSeenAt ?? null, pending: d.pendingCount ?? 0,
    online: Boolean(d.lastSeenAt && (i.now ?? Date.now()) - Date.parse(d.lastSeenAt) < OFFLINE_MS), disabled: Boolean(d.disabledAt)
  })) : [];
  const backups = ctx?.backups.status();
  const cloud = ctx?.cloud.status();
  const rep = ctx?.replica.status();
  return {
    version: i.version,
    platform: i.platform,
    setupDone: s.setupDone,
    running: i.running,
    starting: i.starting,
    hostError: i.hostError,
    mode: ctx?.mode ?? s.mode,
    port: s.port,
    lanIps: i.lanIps,
    urls: hostUrls(i.lanIps, { httpsRunning, httpsPort: s.httpsPort, port: s.port }),
    https: { enabled: s.httpsEnabled, running: i.caddy.running, port: s.httpsPort, rootCertAvailable: i.caddy.rootCertAvailable, error: i.caddy.error, binaryFound: i.caddy.binaryFound },
    event: ctx ? { id: ctx.config.eventId, name: ctx.config.name, startDate: ctx.config.startDate, endDate: ctx.config.endDate, configPath: ctx.configPath ?? '', zones: ctx.config.zones.map((z) => ({ code: z.code, name: z.name })) } : null,
    devices,
    pendingTotal: devices.reduce((n, d) => n + d.pending, 0),
    radioConnected: ctx?.radio?.connected() ?? 0,
    counts: ctx ? { credentials: ctx.credentials.count(), scans: ctx.scans.count(), persons: ctx.persons.count() } : { credentials: 0, scans: 0, persons: 0 },
    backups: backups
      ? { lastBackupAt: backups.lastBackupAt, dir: backups.dir, dir2: backups.dir2, dir2Available: backups.dir2Available, lastBackup2At: backups.lastBackup2At, lastBackup2Error: backups.lastBackup2Error, count: backups.count }
      : { lastBackupAt: null, dir: '', dir2: s.backupsDir2 || null, dir2Available: false, lastBackup2At: null, lastBackup2Error: null, count: 0 },
    cloud: cloud
      ? { configured: cloud.configured, url: cloud.url, lastCloudSyncAt: cloud.lastCloudSyncAt, intervalMinutes: cloud.intervalMinutes, message: cloud.message, online: cloud.online }
      : { configured: Boolean(s.cloudUrl && s.cloudKey), url: s.cloudUrl || null, lastCloudSyncAt: null, intervalMinutes: s.cloudIntervalMinutes, message: 'El host no está corriendo.', online: null },
    replica: rep
      ? { primaryUrl: rep.primaryUrl, lagSeconds: rep.lagSeconds, online: rep.online, message: rep.message }
      : { primaryUrl: s.primaryUrl || null, lagSeconds: null, online: null, message: '' },
    passphraseSet: i.passphraseSet,
    passphraseStorage: i.passphraseStorage,
    dataDir: i.dataDir,
    siteName: s.siteName
  };
}
