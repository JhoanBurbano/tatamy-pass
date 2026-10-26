/**
 * Proceso principal de "Tatami Pass Host": una ventana (900×640), icono en la
 * bandeja, el host corriendo en este mismo proceso y Caddy como auxiliar para
 * HTTPS. Aquí solo hay cableado (Electron + IPC); la lógica vive en los módulos
 * de al lado y se prueba sin Electron.
 *
 * Variables útiles: TP_DESKTOP_USER_DATA (otra carpeta de datos: permite correr
 * principal y respaldo en el mismo equipo para probar), TP_DESKTOP_SMOKE=1
 * (arranca, comprueba /health y sale: lo usa scripts/smoke.mjs).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, safeStorage, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopState, EnrollInput, Settings, SetupInput, TpApi } from '../shared/ipc.js';
import { CaddyRunner } from './caddy.js';
import { createEnrollment } from './enroll.js';
import { HostRunner } from './host-runner.js';
import { lanAddresses } from './lan.js';
import { LogBuffer } from './logs.js';
import { caddyBinaryPath, dataPaths, nativeBindingPath, resourcesDir, type DataPaths } from './paths.js';
import { promoteGuard } from './promote-guard.js';
import { PassphraseStore } from './secrets.js';
import { loadSettings, needsRestart, saveSettings, validateSettings, DEFAULT_SETTINGS } from './settings.js';
import { buildState } from './state.js';

const APP_NAME = 'Tatami Pass Host';
const WINDOW = { width: 900, height: 640 };
const VERSION = (() => { try { return (JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { version: string }).version; } catch { return app.getVersion(); } })();

if (process.env.TP_DESKTOP_USER_DATA) app.setPath('userData', process.env.TP_DESKTOP_USER_DATA);
app.setName(APP_NAME);

const single = app.requestSingleInstanceLock();
if (!single) app.quit();

const logs = new LogBuffer(200);
logs.captureConsole();

let paths: DataPaths;
let settings: Settings;
let secrets: PassphraseStore;
let runner: HostRunner;
let caddy: CaddyRunner;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let resources: string;

function appRoot(): string { return app.getAppPath(); }

// ---------- host + caddy ----------
async function startHost(): Promise<void> {
  if (!settings.setupDone) return;
  const pass = secrets.get();
  if (!pass) { runner.error = 'Falta la passphrase de las claves. Ponla en Ajustes.'; logs.push('warn', runner.error); return; }
  const native = nativeBindingPath(resources, process.platform, process.arch);
  if (!existsSync(native)) logs.push('warn', `No encuentro el binario de SQLite para Electron en ${native}; intento con el de Node (puede fallar). Ver docs/86 §7.`);
  await runner.start(settings, paths, pass, existsSync(native) ? native : undefined);
  startCaddy();
}

function startCaddy(): void {
  caddy.stop();
  if (!settings.httpsEnabled || !runner.running) return;
  caddy.start({ httpsPort: settings.httpsPort, port: settings.port, hosts: lanAddresses() });
}

async function restartHost(): Promise<void> {
  caddy.stop();
  await runner.stop();
  await startHost().catch(() => undefined);
  broadcast();
}

function currentState(): DesktopState {
  return buildState({
    version: VERSION, platform: process.platform, settings, ctx: runner.ctx, running: runner.running, starting: runner.starting, hostError: runner.error,
    lanIps: lanAddresses(), caddy: caddy.status(settings.httpsPort), passphraseSet: secrets.storage() !== 'none', passphraseStorage: secrets.storage(), dataDir: paths.root
  });
}

function broadcast(): void {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send('tp:state', currentState()); } catch { /* ventana cerrándose */ }
  updateTray();
}

function primaryUrl(): string {
  const st = currentState();
  return st.urls[0] ?? `http://localhost:${settings.port}`;
}

// ---------- ventana ----------
function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: WINDOW.width, height: WINDOW.height, minWidth: 820, minHeight: 560, title: APP_NAME, show: false,
    backgroundColor: '#F6F8FB', autoHideMenuBar: true,
    icon: join(resources, 'icons', 'icon.png'),
    webPreferences: { preload: join(appRoot(), 'dist', 'preload', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  w.loadFile(join(appRoot(), 'dist', 'renderer', 'index.html'));
  w.once('ready-to-show', () => { w.show(); broadcast(); });
  w.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide();
    if (process.platform === 'darwin') app.dock?.hide();
  });
  w.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' }; });
  return w;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) win = createWindow();
  else { win.show(); win.focus(); }
  if (process.platform === 'darwin') void app.dock?.show();
}

