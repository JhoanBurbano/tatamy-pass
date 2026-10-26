/**
 * Panel › Radio (supervisor/admin): canales y presencia en vivo, quién habla,
 * órdenes a un canal o a una puerta con acuses en tiempo real, PTT desde el
 * computador (micrófono del portátil o barra espaciadora), historial del día
 * y configuración de canales y catálogo de órdenes (admin). Reutiliza el
 * `RadioClient` del scanner (misma señalización y misma malla).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { canTalk, type EventConfig, type RadioChannel, type RadioOrder, type RadioOrderTemplate, type RadioParticipant } from '@tatami/core';
import { RadioClient, type RadioDeps } from '../../../scanner/src/radio/client.js';
import { isPttKey, pttLabel, type RadioState } from '../../../scanner/src/radio/state.js';
import { api, getHostUrl, hhmm, loadToken } from '../api.js';
import { Card, Empty, ErrorBox, Field, PageHead, Tag, errorText, usePoll, useToast } from '../ui.jsx';
import type { Session } from '../App.jsx';

interface Status { channels: Array<{ channel: RadioChannel; participants: RadioParticipant[]; speaker: RadioParticipant | null; queue: RadioParticipant[] }>; connected: number; emergency: RadioParticipant | null; orders: RadioOrder[]; at: string }
interface Device { id: string; name: string; zone: string }
interface HistoryEvent { id: string; at: string; channel: string; meta: ({ type: 'radio_ptt'; by: string; durationMs: number; emergency: boolean } | { type: 'radio_order'; by: string; text: string; to?: string; channel?: string; emergency: boolean } | { type: 'radio_ack'; by: string; code: string }) | null }

function beep(kind: 'order' | 'emergency' | 'ok') {
  try {
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return;
    const ac = new Ctor();
    const notes = kind === 'emergency' ? [[1200, 0.18], [800, 0.18], [1200, 0.18]] : kind === 'order' ? [[740, 0.12], [988, 0.18]] : [[880, 0.08]];
    let t = ac.currentTime;
    for (const [f, d] of notes) { const o = ac.createOscillator(); const g = ac.createGain(); o.frequency.value = f; g.gain.value = 0.2; o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d); t += d + 0.03; }
    setTimeout(() => void ac.close(), 2000);
  } catch { /* sin audio */ }
}

function panelDeps(): RadioDeps {
  return {
    WebSocket: globalThis.WebSocket,
    RTCPeerConnection: globalThis.RTCPeerConnection,
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }),
    attachRemote: (stream, volume) => {
      const el = document.createElement('audio');
      el.autoplay = true; el.srcObject = stream; el.volume = volume; el.style.display = 'none'; el.dataset.tpRadio = 'remote';
      document.body.appendChild(el);
      void el.play().catch(() => undefined);
      return { setVolume: (v) => { el.volume = v; }, remove: () => { el.srcObject = null; el.remove(); } };
    },
    now: () => Date.now(),
    tone: beep,
    speak: (text) => { try { const u = new SpeechSynthesisUtterance(text); u.lang = 'es-CO'; speechSynthesis.speak(u); } catch { /* nada */ } },
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (t) => globalThis.clearTimeout(t as number)
  };
}

const wsHost = () => getHostUrl() || `${window.location.protocol}//${window.location.host}`;

