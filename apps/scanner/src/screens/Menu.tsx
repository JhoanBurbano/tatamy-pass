import { useState } from 'react';
import type { DeviceSettings } from '../db.js';
import { changeHostUrl, type SyncStatus } from '../sync.js';
import { describeMode, sessionRemainingMs, type SessionInfo } from '../lib/shift.js';
import { formatCountdown } from '../lib/pin-lock.js';
import type { UiPrefs } from '../lib/prefs.js';

export type MenuAction = 'zone' | 'summary' | 'end-shift' | 'kiosk-on' | 'kiosk-off' | 'pending' | 'reset' | 'install' | 'gloves' | 'contrast' | 'lock' | 'update';

declare const __APP_BUILD__: string;

/** Menú discreto (⋯) con las acciones que no se usan escaneando. */
export function Menu({ device, status, session, kiosk, prefs, updateAvailable, onAction, onHostChanged, onClose }: {
  device: DeviceSettings; status: SyncStatus; session: SessionInfo | undefined; kiosk: boolean; prefs: UiPrefs; updateAvailable: boolean;
  onAction: (a: MenuAction) => void; onHostChanged: (d: DeviceSettings) => void; onClose: () => void;
}) {
  const [editHost, setEditHost] = useState(false);
  const [hostUrl, setHostUrl] = useState(device.hostUrl);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function saveHost() {
    setBusy(true); setError(undefined);
    try {
      const next = await changeHostUrl(device, hostUrl.trim());
      onHostChanged(next);
      setEditHost(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const left = session ? sessionRemainingMs(session, Date.now()) : 0;
  const hours = Math.floor(left / 3600_000);
  const mins = Math.floor((left % 3600_000) / 60_000);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="card stack menu-card" onClick={(e) => e.stopPropagation()} data-testid="menu" role="dialog" aria-label="Menú">
        <div>
          <h2 className="title" style={{ fontSize: 22 }}>{device.name}</h2>
          <p className="muted">
            {session?.operator ? `${session.operator} · ` : ''}Zona {device.zone} · {describeMode(device.mode)} · {device.role === 'SUPERVISOR' ? 'supervisor' : 'control'} · host {device.hostUrl}
            {session ? ` · turno vence en ${hours} h ${String(mins).padStart(2, '0')} min` : ''}
            {` · ${status.credentials} credenciales`}
          </p>
        </div>
        {updateAvailable && <button className="btn lime" type="button" data-testid="menu-update" onClick={() => onAction('update')}>Hay una versión nueva · Actualizar</button>}
        <button className="btn secondary" type="button" data-testid="menu-zone" onClick={() => onAction('zone')}>Cambiar zona o modo (supervisor)</button>
        <button className="btn secondary" type="button" data-testid="menu-pending" onClick={() => onAction('pending')}>Pendientes de enviar ({status.pending})</button>
        <button className="btn secondary" type="button" data-testid="menu-summary" onClick={() => onAction('summary')}>Resumen del turno</button>
        <div className="row">
          <button className={`btn ${prefs.gloves ? 'primary' : 'secondary'} grow`} type="button" data-testid="menu-gloves" aria-pressed={prefs.gloves} onClick={() => onAction('gloves')}>{prefs.gloves ? 'Guantes: sí' : 'Modo guantes'}</button>
          <button className={`btn ${prefs.contrast ? 'primary' : 'secondary'} grow`} type="button" data-testid="menu-contrast" aria-pressed={prefs.contrast} onClick={() => onAction('contrast')}>{prefs.contrast ? 'Contraste: alto' : 'Alto contraste'}</button>
        </div>
        <button className="btn secondary" type="button" data-testid="menu-kiosk" onClick={() => onAction(kiosk ? 'kiosk-off' : 'kiosk-on')}>{kiosk ? 'Salir del modo kiosk' : 'Modo kiosk (pantalla completa, sin apagado)'}</button>
        <button className="btn secondary" type="button" data-testid="menu-lock" onClick={() => onAction('lock')}>Bloquear pantalla (PIN)</button>
        <button className="btn secondary" type="button" data-testid="menu-install" onClick={() => onAction('install')}>Instalar la app</button>
        <button className="btn secondary" type="button" data-testid="menu-host" onClick={() => setEditHost((v) => !v)}>Cambiar dirección del host</button>
        {editHost && (
          <div className="stack" data-testid="host-form">
            <p className="muted">Para apuntar al host de respaldo (standby) si cae el principal. Se comprueba con <code>/health</code> antes de guardar.</p>
            <input className="input" data-testid="host-input" value={hostUrl} onChange={(e) => setHostUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://host.tatamipass.co" />
            {error && <p className="error" data-testid="host-error">{error}</p>}
            <button className="btn primary" type="button" data-testid="host-save" disabled={busy} onClick={() => void saveHost()}>{busy ? 'Comprobando…' : 'Guardar y reconectar'}</button>
          </div>
        )}
        <button className="btn lime" type="button" data-testid="menu-end-shift" onClick={() => onAction('end-shift')}>Terminar turno</button>
        <button className="btn ghost" type="button" data-testid="menu-reset" onClick={() => onAction('reset')}>Desenrolar este dispositivo</button>
        <button className="btn ghost" type="button" onClick={onClose}>Cerrar</button>
        <p className="muted" style={{ fontSize: 12 }}>
          {status.lastSyncAt ? `Última sync ${new Date(status.lastSyncAt).toLocaleTimeString('es-CO')}` : 'Sin sync todavía'}
          {status.skewMs !== undefined ? ` · reloj ${status.skewMs >= 0 ? '+' : '−'}${formatCountdown(Math.abs(status.skewMs))} vs host` : ''}
          {` · build ${typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'}`}
        </p>
      </div>
    </div>
  );
}