// ---------- bandeja ----------
function trayIcon(): Electron.NativeImage {
  const file = join(resources, 'icons', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  const img = existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function updateTray(): void {
  if (!tray) return;
  const st = currentState();
  const status = !st.setupDone ? 'Falta configurar' : st.running ? `Host corriendo · ${st.mode === 'primary' ? 'principal' : 'respaldo'} · ${st.devices.filter((d) => d.online).length} scanners` : st.starting ? 'Arrancando…' : `Host detenido${st.hostError ? ` · ${st.hostError}` : ''}`;
  tray.setToolTip(`${APP_NAME}\n${status}`);
  const items: MenuItemConstructorOptions[] = [
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Abrir ventana', click: () => showWindow() },
    { label: 'Abrir panel', enabled: st.running, click: () => void shell.openExternal(`${primaryUrl()}/admin`) },
    { label: 'Hacer copia ahora', enabled: st.running && st.mode === 'primary', click: () => void runner.backupNow().then((m) => logs.push('info', m)).catch((e: Error) => logs.push('error', e.message)) },
    { label: 'Traer de la nube ahora', enabled: st.running && st.cloud.configured && st.mode === 'primary', click: () => void runner.cloudPullNow().then((m) => logs.push('info', m)).catch((e: Error) => logs.push('error', e.message)) },
    { type: 'separator' },
    { label: 'Salir', click: () => void requestQuit() }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

async function requestQuit(): Promise<boolean> {
  const st = currentState();
  const online = st.devices.filter((d) => d.online).length;
  if (st.running && online > 0) {
    const r = await dialog.showMessageBox({
      type: 'warning', buttons: ['Seguir corriendo', 'Salir de todos modos'], defaultId: 0, cancelId: 0, title: 'Hay scanners conectados',
      message: `${online} scanner${online === 1 ? '' : 's'} ${online === 1 ? 'está conectado' : 'están conectados'} a este host.`,
      detail: 'Si sales, los scanners siguen validando con su copia local, pero dejan de enviar pendientes hasta que vuelvas a abrir la app.'
    });
    if (r.response === 0) return false;
  }
  quitting = true;
  app.quit();
  return true;
}

// ---------- IPC ----------
function pickFolder(title: string): Promise<string | null> {
  return dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] }).then((r) => (r.canceled ? null : r.filePaths[0] ?? null));
}

function pickFile(title: string): Promise<string | null> {
  return dialog.showOpenDialog({ title, properties: ['openFile'], filters: [{ name: 'Archivo de evento', extensions: ['json'] }] }).then((r) => (r.canceled ? null : r.filePaths[0] ?? null));
}

function ok(message: string) { return { ok: true, message }; }
function fail(e: unknown) { return { ok: false, message: (e as Error).message ?? String(e) }; }

function registerIpc(): void {
  const handle = <K extends keyof TpApi>(name: K, fn: (...args: Parameters<TpApi[K]>) => ReturnType<TpApi[K]>) => {
    ipcMain.handle(`tp:${name}`, (_e, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args));
  };

  handle('getState', async () => currentState());
  handle('getLogs', async () => logs.all());
  handle('openPanel', async () => { await shell.openExternal(`${primaryUrl()}/admin`); });
  handle('openPath', async (p) => { await shell.openPath(p); });
  handle('chooseFolder', (title) => pickFolder(title));
  handle('chooseFile', (title) => pickFile(title));
  handle('getSettings', async () => ({ ...settings }));
  handle('quit', async () => { await requestQuit(); });
  handle('restartHost', async () => { try { await restartHost(); return ok(runner.running ? 'Host reiniciado.' : runner.error ?? 'El host no arrancó.'); } catch (e) { return fail(e); } });

  handle('createEnrollment', async (input: EnrollInput) => {
    const ctx = runner.ctx;
    if (!ctx) return { error: 'El host no está corriendo.' };
    try { return await createEnrollment(ctx, input, primaryUrl()); } catch (e) { return { error: (e as Error).message }; }
  });

  handle('backupNow', async () => { try { const m = await runner.backupNow(); logs.push('info', m); broadcast(); return ok(m); } catch (e) { return fail(e); } });
  handle('backupToUsb', async () => {
    const dir = await pickFolder('Elige la carpeta de la USB para la copia');
    if (!dir) return { ok: false, message: 'No elegiste carpeta.' };
    try { const m = await runner.backupTo(dir); logs.push('info', m); broadcast(); return ok(m); } catch (e) { return fail(e); }
  });
  handle('cloudPullNow', async () => { try { const m = await runner.cloudPullNow(); logs.push('info', m); broadcast(); return ok(m); } catch (e) { return fail(e); } });

  handle('promote', async (step, text) => {
    const g = promoteGuard(runner.ctx?.mode ?? settings.mode, step, text);
    if (!g.ok || step === 1) return { ...g, step: g.nextStep };
    try {
      const m = await runner.promote();
      settings = { ...settings, mode: 'primary' };
      saveSettings(paths.settingsFile, settings);
      broadcast();
      return ok(m);
    } catch (e) { return fail(e); }
  });

  handle('changeEventFile', async () => {
    const file = await pickFile('Elige el archivo event.config.json del evento');
    if (!file) return { ok: false, message: 'No elegiste archivo.' };
    try {
      JSON.parse(readFileSync(file, 'utf8'));
    } catch { return { ok: false, message: 'Ese archivo no es un JSON válido. Revisa docs/32 o exporta la config desde el panel.' }; }
    settings = { ...settings, eventConfigPath: file };
    saveSettings(paths.settingsFile, settings);
    await restartHost();
    return ok(runner.running ? `Evento cargado desde ${file}.` : runner.error ?? 'El host no arrancó con ese archivo.');
  });

  handle('exportRootCert', async () => {
    const cert = caddy.rootCertPath();
    if (!cert) return { ok: false, message: 'Todavía no hay certificado: activa HTTPS en Ajustes y espera a que Caddy arranque.' };
    const r = await dialog.showSaveDialog({ title: 'Guardar certificado raíz', defaultPath: 'tatami-pass-root.crt', filters: [{ name: 'Certificado', extensions: ['crt', 'pem'] }] });
    if (r.canceled || !r.filePath) return { ok: false, message: 'No elegiste dónde guardarlo.' };
    try { copyFileSync(cert, r.filePath); return ok(`Certificado guardado en ${r.filePath}. Pásalo a cada celular e instálalo (instrucciones en pantalla).`); } catch (e) { return fail(e); }
  });

  handle('saveSettings', async (patch: Partial<Settings>) => {
    const next: Settings = { ...settings, ...patch, version: 1 };
    const errors = validateSettings(next);
    if (errors.length) return { ok: false, errors, restarted: false };
    const restart = needsRestart(settings, next);
    settings = next;
    saveSettings(paths.settingsFile, settings);
    try { app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, openAsHidden: true }); } catch { /* linux sin soporte */ }
    if (restart && settings.setupDone) await restartHost();
    broadcast();
    return { ok: true, errors: [], restarted: restart };
  });

  handle('setPassphrase', async (p: string) => {
    try {
      const storage = secrets.set(p);
      logs.push('info', storage === 'safeStorage' ? 'Passphrase guardada en el llavero del sistema.' : 'Passphrase guardada en el disco (sin llavero del sistema): protege esta carpeta.');
      if (settings.setupDone) await restartHost();
      return ok('Passphrase guardada. Recuerda: sin ella no se puede firmar ni leer los datos personales. Guárdala en el sobre del Administrador.');
    } catch (e) { return fail(e); }
  });

  handle('runSetup', (input: SetupInput) => applySetup(input));
}

