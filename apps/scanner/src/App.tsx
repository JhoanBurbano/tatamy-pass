import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventConfig } from '@tatami/core';
import { getConfig, getDevice, resetDevice, setSetting, type DeviceSettings } from './db.js';
import { syncClient, type SyncStatus } from './sync.js';
import { closeSession, currentSession, openSession, setSessionOperator } from './session.js';
import { describeMode, sessionActive, totalsOf, type SessionInfo, type ShiftSummary as Summary } from './lib/shift.js';
import { clockOutOfSync, describeSkew } from './lib/clock.js';
import { createIdleWatcher, IDLE_LOCK_MS } from './lib/idle.js';
import { loadPrefs, prefsClassName, savePrefs, type UiPrefs } from './lib/prefs.js';
import { normalizeMode } from './lib/mode.js';
import { disableKiosk, enableKiosk, kioskEnabled } from './kiosk.js';
import { recordDeviceEvent } from './device-events.js';
import { applyUpdate, isStandalone, onUpdateAvailable } from './pwa.js';
import { Enroll } from './screens/Enroll.js';
import { Pin } from './screens/Pin.js';
import { ZoneSelect, type ShiftSetup } from './screens/ZoneSelect.js';
import { Scan } from './screens/Scan.js';
import { Pending } from './screens/Pending.js';
import { Menu, type MenuAction } from './screens/Menu.js';
import { ShiftSummary } from './screens/ShiftSummary.js';
import { Install } from './screens/Install.js';
import { radioClient, type RadioState } from './radio/index.js';
import { RadioPanel } from './radio/RadioPanel.js';

type Screen = 'loading' | 'enroll' | 'pin' | 'locked' | 'zone' | 'scan' | 'pending' | 'summary' | 'shift-ended' | 'install';