export function Radio({ session }: { session: Session }) {
  const { toast } = useToast();
  const clientRef = useRef<RadioClient>(null);
  if (!clientRef.current) clientRef.current = new RadioClient(panelDeps());
  const client = clientRef.current;
  const [s, setS] = useState<RadioState>(client.state);
  const [acks, setAcks] = useState<Record<string, Array<{ by: RadioParticipant; at: string }>>>({});
  const [sent, setSent] = useState<RadioOrder[]>([]);
  const [orderCode, setOrderCode] = useState('');
  const [gate, setGate] = useState('');
  const [target, setTarget] = useState<string>('channel:puertas');
  const [tab, setTab] = useState<'vivo' | 'historial' | 'config'>('vivo');
  const status = usePoll((signal) => api<Status>('/radio/status', { signal }), 3000);
  const devices = usePoll((signal) => api<Device[]>('/devices', { signal }), 15_000);

  useEffect(() => client.subscribe(setS), [client]);
  useEffect(() => {
    const token = loadToken();
    if (!token) return;
    void client.start({ hostUrl: wsHost(), token, channel: 'supervisores' });
    return () => client.stop();
  }, [client]);

  // Acuses y órdenes de otros en vivo: el cliente los guarda en `orders` (incluye las propias y las ajenas).
  useEffect(() => {
    const next: Record<string, Array<{ by: RadioParticipant; at: string }>> = {};
    for (const o of s.orders) next[o.order.id] = o.order.acks;
    setAcks(next);
    setSent(s.orders.map((o) => o.order));
  }, [s.orders]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (tab === 'vivo' && isPttKey(e)) { e.preventDefault(); client.pttDown(); } };
    const up = (e: KeyboardEvent) => { if (isPttKey({ ...e, repeat: false })) { e.preventDefault(); client.pttUp(); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [client, tab]);

  const label = pttLabel(s);
  const catalog = s.orderCatalog;
  const selectedTemplate = catalog.find((o) => o.code === orderCode);
  const channelsForOrders = s.channels.filter((c) => !c.emergency);
  const online = status.data?.channels.flatMap((c) => c.participants.filter((p) => p.kind === 'device')) ?? [];
  const canOrder = ['ADMIN', 'COORDINATOR', 'SUPERVISOR'].includes(session.user.role);

  function sendOrder() {
    if (!selectedTemplate) return;
    const [kind, id] = target.split(':');
    const ok = client.sendOrder({ code: selectedTemplate.code, gate: gate || undefined, ...(kind === 'dev' ? { to: `dev:${id}` } : { channel: id }) });
    if (!ok) return toast('Sin conexión con la radio. Reintenta en unos segundos.', 'error');
    toast(`Orden enviada: ${selectedTemplate.label.replace('{n}', gate || '—')}`);
    setGate('');
  }

  return (
    <>
      <PageHead
        title="Radio"
        sub="Voz por la red local entre scanners y este panel. Mantén pulsado el botón (o la barra espaciadora) para hablar."
        right={<span className={`live ${s.connection === 'online' ? '' : 'warn'}`} data-testid="radio-live"><i />{status.data ? `${status.data.connected} ${status.data.connected === 1 ? 'equipo conectado' : 'equipos conectados'}` : '…'}{status.data?.emergency ? ` · EMERGENCIA: ${status.data.emergency.name}` : ''}</span>}
      />
      <ErrorBox text={status.error} />
      <div className="inline" role="tablist" style={{ marginBottom: 14 }}>
        {(['vivo', 'historial', 'config'] as const).map((t) => <button key={t} role="tab" className={`btn sm ${tab === t ? 'pri' : ''}`} aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'vivo' ? 'En vivo' : t === 'historial' ? 'Historial del día' : 'Canales y órdenes'}</button>)}
      </div>

      {tab === 'vivo' && (
        <div className="grid-2">
          <div className="stack">
            <Card className="flush" title="Canales">
              <div className="tbl">
                <table data-testid="radio-channels">
                  <thead><tr><th>Canal</th><th>Quién está</th><th>Hablando</th><th>En espera</th></tr></thead>
                  <tbody>
                    {status.data?.channels.map((c) => (
                      <tr key={c.channel.id} data-testid={`radio-channel-${c.channel.id}`}>
                        <td><span className="door"><i style={{ background: c.channel.color }} />{c.channel.name}{c.channel.emergency ? '' : ''}</span></td>
                        <td>{c.participants.length === 0 ? <span className="muted">nadie</span> : c.participants.map((p) => <Tag key={p.id} tone={p.kind === 'user' ? 'info' : 'ok'}>{p.name}</Tag>)}</td>
                        <td data-testid="radio-speaker">{c.speaker ? <Tag tone="warn">{c.speaker.name}</Tag> : <span className="muted">—</span>}</td>
                        <td>{c.queue.map((q) => q.name).join(', ') || <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Órdenes enviadas y acuses" right={<span className="muted small">en tiempo real</span>}>
              {sent.length === 0 && <Empty>Todavía no hay órdenes. Elige una del catálogo y envíala a un canal o a una puerta.</Empty>}
              {sent.slice(0, 12).map((o) => (
                <div className="line-item" key={o.id} data-testid="radio-sent-order">
                  <span><b>{o.emergency ? '' : ''}{o.text}</b> <span className="muted">· {o.from.name} · {hhmm(o.at)} · {o.to ? `a ${online.find((d) => `dev:${d.id}` === o.to)?.name ?? o.to}` : `canal ${o.channel}`}</span></span>
                  <span data-testid="radio-acks">{(acks[o.id] ?? []).length === 0 ? <Tag tone="warn">sin acuse</Tag> : (acks[o.id] ?? []).map((a) => <Tag key={a.by.id} tone="ok">{a.by.name} recibió {hhmm(a.at)}</Tag>)}</span>
                </div>
              ))}
            </Card>
          </div>

          <div className="stack">
            <Card title="Hablar desde el computador">
              <p className="muted small" data-testid="radio-connection" data-state={s.connection}>Canal: <b>{s.channels.find((c) => c.id === s.channel)?.name ?? '—'}</b> · {s.connection === 'online' ? 'conectado' : 'sin conexión'}{s.mic === 'denied' ? ' · sin micrófono' : ''}</p>
              <div className="inline">
                {s.channels.filter((c) => !c.emergency && (c.listen.includes('*') || c.listen.includes(session.user.role))).map((c) => (
                  <button key={c.id} className={`btn sm ${c.id === s.channel ? 'pri' : ''}`} onClick={() => client.joinChannel(c.id)} data-testid={`radio-join-${c.id}`}>{c.name}</button>
                ))}
              </div>
              <button
                className={`btn radio-ptt ${label.tone}`} data-testid="radio-ptt" data-ptt={s.ptt} disabled={s.mic === 'denied' || (s.connection !== 'online' && !Object.values(s.peers).some((p) => p === 'connected'))}
                onPointerDown={(e) => { e.preventDefault(); client.pttDown(); }} onPointerUp={() => client.pttUp()} onPointerLeave={() => { if (s.ptt !== 'idle') client.pttUp(); }} onContextMenu={(e) => e.preventDefault()}
              >
                <b>{label.title}</b><small>{label.sub}</small>
              </button>
              {s.channels.some((c) => c.emergency && canTalk(c, session.user.role)) && (
                <button className="btn" style={{ background: 'var(--red-soft)', color: '#991B1B' }} data-testid="radio-emergency-ptt" disabled={s.mic === 'denied' || s.connection !== 'online'} onPointerDown={(e) => { e.preventDefault(); client.emergencyDown(); }} onPointerUp={() => client.pttUp()} onContextMenu={(e) => e.preventDefault()}>
                  Mantén pulsado: Emergencia a todos
                </button>
              )}
              {s.error && <ErrorBox text={s.error} />}
              <p className="muted small">Quién está en tu canal: {s.participants.filter((p) => p.id !== s.self?.id).map((p) => p.name).join(', ') || 'nadie más'}.</p>
            </Card>

            {canOrder && (
              <Card title="Enviar una orden">
                <Field label="Orden">
                  <select value={orderCode} onChange={(e) => setOrderCode(e.target.value)} data-testid="radio-order-code">
                    <option value="">Elige…</option>
                    {catalog.map((o) => <option key={o.code} value={o.code}>{o.emergency ? '' : ''}{o.label}</option>)}
                  </select>
                </Field>
                {selectedTemplate?.requiresGate && (
                  <Field label="Puerta" hint="Se sustituye en el texto ({n}) y se lee en voz alta.">
                    <input value={gate} onChange={(e) => setGate(e.target.value)} placeholder="3" data-testid="radio-order-gate" />
                  </Field>
                )}
                {!selectedTemplate?.emergency && (
                  <Field label="Destino">
                    <select value={target} onChange={(e) => setTarget(e.target.value)} data-testid="radio-order-target">
                      {channelsForOrders.map((c) => <option key={c.id} value={`channel:${c.id}`}>Canal {c.name}</option>)}
                      {online.map((d) => <option key={d.id} value={`dev:${d.id.replace(/^dev:/, '')}`}>Puerta: {d.name}</option>)}
                    </select>
                  </Field>
                )}
                <button className="btn pri" disabled={!selectedTemplate || (selectedTemplate.requiresGate && !gate.trim())} onClick={sendOrder} data-testid="radio-order-send">Enviar orden</button>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === 'historial' && <Historial />}
      {tab === 'config' && <RadioConfigEditor session={session} onSaved={() => status.refresh()} />}
    </>
  );
}

function Historial() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const hist = usePoll((signal) => api<{ date: string; events: HistoryEvent[] }>(`/radio/events?date=${date}`, { signal }), 10_000, [date]);
  const text = (e: HistoryEvent) => {
    if (!e.meta) return '—';
    if (e.meta.type === 'radio_ptt') return `${e.meta.by} habló ${(e.meta.durationMs / 1000).toFixed(1)} s${e.meta.emergency ? ' · EMERGENCIA' : ''}`;
    if (e.meta.type === 'radio_order') return `Orden "${e.meta.text}" de ${e.meta.by} → ${e.meta.to ?? e.meta.channel ?? 'todos'}`;
    return `${e.meta.by} recibió ${e.meta.code}`;
  };
  return (
    <Card className="flush" title="Historial del día" right={<input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Día" />}>
      <div className="tbl">
        {hist.data && hist.data.events.length === 0 ? <Empty>Sin actividad de radio ese día.</Empty> : (
          <table data-testid="radio-history">
            <thead><tr><th>Hora</th><th>Canal</th><th>Qué pasó</th></tr></thead>
            <tbody>{hist.data?.events.map((e) => <tr key={e.id}><td>{hhmm(e.at)}</td><td>{e.channel}</td><td>{text(e)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <p className="muted small" style={{ padding: '0 18px 12px' }}>No se graba audio: solo quién habló, dónde y cuánto, más órdenes y acuses (log append-only).</p>
    </Card>
  );
}

function RadioConfigEditor({ session, onSaved }: { session: Session; onSaved: () => void }) {
  const { toast } = useToast();
  const ro = session.user.role !== 'ADMIN';
  const [cfg, setCfg] = useState<EventConfig | null>(null);
  const [errors, setErrors] = useState<Array<{ path: string; message: string }>>([]);
  const [busy, setBusy] = useState(false);
  const load = () => api<{ config: EventConfig }>('/config').then((r) => setCfg(structuredClone(r.config)));
  useEffect(() => { void load(); }, []);
  const radio = cfg?.radio;
  const err = (p: string) => errors.find((e) => e.path === p)?.message;
  const setRadio = (patch: Partial<NonNullable<EventConfig['radio']>>) => setCfg((c) => (c && c.radio ? { ...c, radio: { ...c.radio, ...patch } } : c));
  const list = (v: string[]) => v.join(', ');
  const parseList = (v: string) => v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean).map((x) => (x === '*' ? '*' : x));
  const editorErrors = useMemo(() => errors.filter((e) => e.path.startsWith('radio')), [errors]);
  async function save() {
    if (!cfg) return;
    setBusy(true); setErrors([]);
    try {
      await api('/config', { method: 'PUT', body: { config: cfg, expectedVersion: cfg.configVersion } });
      toast('Canales y órdenes guardados. Los scanners los reciben al instante.');
      await load();
      onSaved();
    } catch (e) {
      const errs = (e as { errors?: Array<{ path: string; message: string }> }).errors;
      if (errs) setErrors(errs); else toast(errorText(e), 'error');
    } finally { setBusy(false); }
  }
  if (!cfg || !radio) return <Card title="Canales y órdenes"><p className="muted">Cargando…</p></Card>;
  const roles = 'Roles: CONTROL, SUPERVISOR (scanners) · ADMIN, COORDINATOR, PRINTER, REGISTRAR, AUDITOR (panel) · * = todos';
  return (
    <div className="stack">
      <Card title="Canales" right={<span className="muted small">{roles}</span>}>
        {editorErrors.length > 0 && <ErrorBox text={editorErrors.map((e) => `${e.path}: ${e.message}`).join(' · ')} />}
        <div className="tbl">
          <table data-testid="radio-config-channels">
            <thead><tr><th>Id</th><th>Nombre</th><th>Color</th><th>Hablan</th><th>Escuchan</th><th>Prioridad</th><th>Emergencia</th><th /></tr></thead>
            <tbody>
              {radio.channels.map((c, i) => (
                <tr key={i}>
                  <td><input value={c.id} disabled={ro} style={{ width: 110 }} onChange={(e) => setRadio({ channels: radio.channels.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} aria-invalid={!!err(`radio.channels[${i}].id`)} /></td>
                  <td><input value={c.name} disabled={ro} style={{ width: 130 }} onChange={(e) => setRadio({ channels: radio.channels.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></td>
                  <td><input type="color" value={c.color} disabled={ro} onChange={(e) => setRadio({ channels: radio.channels.map((x, j) => (j === i ? { ...x, color: e.target.value.toUpperCase() } : x)) })} /></td>
                  <td><input value={list(c.talk)} disabled={ro} style={{ width: 160 }} onChange={(e) => setRadio({ channels: radio.channels.map((x, j) => (j === i ? { ...x, talk: parseList(e.target.value) } : x)) })} /></td>
                  <td><input value={list(c.listen)} disabled={ro} style={{ width: 160 }} onChange={(e) => setRadio({ channels: radio.channels.map((x, j) => (j === i ? { ...x, listen: parseList(e.target.value) } : x)) })} /></td>
                  <td><input type="number" min={0} value={c.priority} disabled={ro} style={{ width: 70 }} onChange={(e) => setRadio({ channels: radio.channels.map((x, j) => (j === i ? { ...x, priority: Number(e.target.value) } : x)) })} /></td>
                  <td><input type="checkbox" checked={!!c.emergency} disabled={ro} onChange={(e) => setRadio({ channels: radio.channels.map((x, j) => (j === i ? { ...x, emergency: e.target.checked } : x)) })} aria-label="Canal de emergencia" /></td>
                  <td>{!ro && <button className="btn sm" onClick={() => setRadio({ channels: radio.channels.filter((_, j) => j !== i) })}>Quitar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ro && <button className="btn sm" onClick={() => setRadio({ channels: [...radio.channels, { id: 'nuevo', name: 'Nuevo canal', color: '#64748B', talk: ['*'], listen: ['*'], priority: 0 }] })}>Añadir canal</button>}
        <Field label="Máximo de equipos por canal" hint="Malla P2P: cada equipo manda su audio a todos los demás del canal (~40 kbps por par). Recomendado ≤ 10.">
          <input type="number" min={2} max={30} value={radio.maxPerChannel} disabled={ro} style={{ width: 90 }} onChange={(e) => setRadio({ maxPerChannel: Number(e.target.value) })} />
        </Field>
      </Card>
      <Card title="Catálogo de órdenes" right={<span className="muted small">{'{n}'} = puerta elegida al enviar</span>}>
        <div className="tbl">
          <table data-testid="radio-config-orders">
            <thead><tr><th>Código</th><th>Texto (se lee en voz alta)</th><th>Pide puerta</th><th>Emergencia</th><th /></tr></thead>
            <tbody>
              {radio.orders.map((o: RadioOrderTemplate, i: number) => (
                <tr key={i}>
                  <td><input value={o.code} disabled={ro} style={{ width: 170 }} onChange={(e) => setRadio({ orders: radio.orders.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)) })} /></td>
                  <td><input value={o.label} disabled={ro} style={{ width: 260 }} onChange={(e) => setRadio({ orders: radio.orders.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></td>
                  <td><input type="checkbox" checked={!!o.requiresGate} disabled={ro} onChange={(e) => setRadio({ orders: radio.orders.map((x, j) => (j === i ? { ...x, requiresGate: e.target.checked } : x)) })} aria-label="Pide puerta" /></td>
                  <td><input type="checkbox" checked={!!o.emergency} disabled={ro} onChange={(e) => setRadio({ orders: radio.orders.map((x, j) => (j === i ? { ...x, emergency: e.target.checked } : x)) })} aria-label="Orden de emergencia" /></td>
                  <td>{!ro && <button className="btn sm" onClick={() => setRadio({ orders: radio.orders.filter((_, j) => j !== i) })}>Quitar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ro && <button className="btn sm" onClick={() => setRadio({ orders: [...radio.orders, { code: 'NUEVA', label: 'Nueva orden' }] })}>Añadir orden</button>}
      </Card>
      {ro ? <p className="muted small">Solo el Administrador cambia canales y órdenes.</p> : <div className="inline"><button className="btn pri" disabled={busy} onClick={() => void save()} data-testid="radio-config-save">{busy ? 'Guardando…' : 'Guardar'}</button><button className="btn" disabled={busy} onClick={() => void load()}>Descartar cambios</button></div>}
    </div>
  );
}
