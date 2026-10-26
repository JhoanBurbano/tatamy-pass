import { useEffect, useRef, useState } from 'react';
import { hasCamera, startCamera, type CameraSession } from '../camera.js';
import { enrollDevice } from '../sync.js';
import type { DeviceSettings } from '../db.js';

/**
 * Enrolamiento: el supervisor genera un código en el host. Se puede escanear
 * (QR con JSON `{hostUrl, token}`) o pegar a mano. Luego se define el PIN.
 */
export function Enroll({ onDone }: { onDone: (d: DeviceSettings) => void }) {
  const [hostUrl, setHostUrl] = useState(() => localStorage.getItem('tp.hostUrl') ?? window.location.origin.replace(/:(5173|5174|4173)$/, ':8787'));
  const [token, setToken] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<CameraSession>(null);

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    let alive = true;
    startCamera(videoRef.current, (raw) => {
      try {
        const parsed = JSON.parse(raw) as { hostUrl?: string; token?: string };
        if (parsed.token) setToken(parsed.token);
        if (parsed.hostUrl) setHostUrl(parsed.hostUrl);
      } catch {
        setToken(raw);
      }
      setScanning(false);
    }).then((s) => { if (alive) sessionRef.current = s; else s.stop(); }).catch((e) => { setError(`No se pudo abrir la cámara: ${(e as Error).message}`); setScanning(false); });
    return () => { alive = false; sessionRef.current?.stop(); sessionRef.current = null; };
  }, [scanning]);

  async function submit() {
    setError(undefined);
    if (!/^https?:\/\//.test(hostUrl)) return setError('La dirección del host debe empezar por http:// o https://');
    if (!token.trim()) return setError('Pega o escanea el código de enrolamiento.');
    if (!/^\d{6}$/.test(pin)) return setError('El PIN debe tener 6 dígitos.');
    if (pin !== pin2) return setError('Los dos PIN no coinciden.');
    setBusy(true);
    try {
      localStorage.setItem('tp.hostUrl', hostUrl);
      const d = await enrollDevice(hostUrl, token.trim(), pin);
      onDone(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card belt stack" data-testid="enroll-screen">
        <div>
          <h1 className="title">Enrolar este dispositivo</h1>
          <p className="subtitle">Pide al supervisor un código de enrolamiento. Dura 10 minutos.</p>
        </div>
        <label>
          <span className="label">Dirección del host</span>
          <input className="input" data-testid="enroll-host" value={hostUrl} onChange={(e) => setHostUrl(e.target.value)} placeholder="https://host.tatami.local" inputMode="url" autoCapitalize="none" />
        </label>
        <label>
          <span className="label">Código de enrolamiento</span>
          <input className="input" data-testid="enroll-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Pega aquí el código" autoCapitalize="none" />
        </label>
        {hasCamera() && !scanning && (
          <button className="btn secondary" type="button" onClick={() => setScanning(true)}>Escanear código QR</button>
        )}
        {scanning && (
          <div className="viewfinder">
            <video ref={videoRef} muted playsInline />
            <div className="frame" />
            <div className="hint">Apunta al QR de enrolamiento</div>
          </div>
        )}
        <div className="row">
          <label className="grow">
            <span className="label">PIN (6 dígitos)</span>
            <input className="input" data-testid="enroll-pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" />
          </label>
          <label className="grow">
            <span className="label">Repite el PIN</span>
            <input className="input" data-testid="enroll-pin2" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" />
          </label>
        </div>
        {error && <p className="error" data-testid="enroll-error">{error}</p>}
        <button className="btn primary" type="button" data-testid="enroll-submit" disabled={busy} onClick={() => void submit()}>{busy ? 'Enrolando…' : 'Enrolar'}</button>
      </div>
      <p className="muted">Si el host usa HTTPS con certificado propio, instala antes el certificado raíz que viene en el QR de enrolamiento. Sin eso, la cámara no funciona.</p>
    </div>
  );
}