declare global {
  interface Window {
    /** Modo prueba (VITE_E2E=1): fuerza un ciclo de sync y devuelve el estado. */
    __tpSync?: () => Promise<SyncStatus>;
    __tpStatus?: () => SyncStatus;
    /** Modo prueba: simula inactividad (bloquea la pantalla). */
    __tpIdle?: () => void;
    /** Modo prueba: estado de Tatami Radio y estadísticas de las conexiones P2P. */
    __tpRadio?: () => RadioState;
    __tpRadioStats?: () => Promise<Array<{ id: string; state: string; receivers: number; bytesReceived: number; packetsReceived: number }>>;
    __tpRadioClient?: typeof radioClient;
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [device, setDevice] = useState<DeviceSettings>();
  const [config, setConfig] = useState<EventConfig>();
  const [status, setStatus] = useState<SyncStatus>(syncClient.status);
  const [session, setSession] = useState<SessionInfo>();
  const [menu, setMenu] = useState(false);
  const [kiosk, setKiosk] = useState(() => kioskEnabled());
  const [prefs, setPrefs] = useState<UiPrefs>(() => loadPrefs());
  const [toast, setToast] = useState<string>();
  const [lockReason, setLockReason] = useState<string>();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [showInstallHint, setShowInstallHint] = useState(() => !isStandalone());
  const [radio, setRadio] = useState<RadioState>(radioClient.state);
  const [radioOpen, setRadioOpen] = useState(false);
  const endSummaryRef = useRef<Summary | undefined>(undefined);

  useEffect(() => syncClient.subscribe(setStatus), []);
  useEffect(() => radioClient.subscribe(setRadio), []);
  useEffect(() => onUpdateAvailable(setUpdateAvailable), []);

  // Carga inicial
  useEffect(() => {
    void (async () => {
      const d = await getDevice();
      if (!d) return setScreen('enroll');
      setDevice(d);
      setConfig(await getConfig());
      syncClient.start();
      const s = currentSession();
      setSession(s);
      setScreen(s ? 'scan' : 'pin');
    })();
    return () => syncClient.stop();
  }, []);

  // Modo prueba.
  useEffect(() => {
    if (!import.meta.env.VITE_E2E) return;
    window.__tpSync = async () => { await syncClient.tick(true); return syncClient.status; };
    window.__tpStatus = () => syncClient.status;
    window.__tpRadio = () => radioClient.state;
    window.__tpRadioStats = () => radioClient.peerStats();
    window.__tpRadioClient = radioClient;
    return () => { delete window.__tpSync; delete window.__tpStatus; delete window.__tpRadio; delete window.__tpRadioStats; delete window.__tpRadioClient; };
  }, []);

  // Cuando llega un snapshot nuevo, refresca la config en memoria.
  useEffect(() => {
    if (!status.snapshotAt) return;
    void getConfig().then((c) => c && setConfig(c));
  }, [status.snapshotAt]);

  // Sesión de 12 h: al vencer vuelve a pedir el PIN (se revisa cada minuto).
  useEffect(() => {
    if (!session) return;
    const t = setInterval(() => {
      if (!sessionActive(session, Date.now())) {
        setSession(undefined); setScreen('pin'); setMenu(false);
        setLockReason('Tu turno terminó por tiempo (12 h). Escribe tu PIN para continuar.');
      }
    }, 60_000);
    return () => clearInterval(t);
  }, [session]);

  // Bloqueo por inactividad (5 min sin tocar la pantalla) mientras hay sesión.
  const inSession = !!device && !!session && screen !== 'pin' && screen !== 'locked' && screen !== 'enroll' && screen !== 'loading';
  useEffect(() => {
    if (!inSession) return;
    const lock = () => { setMenu(false); setLockReason('Pantalla bloqueada por inactividad. Escribe tu PIN para seguir.'); setScreen('locked'); };
    const w = createIdleWatcher({ timeoutMs: IDLE_LOCK_MS, onIdle: lock });
    const touch = () => w.touch();
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    if (import.meta.env.VITE_E2E) window.__tpIdle = lock;
    return () => { w.stop(); for (const e of events) window.removeEventListener(e, touch); delete window.__tpIdle; };
  }, [inSession]);

  // Tatami Radio: encendida mientras hay turno activo (en primer plano); se apaga al bloquear o cerrar turno.
  useEffect(() => {
    if (!inSession || !device) return;
    void radioClient.start({ hostUrl: device.hostUrl, token: device.deviceToken });
    return () => { radioClient.stop(); setRadioOpen(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inSession, device?.hostUrl, device?.deviceToken]);

  // Una orden nueva abre el panel de radio para que el operador la vea y confirme.
  const unacked = radio.orders.filter((o) => !o.acked).length;
  useEffect(() => { if (unacked > 0 && inSession && screen === 'scan') setRadioOpen(true); }, [unacked, inSession, screen]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const onEnrolled = useCallback(async (d: DeviceSettings) => {
    setDevice(d);
    setSession(openSession());
    syncClient.start();
    await syncClient.tick(true);
    setConfig(await getConfig());
    setScreen('zone');
  }, []);

  async function reset() {
    if (!confirm('¿Borrar el enrolamiento y todos los datos locales de este dispositivo?')) return;
    syncClient.stop();
    await resetDevice();
    closeSession();
    try { localStorage.removeItem('tp.pinLock'); } catch { /* nada */ }
    setDevice(undefined);
    setConfig(undefined);
    setSession(undefined);
    setMenu(false);
    setScreen('enroll');
  }

  /** PIN correcto: sesión nueva (pantalla PIN) o continuar la misma (bloqueo). */
  function unlock() {
    setLockReason(undefined);
    const wasLocked = screen === 'locked';
    const s = openSession();
    setSession(s);
    // Turno nuevo (sin operador todavía) → pantalla de inicio de turno; si no, a escanear.
    setScreen(wasLocked || s.operator ? 'scan' : 'zone');
  }

  async function onShiftSetup(setup: ShiftSetup) {
    if (!device) return;
    const prevZone = device.zone;
    const prevMode = normalizeMode(device.mode);
    const next: DeviceSettings = { ...device, zone: setup.zone, mode: setup.mode };
    setDevice(next);
    await setSetting('device', next);
    const by = setup.operator;
    if (setup.authorizedBy && setup.zone !== prevZone) {
      await recordDeviceEvent(next, { type: 'zone_change', by, authorizedBy: setup.authorizedBy, from: prevZone, to: setup.zone });
    }
    if (setup.authorizedBy && setup.mode !== prevMode) {
      await recordDeviceEvent(next, { type: 'mode_change', by, authorizedBy: setup.authorizedBy, from: prevMode, to: setup.mode });
    }
    const current = currentSession();
    if (current && !current.operator) {
      // Primer "Empezar a escanear" del turno: queda el inicio en el log.
      await recordDeviceEvent(next, { type: 'shift_start', by, gate: next.name, zone: next.zone, mode: setup.mode });
    }
    const s = setSessionOperator(by) ?? openSession(Date.now(), by);
    setSession(s);
    if (setup.authorizedBy) setToast(`${setup.zone !== prevZone ? `Zona cambiada a ${setup.zone}` : `Modo cambiado a ${describeMode(setup.mode)}`} por ${setup.authorizedBy}`);
    void syncClient.refreshCounters();
    setScreen('scan');
  }

  async function endShift() {
    if (!device || !session) return;
    await syncClient.tick(true);
    setScreen('shift-ended');
  }

  async function closeShift() {
    if (device && session && endSummaryRef.current) {
      const s = endSummaryRef.current;
      await recordDeviceEvent(device, {
        type: 'shift_end', by: session.operator ?? device.name, gate: device.name, zone: device.zone, mode: normalizeMode(device.mode),
        startedAt: new Date(session.shiftStartedAt).toISOString(), totals: totalsOf(s)
      });
      void syncClient.tick(true);
    }
    closeSession();
    setSession(undefined);
    setLockReason(undefined);
    setScreen('pin');
  }

  function togglePref(key: keyof UiPrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    savePrefs(next);
    setToast(key === 'gloves' ? (next.gloves ? 'Modo guantes: botones más grandes' : 'Modo guantes desactivado') : (next.contrast ? 'Alto contraste activado' : 'Alto contraste desactivado'));
  }

  async function onMenu(a: MenuAction) {
    setMenu(false);
    if (a === 'zone') setScreen('zone');
    else if (a === 'pending') setScreen('pending');
    else if (a === 'summary') setScreen('summary');
    else if (a === 'end-shift') await endShift();
    else if (a === 'install') setScreen('install');
    else if (a === 'gloves') togglePref('gloves');
    else if (a === 'contrast') togglePref('contrast');
    else if (a === 'lock') { setLockReason('Pantalla bloqueada. Escribe tu PIN para seguir.'); setScreen('locked'); }
    else if (a === 'update') applyUpdate();
    else if (a === 'kiosk-on') {
      const r = await enableKiosk(() => setToast('Modo kiosk: usa el menú para salir.'));
      setKiosk(true);
      setToast(`Modo kiosk activado${r.fullscreen ? '' : ' (sin pantalla completa)'}${r.wakeLock ? '' : ' · sin wake lock'}`);
    } else if (a === 'kiosk-off') { await disableKiosk(); setKiosk(false); setToast('Modo kiosk desactivado'); }
    else if (a === 'reset') await reset();
  }

  const stateLabel = status.state === 'online' ? 'Conectado' : status.state === 'syncing' ? 'Enviando…' : 'Sin conexión · sigue escaneando';
  const skewWarning = clockOutOfSync(status.skewMs) ? describeSkew(status.skewMs!) : undefined;
  const operator = session?.operator ?? device?.name ?? '';

  return (
    <div className={`app ${kiosk ? 'kiosk' : ''} ${prefsClassName(prefs)}`}>
      <header className="topbar">
        <div className="brand"><span className="mark">TP</span>Tatami Pass</div>
        {device && (
          <div className="status" data-testid="conn-status" data-state={status.state} title={status.lastSyncAt ? `Última sync ${new Date(status.lastSyncAt).toLocaleTimeString('es-CO')}` : 'Sin sync todavía'}>
            <span className={`dot ${status.state}`} />
            <span>{stateLabel}</span>
          </div>
        )}
      </header>

      {updateAvailable && screen !== 'loading' && (
        <button type="button" className="banner update" data-testid="update-banner" onClick={applyUpdate}>
          Hay una versión nueva · <strong>Actualizar</strong>
        </button>
      )}

      {skewWarning && (
        <div className="banner warn" role="status" data-testid="clock-warning">
          ⏱ {skewWarning}. Ajusta la hora automática del dispositivo; los QR digitales pueden fallar.
        </div>
      )}

      {inSession && (
        <div className="row">
          <span className="pill" data-testid="device-pill">{device!.name} · zona {device!.zone} · {describeMode(device!.mode)}</span>
          <button type="button" className={`pill ${status.pending > 0 ? 'warn' : ''}`} data-testid="pending-pill" style={{ border: 'none', cursor: 'pointer' }} onClick={() => setScreen(screen === 'pending' ? 'scan' : 'pending')}>
            Pendientes: <span data-testid="pending-count">{status.pending}</span>
          </button>
          <button type="button" className={`pill radio ${radio.orders.some((o) => !o.acked) ? 'warn' : ''}`} data-testid="radio-pill" data-ptt={radio.ptt} data-speaking={radio.speaker ? 'yes' : 'no'} data-connection={radio.connection} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setRadioOpen(true)} aria-label="Radio">
            <span className={`dot ${radio.connection === 'online' ? 'online' : radio.connection === 'off' ? '' : 'offline'}`} />
            {radio.speaker ? (radio.speaker.id === radio.self?.id ? 'Hablando' : `${radio.speaker.name} 🎙`) : radio.orders.some((o) => !o.acked) ? `Orden sin confirmar` : 'Radio'}
          </button>
          <span className="grow" />
          <button type="button" className="menu-btn" aria-label="Menú" data-testid="menu-open" onClick={() => setMenu(true)}>⋯</button>
        </div>
      )}

      {screen === 'loading' && <div className="card"><p className="muted">Cargando…</p></div>}
      {screen === 'enroll' && (
        <>
          <Enroll onDone={(d) => void onEnrolled(d)} />
          {showInstallHint && <Install embedded onClose={() => setShowInstallHint(false)} />}
        </>
      )}
      {(screen === 'pin' || screen === 'locked') && device && (
        <Pin
          device={device} onReset={() => void reset()} onUnlock={unlock}
          title={screen === 'locked' ? 'Pantalla bloqueada' : undefined}
          subtitle={screen === 'locked' ? `${operator} · escribe tu PIN para seguir escaneando.` : undefined}
          reason={lockReason}
        />
      )}
      {screen === 'zone' && device && (
        <ZoneSelect
          device={device} config={config} initialOperator={session?.operator}
          title={session?.operator ? 'Puerta y modo' : 'Inicio de turno'}
          onCancel={session?.operator ? () => setScreen('scan') : undefined}
          onSelect={(setup) => void onShiftSetup(setup)}
        />
      )}
      {screen === 'scan' && device && (
        config ? (
          <Scan device={device} config={config} operator={operator} onScanned={() => void syncClient.refreshCounters()} />
        ) : (
          <div className="card stack">
            <h2 className="title" style={{ fontSize: 22 }}>Falta la lista de credenciales</h2>
            <p className="muted">Este dispositivo aún no descargó las credenciales del host. Conéctate a la red del evento y reintenta.</p>
            <button className="btn primary" type="button" onClick={() => void syncClient.tick(true)}>Reintentar</button>
          </div>
        )
      )}
      {screen === 'pending' && <Pending status={status} onClose={() => setScreen('scan')} />}
      {screen === 'install' && <Install onClose={() => setScreen('scan')} />}
      {screen === 'summary' && device && session && (
        <ShiftSummary device={device} session={session} title="Resumen del turno" closeLabel="Volver a escanear" onClose={() => setScreen('scan')} />
      )}
      {screen === 'shift-ended' && device && session && (
        <ShiftSummary
          device={device} session={session} title="Turno terminado" closeLabel="Cerrar sesión"
          onReady={(s) => { endSummaryRef.current = s; }}
          onClose={() => void closeShift()}
        />
      )}

      {menu && device && (
        <Menu
          device={device} status={status} session={session} kiosk={kiosk} prefs={prefs} updateAvailable={updateAvailable}
          onAction={(a) => void onMenu(a)}
          onHostChanged={(d) => { setDevice(d); setMenu(false); setToast(`Host cambiado a ${d.hostUrl}`); void syncClient.tick(true); }}
          onClose={() => setMenu(false)}
        />
      )}

      {radioOpen && inSession && <RadioPanel client={radioClient} onClose={() => setRadioOpen(false)} />}

      {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
    </div>
  );
}
