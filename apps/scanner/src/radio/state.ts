/**
 * Estado de Tatami Radio en el scanner (puro, sin IO): lo que ve la pantalla.
 * `RadioClient` lo actualiza con `reduce()` a partir de los mensajes del host
 * y de lo que hace el operador; aquí no hay WebSocket ni WebRTC, por eso se
 * prueba en Node.
 */
import type { RadioChannel, RadioOrder, RadioOrderTemplate, RadioParticipant, RadioServerMessage } from '@tatami/core';

export type RadioConnection = 'off' | 'connecting' | 'online' | 'reconnecting';
export type MicState = 'unknown' | 'granted' | 'denied';
/** Estado del botón "pulsar para hablar". `local` = hablando sin host (solo con quien ya estaba conectado). */
export type PttState = 'idle' | 'requesting' | 'talking' | 'busy' | 'local';
export type PeerState = 'connecting' | 'connected' | 'failed';

export interface ReceivedOrder {
  order: RadioOrder;
  receivedAt: string;
  acked: boolean;
  /** Acuse pendiente de enviar (el host no respondía). */
  ackPending: boolean;
}

export interface RadioState {
  connection: RadioConnection;
  mic: MicState;
  self?: RadioParticipant;
  channels: RadioChannel[];
  orderCatalog: RadioOrderTemplate[];
  channel?: string;
  /** Canal al que volver cuando termine la emergencia. */
  returnTo?: string;
  participants: RadioParticipant[];
  speaker: RadioParticipant | null;
  ptt: PttState;
  busyWith?: RadioParticipant;
  queuePosition?: number;
  emergency: RadioParticipant | null;
  peers: Record<string, PeerState>;
  orders: ReceivedOrder[];
  /** 0–1. */
  volume: number;
  error?: string;
  talkingSince?: number;
}

export const initialRadioState = (): RadioState => ({
  connection: 'off', mic: 'unknown', channels: [], orderCatalog: [], participants: [], speaker: null, ptt: 'idle', emergency: null, peers: {}, orders: [], volume: 1
});

export type RadioAction =
  | { type: 'ws'; connection: RadioConnection }
  | { type: 'mic'; mic: MicState }
  | { type: 'server'; msg: RadioServerMessage; now: number }
  | { type: 'ptt-down'; now: number }
  | { type: 'ptt-up' }
  | { type: 'peer'; id: string; state: PeerState | null }
  | { type: 'ack'; orderId: string; sent: boolean }
  | { type: 'volume'; volume: number }
  | { type: 'joining'; channel: string; returnTo?: string }
  | { type: 'clear-error' };

const MAX_ORDERS = 30;

export function reduce(s: RadioState, a: RadioAction): RadioState {
  switch (a.type) {
    case 'ws': {
      if (a.connection === s.connection) return s;
      const next: RadioState = { ...s, connection: a.connection };
      if (a.connection !== 'online') {
        // Sin host no hay arbitraje: lo que se estaba pidiendo se cancela; si se hablaba, se sigue en local.
        if (s.ptt === 'requesting' || s.ptt === 'busy') next.ptt = 'idle';
        if (s.ptt === 'talking') next.ptt = 'local';
        next.busyWith = undefined; next.queuePosition = undefined;
      }
      return next;
    }
    case 'mic': return s.mic === a.mic ? s : { ...s, mic: a.mic };
    case 'volume': return { ...s, volume: Math.min(1, Math.max(0, a.volume)) };
    case 'clear-error': return s.error ? { ...s, error: undefined } : s;
    case 'joining': return { ...s, channel: a.channel, returnTo: a.returnTo ?? (a.channel === s.returnTo ? undefined : s.returnTo), participants: [], speaker: null, ptt: s.ptt === 'local' ? 'local' : 'idle', busyWith: undefined, queuePosition: undefined };
    case 'ptt-down': {
      if (s.mic === 'denied') return { ...s, error: 'Sin micrófono: solo escuchas. Da permiso al micrófono para hablar.' };
      if (s.connection !== 'online') return { ...s, ptt: 'local', talkingSince: a.now };
      return s.ptt === 'talking' ? s : { ...s, ptt: 'requesting', error: undefined };
    }
    case 'ptt-up': return { ...s, ptt: 'idle', busyWith: undefined, queuePosition: undefined, talkingSince: undefined };
    case 'peer': {
      const peers = { ...s.peers };
      if (a.state === null) delete peers[a.id]; else peers[a.id] = a.state;
      return { ...s, peers };
    }
    case 'ack': return { ...s, orders: s.orders.map((o) => (o.order.id === a.orderId ? { ...o, acked: true, ackPending: !a.sent } : o)) };
    case 'server': return reduceServer(s, a.msg, a.now);
  }
}

