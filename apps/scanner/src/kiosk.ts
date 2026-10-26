/**
 * Modo kiosk: pantalla completa, bloqueo del botón "atrás" y wake lock para
 * que la pantalla no se apague durante el turno.
 */
const KEY = 'tp.kiosk';

export function kioskEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setKioskEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* sin almacenamiento */ }
}

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener?(type: 'release', fn: () => void): void };

let wakeLock: WakeLockSentinelLike | undefined;
let backLockInstalled = false;
let visibilityHandler: (() => void) | undefined;

export async function requestWakeLock(): Promise<boolean> {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
  if (!nav.wakeLock) return false;
  try {
    wakeLock = await nav.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => { wakeLock = undefined; });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try { await wakeLock?.release(); } catch { /* ya liberado */ }
  wakeLock = undefined;
}

export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (document.fullscreenElement) return true;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* nada */ }
}

/** El botón atrás no saca de la app: se re-empuja el estado y se avisa. */
function installBackLock(onBack: () => void) {
  if (backLockInstalled) return;
  backLockInstalled = true;
  history.pushState({ tpKiosk: true }, '', location.href);
  window.addEventListener('popstate', () => {
    if (!kioskEnabled()) return;
    history.pushState({ tpKiosk: true }, '', location.href);
    onBack();
  });
}

export interface KioskStatus { fullscreen: boolean; wakeLock: boolean }

/** Activa todo lo que el navegador permita. Debe llamarse desde un gesto del usuario. */
export async function enableKiosk(onBack: () => void = () => undefined): Promise<KioskStatus> {
  setKioskEnabled(true);
  installBackLock(onBack);
  const fullscreen = await enterFullscreen();
  const lock = await requestWakeLock();
  if (!visibilityHandler) {
    visibilityHandler = () => { if (document.visibilityState === 'visible' && kioskEnabled()) void requestWakeLock(); };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
  return { fullscreen, wakeLock: lock };
}

export async function disableKiosk(): Promise<void> {
  setKioskEnabled(false);
  await exitFullscreen();
  await releaseWakeLock();
}

export function kioskStatus(): KioskStatus {
  return { fullscreen: !!document.fullscreenElement, wakeLock: !!wakeLock };
}
