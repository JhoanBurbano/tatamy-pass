/**
 * Panel deslizable "Radio" del scanner: canal actual, quién está, botón grande
 * de pulsar para hablar (≥ 72 px; también barra espaciadora), quién habla,
 * volumen, cambio de canal según permisos, botón Emergencia y órdenes
 * recibidas con "Recibido". Textos del catálogo docs/70 §4.5.
 */
import { useEffect, useState } from 'react';
import { canListen, canTalk } from '@tatami/core';
import type { RadioClient } from './client.js';
import { isPttKey, pttLabel, type RadioState } from './state.js';

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

export function RadioPanel({ client, onClose }: { client: RadioClient; onClose: () => void }) {
  const [s, setS] = useState<RadioState>(client.state);
  useEffect(() => client.subscribe(setS), [client]);

  // Barra espaciadora = PTT (teclado físico o portátil); no interfiere con campos de texto.
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (isPttKey(e)) { e.preventDefault(); client.pttDown(); } };
    const up = (e: KeyboardEvent) => { if (isPttKey({ ...e, repeat: false })) { e.preventDefault(); client.pttUp(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); client.pttUp(); };
  }, [client]);

  const label = pttLabel(s);
  const role = s.self?.role ?? '';
  const current = s.channels.find((c) => c.id === s.channel);
  const emergency = s.channels.find((c) => c.emergency);
  const selectable = s.channels.filter((c) => !c.emergency && canListen(c, role));
  const talkAllowed = current ? canTalk(current, role) : true;
  const peersUp = Object.values(s.peers).filter((p) => p === 'connected').length;
  const pending = s.orders.filter((o) => !o.acked).length;
  const pressable = s.mic !== 'denied' && talkAllowed && (s.connection === 'online' || peersUp > 0);

  const pttHandlers = {
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); client.pttDown(); },
    onPointerUp: () => client.pttUp(),
    onPointerCancel: () => client.pttUp(),
    onPointerLeave: () => { if (s.ptt !== 'idle') client.pttUp(); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault()
  };

  return (
    <div className="sheet" onClick={onClose}>
      <div className="card stack radio-card" onClick={(e) => e.stopPropagation()} data-testid="radio-panel" role="dialog" aria-label="Radio">
        <div className="row" style={{ alignItems: 'center' }}>
          <div>
            <h2 className="title" style={{ fontSize: 22 }}>Radio · {current?.name ?? 'sin canal'}</h2>
            <p className="muted" data-testid="radio-connection" data-state={s.connection}>
              {s.connection === 'online' ? `Conectada · ${s.participants.length} en el canal` : s.connection === 'off' ? 'Apagada' : `Sin host · reconectando · ${peersUp} ${peersUp === 1 ? 'equipo conectado' : 'equipos conectados'}`}
              {s.mic === 'denied' ? ' · sin micrófono' : ''}
            </p>
          </div>
          <span className="grow" />
          <button type="button" className="btn ghost" style={{ width: 'auto' }} data-testid="radio-close" onClick={onClose}>Cerrar</button>
        </div>

        {s.error && <p className="error" role="alert" data-testid="radio-error" onClick={() => client.clearError()}>{s.error}</p>}

        {s.emergency && s.emergency.id !== s.self?.id && (
          <div className="banner warn radio-emergency" role="alert" data-testid="radio-emergency">Emergencia · {s.emergency.name} está hablando a todos</div>
        )}

        <div className="radio-speaker" data-testid="radio-speaker" data-speaking={s.speaker ? 'yes' : 'no'}>
          {s.speaker ? (s.speaker.id === s.self?.id ? 'Estás hablando' : `${s.speaker.name} hablando`) : 'Nadie habla ahora'}
        </div>

        <button
          type="button" className={`radio-ptt ${label.tone}`} data-testid="radio-ptt" data-ptt={s.ptt} disabled={!pressable}
          aria-pressed={s.ptt === 'talking' || s.ptt === 'local'} {...pttHandlers}
        >
          <span className="radio-ptt-title">{label.title}</span>
          <span className="radio-ptt-sub">{label.sub}</span>
        </button>

        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <label className="muted" htmlFor="radio-volume">Volumen</label>
          <input id="radio-volume" data-testid="radio-volume" type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => client.setVolume(Number(e.target.value))} style={{ flex: 1 }} />
          {emergency && canTalk(emergency, role) && (
            <button type="button" className="btn danger radio-emergency-btn" style={{ width: 'auto' }} data-testid="radio-emergency-ptt" disabled={s.mic === 'denied' || s.connection !== 'online'}
              onPointerDown={(e) => { e.preventDefault(); client.emergencyDown(); }} onPointerUp={() => client.pttUp()} onPointerCancel={() => client.pttUp()} onContextMenu={(e) => e.preventDefault()}>
              Emergencia
            </button>
          )}
        </div>

        {selectable.length > 1 && (
          <div className="row radio-channels" data-testid="radio-channels">
            {selectable.map((c) => (
              <button key={c.id} type="button" className={`btn ${c.id === s.channel ? 'primary' : 'secondary'} grow`} style={{ minHeight: 48, borderColor: c.color }} data-testid={`radio-channel-${c.id}`} aria-pressed={c.id === s.channel} onClick={() => client.joinChannel(c.id)}>
                <span className="radio-dot" style={{ background: c.color }} />{c.name}
              </button>
            ))}
          </div>
        )}

        <div data-testid="radio-participants">
          <p className="muted" style={{ marginBottom: 6 }}>En el canal</p>
          {s.participants.length === 0 && <p className="muted">Nadie más en el canal todavía.</p>}
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {s.participants.map((p) => (
              <span key={p.id} className={`pill ${s.speaker?.id === p.id ? 'warn' : ''}`} data-testid="radio-participant" data-peer={p.id === s.self?.id ? 'self' : s.peers[p.id] ?? 'none'}>
                {p.id !== s.self?.id && <span className={`dot ${s.peers[p.id] === 'connected' ? 'online' : s.peers[p.id] ? 'syncing' : 'offline'}`} />}
                {p.name}{p.id === s.self?.id ? ' (tú)' : ''}{s.speaker?.id === p.id ? ' · hablando' : ''}
              </span>
            ))}
          </div>
        </div>

        <div data-testid="radio-orders">
          <p className="muted" style={{ marginBottom: 6 }}>Órdenes{pending ? ` · ${pending} sin confirmar` : ''}</p>
          {s.orders.length === 0 && <p className="muted">Sin órdenes todavía. Cuando llegue una, suena, vibra y se lee en voz alta.</p>}
          {s.orders.slice(0, 8).map((o) => (
            <div key={o.order.id} className={`radio-order ${o.order.emergency ? 'emergency' : ''} ${o.acked ? 'acked' : ''}`} data-testid="radio-order" data-acked={o.acked ? 'yes' : 'no'}>
              <div className="grow">
                <b>{o.order.emergency ? '' : ''}{o.order.text}</b>
                <div className="muted" style={{ fontSize: 13 }}>{o.order.from.name} · {hhmm(o.order.at)}{o.acked ? (o.ackPending ? ' · recibido (se confirma al volver el host)' : ' · recibido ✓') : ''}</div>
              </div>
              {!o.acked && <button type="button" className="btn lime" style={{ width: 'auto', minHeight: 48 }} data-testid="radio-ack" onClick={() => client.ack(o.order.id)}>Recibido</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