function reduceServer(s: RadioState, m: RadioServerMessage, now: number): RadioState {
  switch (m.type) {
    case 'welcome': return { ...s, self: m.self, channels: m.channels, orderCatalog: m.orders, emergency: m.emergency, error: undefined };
    case 'presence': return m.channel === s.channel ? { ...s, participants: m.participants, speaker: m.speaker } : s;
    case 'peer-joined': return m.channel !== s.channel || s.participants.some((p) => p.id === m.participant.id) ? s : { ...s, participants: [...s.participants, m.participant] };
    case 'peer-left': {
      if (m.channel !== s.channel) return s;
      const peers = { ...s.peers };
      delete peers[m.participantId];
      return { ...s, participants: s.participants.filter((p) => p.id !== m.participantId), speaker: s.speaker?.id === m.participantId ? null : s.speaker, peers };
    }
    case 'ptt-granted': return { ...s, ptt: 'talking', busyWith: undefined, queuePosition: undefined, talkingSince: s.talkingSince ?? now, error: undefined };
    case 'ptt-busy': return { ...s, ptt: 'busy', busyWith: m.speaker, queuePosition: m.position };
    case 'ptt-ended': return s.ptt === 'talking' ? { ...s, ptt: 'idle', talkingSince: undefined } : s;
    case 'speaking': return m.channel === s.channel ? { ...s, speaker: m.speaker } : s;
    case 'emergency': return { ...s, emergency: m.active ? m.speaker : null };
    case 'order': {
      if (s.orders.some((o) => o.order.id === m.order.id)) return s;
      return { ...s, orders: [{ order: m.order, receivedAt: new Date(now).toISOString(), acked: false, ackPending: false }, ...s.orders].slice(0, MAX_ORDERS) };
    }
    case 'ack': return { ...s, orders: s.orders.map((o) => (o.order.id === m.orderId && !o.order.acks.some((x) => x.by.id === m.by.id) ? { ...o, order: { ...o.order, acks: [...o.order.acks, { by: m.by, at: m.at }] } } : o)) };
    case 'error': return { ...s, error: m.error, ptt: s.ptt === 'requesting' ? 'idle' : s.ptt };
    case 'offer': case 'answer': case 'ice': case 'pong': return s;
  }
}

/** Texto del botón grande (docs/70 §4.5). */
export function pttLabel(s: RadioState): { title: string; sub: string; tone: 'idle' | 'talking' | 'busy' | 'off' } {
  const peersUp = Object.values(s.peers).filter((p) => p === 'connected').length;
  if (s.ptt === 'talking') return { title: 'Hablando', sub: 'Suelta para terminar', tone: 'talking' };
  if (s.ptt === 'local') return { title: 'Hablando (sin host)', sub: peersUp ? `Te oyen ${peersUp} ${peersUp === 1 ? 'equipo' : 'equipos'} que ya estaban` : 'Nadie conectado todavía', tone: 'talking' };
  if (s.ptt === 'busy') return { title: 'Ocupado', sub: `${s.busyWith?.name ?? 'Alguien'} está hablando · sigue pulsando y te toca`, tone: 'busy' };
  if (s.ptt === 'requesting') return { title: 'Pidiendo la palabra…', sub: '', tone: 'busy' };
  if (s.mic === 'denied') return { title: 'Sin micrófono', sub: 'Solo escuchas. Da permiso al micrófono para hablar.', tone: 'off' };
  if (s.connection !== 'online' && peersUp === 0) return { title: 'Sin radio', sub: s.connection === 'off' ? 'La radio está apagada' : 'Sin conexión con el host · reconectando', tone: 'off' };
  if (s.connection !== 'online') return { title: 'Escuchando (sin host)', sub: `Sin host: hablas solo con ${peersUp} ${peersUp === 1 ? 'equipo' : 'equipos'} ya conectados`, tone: 'idle' };
  if (s.speaker && s.speaker.id !== s.self?.id) return { title: `${s.speaker.name} hablando`, sub: 'Mantén pulsado para pedir la palabra', tone: 'busy' };
  return { title: 'Escuchando', sub: 'Mantén pulsado para hablar', tone: 'idle' };
}

/** Si una tecla (barra espaciadora) debe actuar como PTT: no cuando se escribe en un campo. */
export function isPttKey(e: { code?: string; key?: string; repeat?: boolean; target?: unknown }): boolean {
  if (e.repeat) return false;
  if (e.code !== 'Space' && e.key !== ' ') return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  return !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}