async function applySetup(input: SetupInput): Promise<{ ok: boolean; errors: { path: string; message: string }[]; message?: string }> {
  const next: Settings = {
    ...DEFAULT_SETTINGS, ...settings, siteName: input.siteName.trim(), mode: input.mode, primaryUrl: input.primaryUrl.trim(), replicaKey: input.replicaKey.trim(),
    eventConfigPath: input.eventSource === 'file' ? input.eventConfigPath.trim() : '', backupsDir2: input.backupsDir2.trim(), setupDone: true
  };
  const errors = validateSettings(next);
  if (!next.siteName) errors.push({ path: 'siteName', message: 'Ponle un nombre a la sede (p. ej. "Coliseo La Estancia").' });
  if (input.eventSource === 'file' && !next.eventConfigPath) errors.push({ path: 'eventConfigPath', message: 'Elige el archivo event.config.json o usa el evento de demo.' });
  if (input.passphrase.length < 8) errors.push({ path: 'passphrase', message: 'La passphrase debe tener al menos 8 caracteres (mejor 20 o más).' });
  if (errors.length) return { ok: false, errors };
  try {
    secrets.set(input.passphrase);
    settings = next;
    saveSettings(paths.settingsFile, settings);
    await restartHost();
    if (!runner.running) return { ok: false, errors: [{ path: 'host', message: runner.error ?? 'El host no arrancó.' }] };
    let message = 'Listo. El host está corriendo.';
    if (input.eventSource === 'demo' && runner.ctx?.mode === 'primary') message = await runner.seedDemo();
    logs.push('info', message);
    broadcast();
    return { ok: true, errors: [], message };
  } catch (e) { return { ok: false, errors: [{ path: 'host', message: (e as Error).message }] }; }
}

