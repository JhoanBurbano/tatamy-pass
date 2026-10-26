import { useEffect, useState } from 'react';
import { sha256Hex } from '@tatami/core';
import type { DeviceSettings } from '../db.js';
import { attemptPin, formatCountdown, isLocked, loadPinLock, lockRemainingMs, savePinLock, type PinLockState } from '../lib/pin-lock.js';
import { primeAudio } from '../feedback.js';

/**
 * Pantalla de PIN. 5 intentos incorrectos bloquean el dispositivo 15 minutos
 * (TC-074); durante el bloqueo ni el PIN correcto entra y el contador no se
 * reinicia. Los escaneos pendientes en IndexedDB no se tocan.
 */
export function Pin({ device, onUnlock, onReset, title, subtitle, reason }: {
  device: DeviceSettings; onUnlock: () => void; onReset: () => void; title?: string; subtitle?: string;
  /** Por qué se pide el PIN (bloqueo por inactividad, sesión vencida…). */
  reason?: string;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();
  const [lock, setLock] = useState<PinLockState>(() => loadPinLock());
  const [now, setNow] = useState(() => Date.now());
  const locked = isLocked(lock, now);

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [locked]);

  function press(d: string) {
    primeAudio();
    if (locked || pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length !== 6) return;
    const correct = sha256Hex(`tatami:${next}`) === device.pinHash;
    const r = attemptPin(lock, correct, Date.now());
    savePinLock(r.state);
    setLock(r.state);
    setNow(Date.now());
    setPin('');
    if (r.ok) { setError(undefined); onUnlock(); return; }
    setError(r.message);
  }

  const remaining = lockRemainingMs(lock, now);

  return (
    <div className="card belt stack" data-testid="pin-screen">
      <div>
        <h1 className="title">{title ?? `Hola, ${device.name}`}</h1>
        <p className="subtitle">{subtitle ?? 'Escribe tu PIN para empezar a controlar la puerta.'}</p>
        {reason && <p className="banner warn" style={{ marginTop: 10 }} data-testid="pin-reason">{reason}</p>}
      </div>
      {locked ? (
        <div className="locked" role="alert" data-testid="pin-locked">
          <div className="locked-title">Dispositivo bloqueado</div>
          <div className="locked-count" data-testid="pin-countdown">{formatCountdown(remaining)}</div>
          <p className="muted">Demasiados intentos incorrectos. Espera a que termine la cuenta o pide al supervisor que lo desbloquee desde el panel.</p>
        </div>
      ) : (
        <div className="pin-dots" role="status" aria-label={`${pin.length} de 6 dígitos`}>
          {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={i < pin.length ? 'filled' : ''} />)}
        </div>
      )}
      {error && <p className="error" style={{ textAlign: 'center' }} data-testid="pin-error">{error}</p>}
      <div className="keypad" aria-disabled={locked}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" disabled={locked} onClick={() => press(d)}>{d}</button>)}
        <button type="button" disabled={locked} onClick={() => setPin('')} aria-label="Borrar">⌫</button>
        <button type="button" disabled={locked} onClick={() => press('0')}>0</button>
        <button type="button" disabled={locked} onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Atrás">←</button>
      </div>
      {lock.fails >= 3 && !locked && (
        <button className="btn ghost" type="button" onClick={onReset}>¿Olvidaste el PIN? Volver a enrolar el dispositivo</button>
      )}
    </div>
  );
}
