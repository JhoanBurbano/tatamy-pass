/**
 * Instalación y actualización de la PWA (§7).
 * - Registra `sw.js` (solo en build) y avisa cuando hay una versión nueva en
 *   espera: la UI muestra "Hay una versión nueva · Actualizar"; al tocar se
 *   manda `SKIP_WAITING` y se recarga cuando el nuevo SW toma el control.
 * - Captura `beforeinstallprompt` (Android/Chrome) para ofrecer "Instalar".
 * - Detecta plataforma y si ya corre instalada (standalone).
 */
type Listener<T> = (v: T) => void;

export type Platform = 'android' | 'ios' | 'desktop' | 'other';

export function detectPlatform(ua: string = navigator.userAgent): Platform {
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'other';
}

export function isStandalone(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || false;
  } catch {
    return false;
  }
}

export function isSecureForCamera(): boolean {
  try { return window.isSecureContext; } catch { return false; }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | undefined;
const installListeners = new Set<Listener<boolean>>();
const updateListeners = new Set<Listener<boolean>>();
let waiting: ServiceWorker | undefined;
let registration: ServiceWorkerRegistration | undefined;

export function canPromptInstall(): boolean {
  return !!deferredPrompt;
}

export function onInstallAvailable(fn: Listener<boolean>): () => void {
  installListeners.add(fn);
  fn(canPromptInstall());
  return () => installListeners.delete(fn);
}

export function onUpdateAvailable(fn: Listener<boolean>): () => void {
  updateListeners.add(fn);
  fn(!!waiting);
  return () => updateListeners.delete(fn);
}

/** Lanza el diálogo nativo de instalación (Android/Chrome). */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const ev = deferredPrompt;
  deferredPrompt = undefined;
  for (const l of installListeners) l(false);
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    return choice.outcome;
  } catch {
    return 'dismissed';
  }
}

/** Aplica la versión nueva: el SW en espera toma el control y la página se recarga. */
export function applyUpdate(): void {
  if (!waiting) { location.reload(); return; }
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export async function checkForUpdate(): Promise<void> {
  try { await registration?.update(); } catch { /* sin red */ }
}

function setWaiting(sw: ServiceWorker | undefined) {
  waiting = sw;
  for (const l of updateListeners) l(!!sw);
}

export function setupPwa(opts: { register?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    for (const l of installListeners) l(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    for (const l of installListeners) l(false);
  });

  if (!opts.register || !('serviceWorker' in navigator)) return;
  // Solo se recarga cuando una versión NUEVA toma el control (tras "Actualizar");
  // la primera instalación (clients.claim) no debe interrumpir lo que el operador hace.
  let hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(nw);
        });
      });
      // Comprueba actualizaciones cada hora (entre escaneos la UI avisa).
      setInterval(() => void reg.update().catch(() => undefined), 60 * 60_000);
    }).catch(() => undefined);
  });
}
