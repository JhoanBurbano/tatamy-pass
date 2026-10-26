import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventConfig, GateMode } from '@tatami/core';
import { hasBarcodeDetector, hasCamera, listCameras, nextCamera, startCamera, type CameraSession } from '../camera.js';
import type { DeviceSettings } from '../db.js';
import { processInput, type ProcessOptions, type ScanOutcome } from '../scan-engine.js';
import { feedback, primeAudio } from '../feedback.js';
import { createDedupe, type CameraInfo } from '../lib/camera-select.js';
import { directionFor, modeLabel, needsDirectionPrompt, normalizeMode, type Direction } from '../lib/mode.js';
import { Result, type ExceptionRequest } from './Result.js';
import { ManualEntry } from './ManualEntry.js';
import { DirectionPrompt } from './DirectionPrompt.js';
import type { ReasonResult } from './ReasonSheet.js';

export type { Direction };

/** Mismo token no se procesa dos veces en 2 s (aunque la cámara se reinicie entre resultados). */
export const DOUBLE_READ_MS = 2000;

interface E2EScanResult { decision: string; reasonCode: string; messageTitle: string; messageBody: string; credentialId: string | null; elapsedMs: number }
declare global {
  interface Window {
    /** Modo prueba (solo con VITE_E2E=1): inyecta un token/ID como si la cámara lo hubiera leído. */
    __tpScan?: (raw: string, opts?: { direction?: Direction; override?: string }) => Promise<E2EScanResult>;
  }
}

type PendingRead = { raw: string; opts: ProcessOptions };

