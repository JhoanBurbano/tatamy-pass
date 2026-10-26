import { useState } from 'react';
import type { EventConfig, GateMode } from '@tatami/core';
import type { DeviceSettings } from '../db.js';
import { GATE_MODES, normalizeMode } from '../lib/mode.js';
import { SupervisorAuth, type SupervisorGrant } from './SupervisorAuth.js';

export interface ShiftSetup {
  operator: string;
  zone: string;
  mode: GateMode;
  /** Quién autorizó el cambio de zona/modo (si hubo). */
  authorizedBy?: string;
}

/**
 * Inicio de turno (§6) y puerta (§3): quién, puerta, zona y modo. Cambiar la
 * zona o el modo exige PIN de supervisor; empezar sin cambios, no.
 */
export function ZoneSelect({ device, config, initialOperator, title, onSelect, onCancel }: {
  device: DeviceSettings; config: EventConfig | undefined; initialOperator?: string; title?: string;
  onSelect: (setup: ShiftSetup) => void; onCancel?: () => void;
}) {
  const [zone, setZone] = useState(device.zone);
  const [mode, setMode] = useState<GateMode>(normalizeMode(device.mode));
  const [operator, setOperator] = useState(initialOperator ?? '');
  const [auth, setAuth] = useState(false);
  const zones = config?.zones ?? [{ code: device.zone, name: device.zone, tracksExit: false }];
  const zoneChanged = zone !== device.zone;
  const modeChanged = mode !== normalizeMode(device.mode);
  const changed = zoneChanged || modeChanged;
  const changeText = [zoneChanged ? `zona ${device.zone} → ${zone}` : '', modeChanged ? `modo ${normalizeMode(device.mode)} → ${mode}` : ''].filter(Boolean).join(' y ');

  function finish(grant?: SupervisorGrant) {
    onSelect({ operator: operator.trim() || device.name, zone, mode, authorizedBy: grant?.by });
  }

  return (
    <div className="card belt stack" data-testid="zone-screen">
      <div>
        <h1 className="title">{title ?? 'Inicio de turno'}</h1>
        <p className="subtitle">Puerta <strong>{device.name}</strong> · zona asignada <strong>{device.zone}</strong>. Cambiar zona o modo pide PIN de supervisor.</p>
      </div>

      <label>
        <span className="label">¿Quién controla esta puerta? (tu nombre)</span>
        <input className="input" data-testid="operator-input" value={operator} onChange={(e) => setOperator(e.target.value)} placeholder={device.name} autoComplete="name" />
      </label>

      <div>
        <span className="label">Zona</span>
        <div className="zone-grid">
          {zones.map((z) => (
            <button
              key={z.code} type="button" className={`zone-btn ${zone === z.code ? 'selected' : ''}`} data-testid={`zone-${z.code}`}
              aria-pressed={zone === z.code} onClick={() => setZone(z.code)}
            >
              <div className="code">{z.code}</div>
              <div className="name">{z.name}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="label">Modo de la puerta</span>
        <div className="mode-grid" role="radiogroup" aria-label="Modo">
          {GATE_MODES.map((m) => (
            <button key={m.code} type="button" role="radio" aria-checked={mode === m.code} className={`mode-btn ${mode === m.code ? 'selected' : ''} ${m.code.toLowerCase()}`} data-testid={`mode-${m.code}`} onClick={() => setMode(m.code)}>
              <div className="code">{m.label}</div>
              <div className="name">{m.hint}</div>
            </button>
          ))}
        </div>
      </div>

      <button className="btn primary" type="button" data-testid="zone-confirm" onClick={() => (changed ? setAuth(true) : finish())}>
        {changed ? `Cambiar ${changeText} (pide supervisor)` : 'Empezar a escanear'}
      </button>
      {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>Cancelar</button>}
      {auth && (
        <SupervisorAuth
          device={device} config={config} purpose={`Cambiar ${changeText} en ${device.name}.`}
          onAuthorized={(g) => { setAuth(false); finish(g); }} onCancel={() => setAuth(false)}
        />
      )}
    </div>
  );
}
