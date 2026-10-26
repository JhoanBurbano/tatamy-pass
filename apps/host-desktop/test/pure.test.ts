/**
 * Lógica del proceso principal sin Electron: rutas de datos, ajustes, secretos,
 * red, QR de enrolamiento, guarda de promoción, Caddyfile, estado y logs.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { caddyBinaryPath, dataPaths, nativeBindingPath, platformDir, resourcesDir } from '../src/main/paths.js';
import { DEFAULT_SETTINGS, loadSettings, needsRestart, saveSettings, settingsToEnv, validateSettings } from '../src/main/settings.js';
import { PassphraseStore, type Crypt } from '../src/main/secrets.js';
import { hostUrls, lanAddresses } from '../src/main/lan.js';
import { createEnrollment, enrollQrText, validateEnrollInput } from '../src/main/enroll.js';
import { promoteGuard } from '../src/main/promote-guard.js';
import { renderCaddyfile, CaddyRunner } from '../src/main/caddy.js';
import { buildState } from '../src/main/state.js';
import { LogBuffer } from '../src/main/logs.js';
import type { Settings } from '../src/shared/ipc.js';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'tp-desktop-')); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe('rutas de datos', () => {
  it('todo cuelga de <userData>/tatami', () => {
    const p = dataPaths('/u/data');
    expect(p.root).toBe(join('/u/data', 'tatami'));
    for (const k of ['db', 'keysDir', 'backupsDir', 'configFile', 'logFile', 'settingsFile', 'secretsFile', 'caddyfile', 'rootCert'] as const) expect(p[k].startsWith(p.root)).toBe(true);
    expect(p.rootCert.endsWith(join('pki', 'authorities', 'local', 'root.crt'))).toBe(true);
  });
  it('carpetas por plataforma coinciden con ${os}-${arch} de electron-builder', () => {
    expect(platformDir('darwin', 'arm64')).toBe('mac-arm64');
    expect(platformDir('win32', 'x64')).toBe('win-x64');
    expect(platformDir('linux', 'x64')).toBe('linux-x64');
    expect(caddyBinaryPath('/r', 'win32', 'x64')).toBe(join('/r', 'caddy', 'win-x64', 'caddy.exe'));
    expect(nativeBindingPath('/r', 'darwin', 'arm64')).toBe(join('/r', 'native', 'mac-arm64', 'better_sqlite3.node'));
    expect(resourcesDir(true, '/app/Contents/Resources', '/ws')).toBe('/app/Contents/Resources');
    expect(resourcesDir(false, '/x', '/ws')).toBe(join('/ws', 'resources'));
  });
});

describe('ajustes', () => {
  it('carga valores por defecto si no hay archivo o está roto, e ignora tipos equivocados', () => {
    const f = join(tmp, 's.json');
    expect(loadSettings(f)).toEqual(DEFAULT_SETTINGS);
    writeFileSync(f, '{ esto no es json');
    expect(loadSettings(f)).toEqual(DEFAULT_SETTINGS);
    writeFileSync(f, JSON.stringify({ port: '9999', siteName: 'Coliseo', mode: 'standby', extra: 1 }));
    const s = loadSettings(f);
    expect(s.port).toBe(8787);
    expect(s.siteName).toBe('Coliseo');
    expect(s.mode).toBe('standby');
    expect((s as unknown as Record<string, unknown>).extra).toBeUndefined();
  });
  it('guarda y vuelve a cargar', () => {
    const f = join(tmp, 'dir', 's.json');
    saveSettings(f, { ...DEFAULT_SETTINGS, siteName: 'Sede', setupDone: true });
    expect(loadSettings(f).siteName).toBe('Sede');
  });
  it('valida con mensajes humanos', () => {
    const errs = validateSettings({ ...DEFAULT_SETTINGS, port: 80, mode: 'standby', cloudUrl: 'nube', backupsDir2: join(tmp, 'no-existe') });
    const paths = errs.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['port', 'primaryUrl', 'replicaKey', 'cloudUrl', 'backupsDir2']));
    for (const e of errs) expect(e.message).toMatch(/[a-záéíóú]/i);
    expect(validateSettings({ ...DEFAULT_SETTINGS, httpsPort: 8787 }).map((e) => e.path)).toContain('httpsPort');
    expect(validateSettings({ ...DEFAULT_SETTINGS, mode: 'standby', primaryUrl: 'http://10.10.0.2:8787', replicaKey: 'k' })).toEqual([]);
  });
  it('traduce a las variables que lee apps/host', () => {
    const p = dataPaths(tmp);
    const s: Settings = { ...DEFAULT_SETTINGS, mode: 'standby', primaryUrl: 'http://10.10.0.2:8787/', replicaKey: 'rk', cloudUrl: 'https://n.app', cloudKey: 'ck', backupsDir2: '/media/usb', cloudIntervalMinutes: 0 };
    const env = settingsToEnv(s, p, 'pass', '/res/native/x.node');
    expect(env).toMatchObject({ NODE_ENV: 'production', PORT: '8787', TP_DB_PATH: p.db, TP_KEYS_DIR: p.keysDir, TP_BACKUPS_DIR: p.backupsDir, TP_EVENT_CONFIG: p.configFile, TP_KEY_PASSPHRASE: 'pass', TP_ROLE: 'standby', TP_PRIMARY_URL: 'http://10.10.0.2:8787', TP_REPLICA_KEY: 'rk', TP_CLOUD_URL: 'https://n.app', TP_CLOUD_KEY: 'ck', TP_CLOUD_INTERVAL_MIN: '0', TP_BACKUPS_DIR_2: '/media/usb', TP_SQLITE_NATIVE_BINDING: '/res/native/x.node' });
    const env2 = settingsToEnv({ ...DEFAULT_SETTINGS, eventConfigPath: '/evt.json' }, p, 'pass');
    expect(env2.TP_EVENT_CONFIG).toBe('/evt.json');
    expect(env2.TP_PRIMARY_URL).toBeUndefined();
    expect(env2.TP_SQLITE_NATIVE_BINDING).toBeUndefined();
  });
  it('sabe qué cambios obligan a reiniciar', () => {
    expect(needsRestart(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, siteName: 'x', launchAtLogin: true })).toBe(false);
    expect(needsRestart(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, port: 9000 })).toBe(true);
    expect(needsRestart(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, httpsEnabled: false })).toBe(true);
  });
});

describe('passphrase', () => {
  const fake = (available: boolean): Crypt => ({ available: () => available, encrypt: (p) => Buffer.from(`enc:${p}`), decrypt: (b) => b.toString('utf8').replace(/^enc:/, '') });
  it('usa el llavero cuando está disponible', () => {
    const st = new PassphraseStore(join(tmp, 'k', 'p.enc'), fake(true));
    expect(st.storage()).toBe('none');
    expect(st.get()).toBeNull();
    expect(st.set('una-passphrase-larga')).toBe('safeStorage');
    expect(st.storage()).toBe('safeStorage');
    expect(st.get()).toBe('una-passphrase-larga');
    expect(readFileSync(join(tmp, 'k', 'p.enc'), 'utf8')).not.toContain('una-passphrase-larga');
  });
  it('cae a texto plano si no hay llavero y lo declara', () => {
    const st = new PassphraseStore(join(tmp, 'p.enc'), fake(false));
    expect(st.set('otra-passphrase')).toBe('plain');
    expect(st.storage()).toBe('plain');
    expect(st.get()).toBe('otra-passphrase');
  });
  it('rechaza passphrases cortas', () => {
    expect(() => new PassphraseStore(join(tmp, 'p.enc'), fake(true)).set('corta')).toThrow(/8 caracteres/);
  });
});

describe('red', () => {
  it('lista IPv4 de la LAN, privadas primero, sin loopback ni link-local', () => {
    const ips = lanAddresses({
      lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      eth0: [{ family: 'IPv4', address: '200.1.2.3', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
      wlan0: [{ family: 'IPv4', address: '192.168.1.20', internal: false }],
      usb0: [{ family: 4, address: '169.254.3.4', internal: false }],
      staff: [{ family: 'IPv4', address: '10.10.0.2', internal: false }]
    });
    expect(ips).toEqual(['10.10.0.2', '192.168.1.20', '200.1.2.3']);
  });
  it('arma las URLs según HTTPS', () => {
    expect(hostUrls(['10.10.0.2'], { httpsRunning: true, httpsPort: 8443, port: 8787 })).toEqual(['https://10.10.0.2:8443']);
    expect(hostUrls([], { httpsRunning: false, httpsPort: 8443, port: 8787 })).toEqual(['http://localhost:8787']);
  });
});

describe('enrolamiento', () => {
  const zones = [{ code: 'G', name: 'Gradería' }, { code: 'T', name: 'Tatamis' }];
  it('valida nombre, zona y rol', () => {
    expect(validateEnrollInput(zones, {}).map((e) => e.path)).toEqual(['name', 'zone', 'role']);
    expect(validateEnrollInput(zones, { name: 'Puerta G1', zone: 'X', role: 'CONTROL' }).map((e) => e.path)).toEqual(['zone']);
    expect(validateEnrollInput(zones, { name: 'Puerta G1', zone: 'G', role: 'CONTROL' })).toEqual([]);
  });
  it('genera el mismo QR que el host ({ hostUrl, token }) y audita en el principal', async () => {
    const audits: unknown[] = [];
    const ctx = {
      config: { zones }, mode: 'primary' as const,
      devices: { createEnrollToken: (a: { name: string; zone: string; role: string }) => ({ token: `tok-${a.zone}`, expiresAt: new Date(Date.now() + 600_000).toISOString() }) },
      audit: { append: (actor: string, action: string, payload: unknown) => audits.push({ actor, action, payload }) }
    };
    const r = await createEnrollment(ctx, { name: ' Puerta G1 ', zone: 'G', role: 'CONTROL' }, 'https://10.10.0.2:8443', async (t) => `data:${t}`);
    expect(r.token).toBe('tok-G');
    expect(JSON.parse(r.qrText)).toEqual({ hostUrl: 'https://10.10.0.2:8443', token: 'tok-G' });
    expect(r.qrDataUrl).toBe(`data:${enrollQrText('https://10.10.0.2:8443', 'tok-G')}`);
    expect(audits).toEqual([{ actor: 'desktop', action: 'ENROLL_TOKEN_CREATED', payload: expect.objectContaining({ name: 'Puerta G1', zone: 'G', role: 'CONTROL' }) }]);
    await expect(createEnrollment(ctx, { name: '', zone: 'G', role: 'CONTROL' }, 'http://x')).rejects.toThrow(/nombre/);
  });
  it('produce un PNG real con qrcode', async () => {
    const ctx = { config: { zones }, mode: 'standby' as const, devices: { createEnrollToken: () => ({ token: 'abc', expiresAt: '2026-01-01T00:00:00.000Z' }) }, audit: { append: () => { throw new Error('no debe auditar en standby'); } } };
    const r = await createEnrollment(ctx, { name: 'P', zone: 'T', role: 'SUPERVISOR' }, 'http://h:8787');
    expect(r.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('promover', () => {
  it('exige dos confirmaciones y no promueve al principal', () => {
    expect(promoteGuard('primary', 1, 'SI').ok).toBe(false);
    expect(promoteGuard('standby', 1, 'no')).toMatchObject({ ok: false });
    expect(promoteGuard('standby', 1, ' sí ')).toMatchObject({ ok: true, nextStep: 2 });
    expect(promoteGuard('standby', 2, 'promover')).toMatchObject({ ok: true });
    expect(promoteGuard('standby', 2, 'PROMOVE')).toMatchObject({ ok: false });
  });
});

describe('caddy', () => {
  it('escribe un Caddyfile con tls internal y todas las IPs como SAN', () => {
    const c = renderCaddyfile({ httpsPort: 8443, port: 8787, hosts: ['10.10.0.2', '192.168.1.5', ' '] });
    expect(c).toContain('https://localhost:8443, https://tatami-host.local:8443, https://10.10.0.2:8443, https://192.168.1.5:8443 {');
    expect(c).toContain('tls internal');
    expect(c).toContain('reverse_proxy 127.0.0.1:8787');
    expect(c).toContain('auto_https disable_redirects');
  });
  it('sin binario: no arranca, lo dice y el host sigue en HTTP', () => {
    const logs: string[] = [];
    const r = new CaddyRunner(join(tmp, 'no', 'caddy'), join(tmp, 'Caddyfile'), join(tmp, 'home'), join(tmp, 'root.crt'), (_l, m) => logs.push(m));
    expect(r.start({ httpsPort: 8443, port: 8787, hosts: [] })).toBe(false);
    expect(r.status(8443)).toMatchObject({ running: false, binaryFound: false, rootCertAvailable: false });
    expect(r.status(8443).error).toMatch(/No encuentro Caddy/);
    expect(r.rootCertPath()).toBeNull();
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'root.crt'), 'x');
    expect(r.rootCertPath()).toBe(join(tmp, 'root.crt'));
  });
});

describe('estado para la ventana', () => {
  it('resume host, scanners, copias, nube y HTTPS', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    const ctx = {
      mode: 'primary', configPath: '/evt.json',
      config: { eventId: 'nac2026', name: 'Nacional', startDate: '2026-11-20', endDate: '2026-11-22', zones: [{ code: 'G', name: 'Gradería' }] },
      devices: { all: () => [
        { id: 'd1', name: 'Puerta G1', zone: 'G', role: 'CONTROL', lastSeenAt: new Date(now - 30_000).toISOString(), pendingCount: 3, disabledAt: null },
        { id: 'd2', name: 'Tatamis', zone: 'T', role: 'SUPERVISOR', lastSeenAt: new Date(now - 10 * 60_000).toISOString(), pendingCount: 0, disabledAt: '2026-11-20T09:00:00Z' }
      ] },
      credentials: { count: () => 2000 }, scans: { count: () => 15 }, persons: { count: () => 1800 },
      backups: { status: () => ({ lastBackupAt: '2026-11-20T09:58:00Z', dir: '/b', dir2: '/usb', dir2Available: false, lastBackup2At: null, lastBackup2Error: 'ENOENT', count: 4 }) },
      cloud: { status: () => ({ configured: true, url: 'https://n.app', lastCloudSyncAt: null, intervalMinutes: 5, message: 'Todavía no', online: null }) },
      replica: { status: () => ({ primaryUrl: null, lagSeconds: null, online: null, message: 'Este equipo es el principal.' }) },
      radio: { connected: () => 2 }
    };
    const st = buildState({
      version: '0.2.0', platform: 'linux', settings: { ...DEFAULT_SETTINGS, setupDone: true, siteName: 'Sede' }, ctx: ctx as never, running: true, starting: false, hostError: null,
      lanIps: ['10.10.0.2'], caddy: { running: true, error: null, binaryFound: true, rootCertAvailable: true, port: 8443 }, passphraseSet: true, passphraseStorage: 'safeStorage', dataDir: '/d', now
    });
    expect(st.urls).toEqual(['https://10.10.0.2:8443']);
    expect(st.event).toMatchObject({ id: 'nac2026', name: 'Nacional', configPath: '/evt.json' });
    expect(st.devices.map((d) => [d.online, d.disabled, d.pending])).toEqual([[true, false, 3], [false, true, 0]]);
    expect(st.pendingTotal).toBe(3);
    expect(st.radioConnected).toBe(2);
    expect(st.counts).toEqual({ credentials: 2000, scans: 15, persons: 1800 });
    expect(st.backups).toMatchObject({ dir2: '/usb', dir2Available: false, lastBackup2Error: 'ENOENT', count: 4 });
    expect(st.cloud.configured).toBe(true);
    expect(st.https).toMatchObject({ enabled: true, running: true, rootCertAvailable: true });
  });
  it('sin host: urls http y mensajes de "no está corriendo"', () => {
    const st = buildState({
      version: '0.2.0', platform: 'win32', settings: { ...DEFAULT_SETTINGS, httpsEnabled: false }, ctx: null, running: false, starting: false, hostError: 'El puerto 8787 ya está en uso.',
      lanIps: [], caddy: { running: false, error: null, binaryFound: false, rootCertAvailable: false, port: 8443 }, passphraseSet: false, passphraseStorage: 'none', dataDir: '/d'
    });
    expect(st.urls).toEqual(['http://localhost:8787']);
    expect(st.event).toBeNull();
    expect(st.hostError).toMatch(/puerto/);
    expect(st.cloud.message).toMatch(/no está corriendo/);
  });
});

describe('logs', () => {
  it('conserva las últimas N líneas, avisa a los suscriptores y escribe el archivo', () => {
    const lb = new LogBuffer(3);
    lb.attachFile(join(tmp, 'logs', 'host.log'));
    const seen: string[] = [];
    const off = lb.subscribe((l) => seen.push(l));
    for (let i = 1; i <= 5; i++) lb.push('info', `línea ${i}`, { n: i });
    off();
    lb.push('error', new Error('boom'));
    expect(lb.all().map((l) => l.slice(11))).toEqual(['línea 4 {"n":4}', 'línea 5 {"n":5}', 'boom']);
    expect(seen).toHaveLength(5);
    expect(readFileSync(join(tmp, 'logs', 'host.log'), 'utf8').split('\n').filter(Boolean)).toHaveLength(6);
  });
});