export function Scan({ device, config, operator, onScanned }: { device: DeviceSettings; config: EventConfig; operator: string; onScanned: () => void }) {
  const mode: GateMode = normalizeMode(device.mode);
  const [manualOpen, setManualOpen] = useState(false);
  const [pendingRead, setPendingRead] = useState<PendingRead>();
  const [outcome, setOutcome] = useState<ScanOutcome>();
  const [cameraError, setCameraError] = useState<string>();
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>();
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [engine, setEngine] = useState<'native' | 'zxing'>();
  const [blocked, setBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CameraSession>(null);
  const busyRef = useRef(false);
  const dedupeRef = useRef(createDedupe(DOUBLE_READ_MS));
  const cameraOk = hasCamera();
  const zoneName = config.zones.find((z) => z.code === device.zone)?.name ?? device.zone;

  const run = useCallback(async (raw: string, opts: ProcessOptions): Promise<ScanOutcome | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    try {
      const o = await processInput(raw, device, config, opts);
      feedback(o.result.feedback);
      setOutcome(o);
      setManualOpen(false);
      setPendingRead(undefined);
      onScanned();
      return o;
    } finally {
      busyRef.current = false;
    }
  }, [device, config, onScanned]);

  /**
   * Entrada desde cámara o manual: aplica el anti-doble-lectura y, en modo
   * Entrada+Salida, pregunta la dirección antes de procesar.
   */
  const handle = useCallback(async (raw: string, opts: ProcessOptions = {}): Promise<ScanOutcome | undefined> => {
    if (!dedupeRef.current.accept(raw, Date.now())) { setBlocked(true); window.setTimeout(() => setBlocked(false), 1500); return undefined; }
    const direction = directionFor(mode, opts.direction);
    if (!direction) { setPendingRead({ raw, opts }); return undefined; }
    return run(raw, { ...opts, direction });
  }, [mode, run]);

  // Modo prueba: window.__tpScan(token) simula una lectura de cámara (sin dedupe ni pregunta).
  useEffect(() => {
    if (!import.meta.env.VITE_E2E) return;
    window.__tpScan = async (raw, opts = {}) => {
      // En modo prueba una dirección explícita manda (simula el modo correspondiente).
      const direction = opts.direction ?? directionFor(mode) ?? 'IN';
      const o = await processInput(raw, device, config, {
        direction,
        override: opts.override ? { reason: opts.override, by: operator, meta: { type: 'exception', reasonCode: 'OTHER', authorizedBy: operator, overrides: 'TEST' } } : undefined
      });
      feedback(o.result.feedback);
      setOutcome(o);
      onScanned();
      return { decision: o.result.decision, reasonCode: o.result.reasonCode, messageTitle: o.result.messageTitle, messageBody: o.result.messageBody, credentialId: o.credential?.id ?? null, elapsedMs: o.elapsedMs };
    };
    return () => { delete window.__tpScan; };
  }, [device, config, mode, operator, onScanned]);

  // Cámara activa solo cuando se está escaneando (sin resultado ni manual abiertos).
  const cameraActive = cameraOk && !outcome && !manualOpen && !pendingRead;
  useEffect(() => {
    if (!cameraActive || !videoRef.current) return;
    let alive = true;
    setTorch(false);
    startCamera(videoRef.current, (raw) => void handle(raw), { deviceId: cameraId, dedupeMs: DOUBLE_READ_MS })
      .then(async (s) => {
        if (!alive) return s.stop();
        sessionRef.current = s;
        setEngine(s.engine);
        setTorchSupported(s.torchSupported);
        setCameraError(undefined);
        const cams = await listCameras();
        setCameras(cams);
        if (!cameraId && s.deviceId) setCameraId(s.deviceId);
      })
      .catch((e) => setCameraError(`No puedo abrir la cámara: ${(e as Error).message}`));
    return () => { alive = false; sessionRef.current?.stop(); sessionRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraActive, cameraId]);

  async function toggleTorch() {
    const s = sessionRef.current;
    if (!s) return;
    const ok = await s.setTorch(!torch);
    if (ok) setTorch(!torch);
  }

  function switchCamera() {
    const n = nextCamera(cameras, cameraId);
    if (n && n.deviceId !== cameraId) setCameraId(n.deviceId);
  }

  function onException(req: ExceptionRequest) {
    const direction = outcome?.direction ?? directionFor(mode) ?? 'IN';
    setOutcome(undefined);
    void run(req.credentialId, {
      direction,
      override: { reason: req.reason.reason, by: operator, meta: { type: 'exception', reasonCode: req.reason.reasonCode, authorizedBy: req.authorizedBy, overrides: req.overrides } }
    });
  }

  function onManual(id: string, reason: ReasonResult) {
    void handle(id, { manual: { reason: reason.reason, by: operator, meta: { type: 'manual_entry', reasonCode: reason.reasonCode } } });
  }

  if (outcome) {
    return (
      <Result
        outcome={outcome} device={device} config={config} operator={operator} direction={outcome.direction}
        onNext={() => setOutcome(undefined)}
        onException={onException}
      />
    );
  }

  if (manualOpen) {
    return (
      <>
        {blocked && <div className="banner warn" role="status" data-testid="double-read">Ya leído hace un momento · espera 2 s</div>}
        <ManualEntry
          config={config} operator={operator}
          onValidate={(id) => void handle(id)}
          onManual={onManual}
          onCancel={() => setManualOpen(false)}
        />
        {pendingRead && (
          <DirectionPrompt zoneName={zoneName} who={pendingRead.raw.startsWith('TP1.') ? undefined : pendingRead.raw}
            onPick={(d) => void run(pendingRead.raw, { ...pendingRead.opts, direction: d })} onCancel={() => setPendingRead(undefined)} />
        )}
      </>
    );
  }

  return (
    <div className="stack" data-testid="scan-screen" data-direction={directionFor(mode) ?? 'ASK'} data-mode={mode}>
      <div className={`mode-banner ${mode.toLowerCase()}`} data-testid="mode-banner" role="status">
        <span className="dir-icon" aria-hidden>{mode === 'OUT' ? '←' : mode === 'BOTH' ? '⇄' : '→'}</span>
        <span className="grow"><strong>{modeLabel(mode)}</strong> · {zoneName}</span>
        {mode === 'BOTH' && <small>Pregunta en cada lectura</small>}
      </div>

      {cameraOk && !cameraError ? (
        <div className={`viewfinder ${blocked ? 'blocked' : ''}`} data-testid="viewfinder">
          <video ref={videoRef} muted playsInline />
          <div className="frame">
            <span className="corner tl" /><span className="corner tr" /><span className="corner bl" /><span className="corner br" />
          </div>
          <div className="hint">{blocked ? 'Ya leído · espera 2 s' : `Apunta al QR de la credencial${engine === 'zxing' ? ' · lector JS' : ''}`}</div>
          <div className="cam-tools">
            {cameras.length > 1 && <button type="button" className="cam-btn" onClick={switchCamera} aria-label="Cambiar cámara" title="Cambiar cámara">⟳</button>}
            {torchSupported && <button type="button" className={`cam-btn ${torch ? 'on' : ''}`} onClick={() => void toggleTorch()} aria-label={torch ? 'Apagar linterna' : 'Encender linterna'} aria-pressed={torch}>🔦</button>}
          </div>
        </div>
      ) : (
        <div className="card" data-testid="no-camera">
          <p className="muted">{cameraError ?? 'Este navegador no da acceso a la cámara (se necesita HTTPS). Usa Ingreso manual con el ID corto o el nombre.'}</p>
          {cameraError && <button className="btn secondary" type="button" style={{ marginTop: 10 }} onClick={() => { primeAudio(); setCameraError(undefined); }}>Reintentar</button>}
          {!hasBarcodeDetector() && <p className="muted" style={{ marginTop: 6 }}>Lector QR: @zxing/browser (fallback).</p>}
        </div>
      )}

      <button className="btn secondary" type="button" data-testid="open-manual" onClick={() => { primeAudio(); setManualOpen(true); }}>Ingreso manual (ID corto o nombre)</button>

      {pendingRead && (
        <DirectionPrompt zoneName={zoneName} who={pendingRead.raw.startsWith('TP1.') ? undefined : pendingRead.raw}
          onPick={(d) => void run(pendingRead.raw, { ...pendingRead.opts, direction: d })} onCancel={() => setPendingRead(undefined)} />
      )}
    </div>
  );
}
