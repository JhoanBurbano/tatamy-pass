/**
 * Selección de cámara y deduplicación de lecturas. Puro (sin DOM) para poder
 * probarlo en Vitest; `camera.ts` lo usa con los dispositivos reales.
 */
export interface CameraInfo {
  deviceId: string;
  label: string;
}

const BACK_HINTS = ['back', 'rear', 'environment', 'trasera', 'posterior', 'world'];
const FRONT_HINTS = ['front', 'user', 'frontal', 'delantera', 'face'];

/** Puntúa una cámara: mayor = más probable que sea la trasera principal. */
export function scoreBackCamera(cam: CameraInfo, index: number, total: number): number {
  const l = cam.label.toLowerCase();
  let score = 0;
  if (BACK_HINTS.some((h) => l.includes(h))) score += 100;
  if (FRONT_HINTS.some((h) => l.includes(h))) score -= 100;
  // En Android suele haber varias traseras (gran angular, tele, macro): la "0" o
  // la que no dice "wide/ultra/tele/macro" es la principal.
  if (/\b0\b|camera 0|camera2 0/.test(l)) score += 10;
  if (/ultra|wide|tele|macro|depth|zoom/.test(l)) score -= 20;
  // Sin etiquetas (permiso aún no concedido): la última suele ser la trasera.
  if (!l && total > 1 && index === total - 1) score += 5;
  return score;
}

/** Elige la cámara trasera más probable; `undefined` si no hay cámaras. */
export function pickBackCamera(cameras: CameraInfo[]): CameraInfo | undefined {
  if (cameras.length === 0) return undefined;
  let best = cameras[0];
  let bestScore = -Infinity;
  cameras.forEach((c, i) => {
    const s = scoreBackCamera(c, i, cameras.length);
    if (s > bestScore) { best = c; bestScore = s; }
  });
  return best;
}

/** Siguiente cámara en la lista (para el botón "cambiar cámara"). */
export function nextCamera(cameras: CameraInfo[], currentId: string | undefined): CameraInfo | undefined {
  if (cameras.length === 0) return undefined;
  const i = cameras.findIndex((c) => c.deviceId === currentId);
  return cameras[(i + 1) % cameras.length];
}

/**
 * Evita procesar el mismo QR varias veces seguidas mientras sigue delante de la
 * cámara. Devuelve `true` si el código debe procesarse.
 */
export function createDedupe(windowMs = 2500) {
  let lastCode = '';
  let lastAt = -Infinity;
  return {
    accept(code: string, now: number): boolean {
      if (!code) return false;
      if (code === lastCode && now - lastAt < windowMs) return false;
      lastCode = code; lastAt = now;
      return true;
    },
    reset() { lastCode = ''; lastAt = -Infinity; }
  };
}
