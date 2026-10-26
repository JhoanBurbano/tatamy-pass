import { useState } from 'react';
import type { EventConfig } from '@tatami/core';
import type { DeviceSettings } from '../db.js';
import { verifySupervisor } from '../sync.js';
import { hasLocalSupervisorPin, verifySupervisorPinLocal } from '../lib/supervisor.js';
import { primeAudio } from '../feedback.js';

export interface SupervisorGrant {
  by: string;
  method: 'device' | 'snapshot' | 'host';
}

/**
 * Autorización de supervisor (§3/§4):
 * 1. PIN de supervisor sin red: el del dispositivo (si está enrolado como
 *    supervisor) o los PIN que vienen en el snapshot.
 * 2. Si no hay PIN local (o se prefiere), usuario + contraseña validados por el host.
 */
export function SupervisorAuth({ device, config, purpose, onAuthorized, onCancel }: {
  device: DeviceSettings; config?: EventConfig; purpose: string; onAuthorized: (grant: SupervisorGrant) => void; onCancel: () => void;
}) {
  const localAvailable = hasLocalSupervisorPin({ device, config });
  const [pin, setPin] = useState('');
  const [useHost, setUseHost] = useState(!localAvailable);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function pressDigit(d: string) {
    primeAudio();
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    setError(undefined);
    if (next.length === 6) {
      const r = verifySupervisorPinLocal(next, { device, config });
      setPin('');
      if (r.ok) return onAuthorized({ by: r.by, method: r.method });
      setError(r.error);
      if (r.none) setUseHost(true);
    }
  }

  async function submitHost() {
    setBusy(true); setError(undefined);
    try {
      const r = await verifySupervisor(device.hostUrl, username.trim(), secret);
      if (!r.ok) return setError(r.error);
      onAuthorized({ by: r.username, method: 'host' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onCancel}>
      <div className="card stack" onClick={(e) => e.stopPropagation()} data-testid="supervisor-auth" role="dialog" aria-labelledby="sup-title">
        <div>
          <h2 className="title" id="sup-title" style={{ fontSize: 22 }}>Autorización de supervisor</h2>
          <p className="muted">{purpose}</p>
        </div>

        {!useHost && (
          <div className="stack" data-testid="sup-pin-pad">
            <p className="label" style={{ marginBottom: 0 }}>PIN de supervisor (6 dígitos)</p>
            <div className="pin-dots" role="status" aria-label={`${pin.length} de 6 dígitos`} style={{ margin: '4px 0 8px' }}>
              {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={i < pin.length ? 'filled' : ''} />)}
            </div>
            <div className="keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" data-testid={`sup-key-${d}`} onClick={() => pressDigit(d)}>{d}</button>)}
              <button type="button" onClick={() => setPin('')} aria-label="Borrar">⌫</button>
              <button type="button" data-testid="sup-key-0" onClick={() => pressDigit('0')}>0</button>
              <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Atrás">←</button>
            </div>
            {error && <p className="error" data-testid="sup-error" role="alert">{error}</p>}
            <button className="btn ghost" type="button" data-testid="sup-use-host" onClick={() => { setUseHost(true); setError(undefined); }}>Validar con el host (usuario y contraseña)</button>
          </div>
        )}

        {useHost && (
          <div className="stack" data-testid="sup-host-form">
            <p className="muted">
              {localAvailable ? 'Usuario y contraseña de supervisor, validados por el host.' : 'Este dispositivo no tiene PIN de supervisor guardado: el host valida al supervisor. Sin conexión no se puede autorizar.'}
            </p>
            <label>
              <span className="label">Usuario de supervisor</span>
              <input className="input" data-testid="sup-user" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" />
            </label>
            <label>
              <span className="label">PIN o contraseña</span>
              <input className="input" data-testid="sup-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
            </label>
            {error && <p className="error" data-testid="sup-error" role="alert">{error}</p>}
            <button className="btn primary" type="button" data-testid="sup-confirm" disabled={busy || !username.trim() || !secret} onClick={() => void submitHost()}>{busy ? 'Validando…' : 'Autorizar'}</button>
            {localAvailable && <button className="btn ghost" type="button" onClick={() => { setUseHost(false); setError(undefined); }}>Usar PIN de supervisor</button>}
          </div>
        )}

        <button className="btn ghost" type="button" data-testid="sup-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