// ---------- arranque ----------
app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { caddy?.stop(); });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { quitting = true; caddy?.stop(); app.quit(); });
app.on('window-all-closed', () => { /* seguimos en la bandeja */ });
app.on('activate', () => showWindow());

void app.whenReady().then(async () => {
  resources = resourcesDir(app.isPackaged, process.resourcesPath, appRoot());
  paths = dataPaths(app.getPath('userData'));
  mkdirSync(paths.root, { recursive: true });
  logs.attachFile(paths.logFile);
  settings = loadSettings(paths.settingsFile);
  secrets = new PassphraseStore(paths.secretsFile, {
    available: () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } },
    encrypt: (p) => safeStorage.encryptString(p),
    decrypt: (b) => safeStorage.decryptString(b)
  });
  runner = new HostRunner({ log: (l, m) => logs.push(l, m) });
  caddy = new CaddyRunner(caddyBinaryPath(resources, process.platform, process.arch), paths.caddyfile, paths.caddyHome, paths.rootCert, (l, m) => logs.push(l, m));
  logs.push('info', `${APP_NAME} ${VERSION} · datos en ${paths.root}`);

  registerIpc();
  logs.subscribe((line) => { if (win && !win.isDestroyed()) { try { win.webContents.send('tp:log', line); } catch { /* */ } } });

  try { tray = new Tray(trayIcon()); tray.on('click', () => showWindow()); } catch (e) { logs.push('warn', `Sin icono de bandeja: ${(e as Error).message}`); }
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: APP_NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { label: 'Salir', accelerator: 'Cmd+Q', click: () => void requestQuit() }] }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  else Menu.setApplicationMenu(null);

  await startHost().catch(() => undefined);
  const openHidden = process.argv.includes('--hidden') || (app.getLoginItemSettings().wasOpenedAsHidden ?? false);
  if (!openHidden) showWindow(); else updateTray();
  setInterval(broadcast, 3000).unref();

  if (process.env.TP_DESKTOP_SMOKE) {
    if (!settings.setupDone) {
      const r = await applySetup({ siteName: 'Sede de prueba', mode: 'primary', primaryUrl: '', replicaKey: '', passphrase: process.env.TP_KEY_PASSPHRASE ?? 'smoke-passphrase-1234', eventSource: 'demo', eventConfigPath: '', backupsDir2: '' });
      logs.push(r.ok ? 'info' : 'error', `Smoke setup: ${r.ok ? r.message : r.errors.map((e) => e.message).join('; ')}`);
    }
    const st = currentState();
    const health = runner.running ? await fetch(`http://127.0.0.1:${settings.port}/health`).then((r) => r.json()).catch((e: Error) => ({ error: e.message })) : null;
    process.stdout.write(`SMOKE ${JSON.stringify({ running: st.running, mode: st.mode, setupDone: st.setupDone, hostError: st.hostError, https: st.https, health })}\n`);
    quitting = true;
    setTimeout(() => app.exit(runner.running || !st.setupDone ? 0 : 1), 500);
  }
});
