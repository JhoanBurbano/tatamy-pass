/**
 * Lectura de QR con la cámara.
 * - `BarcodeDetector` nativo (Chrome Android, Safari 17+) cuando existe.
 * - Fallback `@zxing/browser` (decodificación en JS) cuando no.
 * - Selección de cámara trasera, cambio de cámara, linterna (torch) y enfoque
 *   continuo si el track los soporta.
 * - Anti-doble-lectura: el mismo código no se repite en 2 s.
 */
import { createDedupe, nextCamera, pickBackCamera, type CameraInfo } from './lib/camera-select.js';

interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: ImageBitmapSource): Promise<DetectedBarcode[]> }
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export function hasBarcodeDetector(): boolean {
  return typeof (globalThis as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === 'function';
}

export function hasCamera(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export type CameraEngine = 'native' | 'zxing';

export interface CameraSession {
  stop(): void;
  engine: CameraEngine;
  deviceId?: string;
  torchSupported: boolean;
  setTorch(on: boolean): Promise<boolean>;
}

export async function listCameras(): Promise<CameraInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput').map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

export { nextCamera, pickBackCamera };

export interface StartCameraOptions {
  /** Cámara concreta; si no, se elige la trasera más probable. */
  deviceId?: string;
  dedupeMs?: number;
  /** Fuerza el motor (para pruebas). */
  engine?: CameraEngine;
}

/**
 * Abre la cámara en `video` y llama `onCode` por cada QR nuevo.
 * Evita repetir el mismo código durante `dedupeMs`.
 */
export async function startCamera(video: HTMLVideoElement, onCode: (raw: string) => void, opts: StartCameraOptions = {}): Promise<CameraSession> {
  if (!hasCamera()) throw new Error('Este navegador no da acceso a la cámara (se necesita HTTPS).');
  const engine: CameraEngine = opts.engine ?? (hasBarcodeDetector() ? 'native' : 'zxing');
  const dedupe = createDedupe(opts.dedupeMs ?? 2000);

  let deviceId = opts.deviceId;
  if (!deviceId) {
    // Las etiquetas solo aparecen tras conceder permiso; con una primera
    // apertura por facingMode se obtiene el permiso y luego se elige mejor.
    const cams = await listCameras();
    deviceId = pickBackCamera(cams)?.deviceId;
  }
  const videoConstraints: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
  const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
  const track = stream.getVideoTracks()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
  const torchSupported = caps.torch === true;
  const settings = track?.getSettings?.();
  deviceId = settings?.deviceId ?? deviceId;
  // Enfoque continuo (Android/Chrome): mejora la lectura a 10–20 cm.
  const focusModes = (caps as { focusModes?: string[] }).focusModes;
  if (track && focusModes?.includes('continuous')) {
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }); } catch { /* no soportado */ }
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play();

  let stopped = false;
  let stopEngine: () => void = () => undefined;
  const emit = (raw: string) => { if (!stopped && dedupe.accept(raw, Date.now())) onCode(raw); };

  if (engine === 'native') {
    const Ctor = (globalThis as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
    const detector = new Ctor({ formats: ['qr_code'] });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (stopped) return;
      try {
        if (video.readyState >= 2) {
          const codes = await detector.detect(video);
          for (const c of codes) if (c.rawValue) { emit(c.rawValue); break; }
        }
      } catch {
        /* frame no decodificable */
      }
      timer = setTimeout(loop, 120);
    };
    void loop();
    stopEngine = () => { if (timer) clearTimeout(timer); };
  } else {
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 400 });
    const controls = await reader.decodeFromStream(stream, video, (result) => {
      if (result) emit(result.getText());
    });
    stopEngine = () => controls.stop();
  }

  return {
    engine,
    deviceId,
    torchSupported,
    async setTorch(on: boolean) {
      if (!torchSupported || !track) return false;
      try {
        await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
        return true;
      } catch {
        return false;
      }
    },
    stop() {
      stopped = true;
      stopEngine();
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
  };
}
