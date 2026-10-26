/**
 * Tatami Radio: dominio puro de la voz por la LAN (ADR-0010, docs/34).
 *
 * - Canales (`RadioChannel`) con permisos por rol de scanner o de usuario,
 *   prioridad y uno de emergencia que interrumpe a todos.
 * - Mensajes de señalización WebSocket cliente ↔ host (`RadioClientMessage`,
 *   `RadioServerMessage`). El host NUNCA retransmite audio: solo SDP/ICE,
 *   presencia, arbitraje de "pulsar para hablar" (PTT) y órdenes con acuse.
 * - `RadioArbiter`: estado de las salas sin IO ni reloj (recibe `now`): un
 *   hablante por canal con cola (el primero habla, el segundo recibe
 *   "ocupado" y pasa a hablar si sigue pulsando cuando el primero suelta);
 *   Emergencia bloquea el PTT de los demás canales mientras dure.
 * - `buildRadioEvent`: hechos para el log de sync append-only (quién habló,
 *   dónde, cuándo y cuánto; órdenes y acuses). No se graba audio.
 */
import type { Decision, RadioChannel, RadioConfig, RadioOrderTemplate, ReasonCode, ScanEvent } from './types.js';

// ---------- defaults ----------

export const DEFAULT_RADIO_CHANNELS: RadioChannel[] = [
  { id: 'puertas', name: 'Puertas', color: '#1C4FD1', talk: ['*'], listen: ['*'], priority: 0 },
  { id: 'supervisores', name: 'Supervisores', color: '#0E7490', talk: ['SUPERVISOR', 'ADMIN', 'COORDINATOR'], listen: ['SUPERVISOR', 'ADMIN', 'COORDINATOR'], priority: 1 },
  { id: 'acreditacion', name: 'Acreditación', color: '#7C3AED', talk: ['ADMIN', 'COORDINATOR', 'PRINTER', 'REGISTRAR', 'SUPERVISOR'], listen: ['ADMIN', 'COORDINATOR', 'PRINTER', 'REGISTRAR', 'SUPERVISOR'], priority: 1 },
  { id: 'emergencia', name: 'Emergencia', color: '#E0323B', talk: ['*'], listen: ['*'], priority: 100, emergency: true }
];

export const DEFAULT_RADIO_ORDERS: RadioOrderTemplate[] = [
  { code: 'OPEN_GATE', label: 'Abrir Puerta {n}', requiresGate: true },
  { code: 'CLOSE_GATE', label: 'Cerrar Puerta {n}', requiresGate: true },
  { code: 'PAUSE', label: 'Pausar ingreso' },
  { code: 'RESUME', label: 'Reanudar ingreso' },
  { code: 'SUPERVISOR_TO_GATE', label: 'Supervisor a Puerta {n}', requiresGate: true },
  { code: 'EVACUATE', label: 'Evacuación', emergency: true }
];

export const DEFAULT_RADIO_MAX_PER_CHANNEL = 10;

export function createDefaultRadioConfig(): RadioConfig {
  return {
    channels: DEFAULT_RADIO_CHANNELS.map((c) => ({ ...c, talk: [...c.talk], listen: [...c.listen] })),
    orders: DEFAULT_RADIO_ORDERS.map((o) => ({ ...o })),
    maxPerChannel: DEFAULT_RADIO_MAX_PER_CHANNEL
  };
}

/** Config de radio efectiva: la del evento o la de por defecto si falta. */
export function radioConfigOf(config: { radio?: RadioConfig }): RadioConfig {
  return config.radio ?? createDefaultRadioConfig();
}

/** Roles (de usuario o de scanner) que pueden enviar órdenes. */
export const ORDER_SENDERS = ['ADMIN', 'COORDINATOR', 'SUPERVISOR'];

// ---------- participantes y permisos ----------

export interface RadioParticipant {
  /** `dev:<deviceId>` o `usr:<username>`. */
  id: string;
  name: string;
  kind: 'device' | 'user';
  /** `CONTROL` / `SUPERVISOR` (scanner) o rol de usuario del panel. */
  role: string;
  zone?: string;
}

export function participantId(kind: RadioParticipant['kind'], id: string): string {
  return `${kind === 'device' ? 'dev' : 'usr'}:${id}`;
}

function roleAllowed(list: string[], role: string): boolean {
  return list.includes('*') || list.includes(role);
}

export function canListen(channel: RadioChannel, role: string): boolean {
  return roleAllowed(channel.listen, role);
}

export function canTalk(channel: RadioChannel, role: string): boolean {
  return canListen(channel, role) && roleAllowed(channel.talk, role);
}

export function canSendOrders(role: string): boolean {
  return ORDER_SENDERS.includes(role);
}

export function emergencyChannel(config: RadioConfig): RadioChannel | undefined {
  return config.channels.find((c) => c.emergency);
}

/** Canales que un rol puede escuchar, ordenados por prioridad descendente y luego por orden de config. */
export function channelsFor(config: RadioConfig, role: string): RadioChannel[] {
  return config.channels.filter((c) => canListen(c, role));
}

/** Texto final de una orden: sustituye `{n}` por la puerta. */
export function orderText(template: RadioOrderTemplate, gate?: string): string {
  return template.label.replace(/\{n\}/g, gate?.trim() || '—');
}

// ---------- mensajes de señalización ----------

export interface RadioOrderAck { by: RadioParticipant; at: string }

export interface RadioOrder {
  id: string;
  code: string;
  text: string;
  gate?: string;
  /** Canal destinatario (o `undefined` si va a un participante concreto). */
  channel?: string;
  /** Participante destinatario concreto (`dev:…`). */
  to?: string;
  from: RadioParticipant;
  at: string;
  emergency: boolean;
  acks: RadioOrderAck[];
}

export type RadioClientMessage =
  | { type: 'join'; channel: string }
  | { type: 'leave' }
  | { type: 'offer'; to: string; sdp: string }
  | { type: 'answer'; to: string; sdp: string }
  | { type: 'ice'; to: string; candidate: unknown }
  | { type: 'ptt-start' }
  | { type: 'ptt-end' }
  | { type: 'order'; code: string; gate?: string; channel?: string; to?: string }
  | { type: 'ack'; orderId: string }
  | { type: 'ping' };

export type RadioServerMessage =
  | { type: 'welcome'; self: RadioParticipant; channels: RadioChannel[]; orders: RadioOrderTemplate[]; serverTime: string; emergency: RadioParticipant | null }
  | { type: 'presence'; channel: string; participants: RadioParticipant[]; speaker: RadioParticipant | null }
  | { type: 'peer-joined'; channel: string; participant: RadioParticipant }
  | { type: 'peer-left'; channel: string; participantId: string }
  | { type: 'offer'; from: string; sdp: string }
  | { type: 'answer'; from: string; sdp: string }
  | { type: 'ice'; from: string; candidate: unknown }
  | { type: 'ptt-granted'; channel: string }
  | { type: 'ptt-busy'; channel: string; speaker: RadioParticipant; position: number }
  | { type: 'ptt-ended'; channel: string }
  | { type: 'speaking'; channel: string; speaker: RadioParticipant | null }
  | { type: 'emergency'; active: boolean; speaker: RadioParticipant | null; channel: string }
  | { type: 'order'; order: RadioOrder }
  | { type: 'ack'; orderId: string; by: RadioParticipant; at: string }
  | { type: 'error'; error: string }
  | { type: 'pong'; serverTime: string };

const CLIENT_TYPES = new Set(['join', 'leave', 'offer', 'answer', 'ice', 'ptt-start', 'ptt-end', 'order', 'ack', 'ping']);

/** Valida la forma mínima de un mensaje de cliente (JSON ya parseado). */
export function parseClientMessage(raw: unknown): RadioClientMessage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  if (typeof m.type !== 'string' || !CLIENT_TYPES.has(m.type)) return undefined;
  switch (m.type) {
    case 'join': return typeof m.channel === 'string' && m.channel ? { type: 'join', channel: m.channel } : undefined;
    case 'offer':
    case 'answer': return typeof m.to === 'string' && typeof m.sdp === 'string' ? { type: m.type, to: m.to, sdp: m.sdp } : undefined;
    case 'ice': return typeof m.to === 'string' ? { type: 'ice', to: m.to, candidate: m.candidate } : undefined;
    case 'order': return typeof m.code === 'string' ? { type: 'order', code: m.code, gate: typeof m.gate === 'string' ? m.gate : undefined, channel: typeof m.channel === 'string' ? m.channel : undefined, to: typeof m.to === 'string' ? m.to : undefined } : undefined;
    case 'ack': return typeof m.orderId === 'string' ? { type: 'ack', orderId: m.orderId } : undefined;
    default: return { type: m.type } as RadioClientMessage;
  }
}

// ---------- arbitraje (puro) ----------

interface Room {
  members: Map<string, RadioParticipant>;
  speaker: string | null;
  speakingSince: number;
  /** Quienes pulsaron mientras otro hablaba, en orden. */
  queue: string[];
}

export interface TalkGranted { granted: true; channel: string; emergency: boolean }
export interface TalkBusy { granted: false; busy: RadioParticipant; channel: string; position: number }
export interface TalkDenied { granted: false; error: string }
export type TalkResult = TalkGranted | TalkBusy | TalkDenied;

export interface TalkReleased {
  channel: string;
  speaker: RadioParticipant;
  startedAt: number;
  durationMs: number;
  emergency: boolean;
  /** Siguiente de la cola al que se le concede la palabra (si sigue pulsando). */
  next: RadioParticipant | null;
}

export interface RadioStatusChannel {
  channel: RadioChannel;
  participants: RadioParticipant[];
  speaker: RadioParticipant | null;
  queue: RadioParticipant[];
}

/**
 * Estado de salas, presencia, PTT y órdenes. Sin IO: el host lo envuelve con
 * WebSockets y le pasa `now` (epoch ms). Determinista para poder probarlo.
 */
export class RadioArbiter {
  private rooms = new Map<string, Room>();
  private where = new Map<string, string>();
  private orders = new Map<string, RadioOrder>();
  private orderSeq = 0;

  constructor(public config: RadioConfig) {
    for (const c of config.channels) this.rooms.set(c.id, { members: new Map(), speaker: null, speakingSince: 0, queue: [] });
  }

  channel(id: string): RadioChannel | undefined {
    return this.config.channels.find((c) => c.id === id);
  }

  /** Aplica una config nueva en caliente: crea las salas que falten y conserva las existentes (quien esté dentro se queda). */
  setConfig(config: RadioConfig): void {
    this.config = config;
    for (const c of config.channels) if (!this.rooms.has(c.id)) this.rooms.set(c.id, { members: new Map(), speaker: null, speakingSince: 0, queue: [] });
  }

  channelOf(participantId: string): string | undefined {
    return this.where.get(participantId);
  }

  participant(id: string): RadioParticipant | undefined {
    const ch = this.where.get(id);
    return ch ? this.rooms.get(ch)?.members.get(id) : undefined;
  }

  /** Quién habla ahora en el canal de emergencia (interrumpe a todos). */
  emergencySpeaker(): RadioParticipant | null {
    const em = emergencyChannel(this.config);
    if (!em) return null;
    const room = this.rooms.get(em.id)!;
    return room.speaker ? room.members.get(room.speaker) ?? null : null;
  }

  members(channelId: string): RadioParticipant[] {
    return [...(this.rooms.get(channelId)?.members.values() ?? [])];
  }

  speaker(channelId: string): RadioParticipant | null {
    const room = this.rooms.get(channelId);
    return room?.speaker ? room.members.get(room.speaker) ?? null : null;
  }

  /** Entra a un canal (sale del anterior). Devuelve el canal anterior y los compañeros del nuevo. */
  join(p: RadioParticipant, channelId: string, now: number): { ok: true; previous: string | undefined; peers: RadioParticipant[]; released: TalkReleased | null } | { ok: false; error: string } {
    const ch = this.channel(channelId);
    if (!ch) return { ok: false, error: 'Ese canal no existe.' };
    if (!canListen(ch, p.role)) return { ok: false, error: `Tu rol no puede entrar al canal ${ch.name}.` };
    const previous = this.where.get(p.id);
    if (previous === channelId) {
      this.rooms.get(channelId)!.members.set(p.id, p);
      return { ok: true, previous, peers: this.members(channelId).filter((m) => m.id !== p.id), released: null };
    }
    const room = this.rooms.get(channelId)!;
    if (room.members.size >= this.config.maxPerChannel) return { ok: false, error: `El canal ${ch.name} está lleno (${this.config.maxPerChannel}). Usa otro canal o pide al supervisor que lo amplíe.` };
    const released = previous ? this.leave(p.id, now).released : null;
    room.members.set(p.id, p);
    this.where.set(p.id, channelId);
    return { ok: true, previous, peers: this.members(channelId).filter((m) => m.id !== p.id), released };
  }

  /** Sale del canal actual (suelta el PTT si hablaba). */
  leave(id: string, now: number): { channel: string | undefined; released: TalkReleased | null } {
    const channel = this.where.get(id);
    if (!channel) return { channel: undefined, released: null };
    const released = this.releaseTalk(id, now);
    const room = this.rooms.get(channel)!;
    room.members.delete(id);
    room.queue = room.queue.filter((q) => q !== id);
    this.where.delete(id);
    return { channel, released };
  }

  /** Pulsar para hablar en el canal actual. */
  requestTalk(id: string, now: number): TalkResult {
    const channelId = this.where.get(id);
    const ch = channelId ? this.channel(channelId) : undefined;
    const room = channelId ? this.rooms.get(channelId) : undefined;
    const p = room?.members.get(id);
    if (!ch || !room || !p) return { granted: false, error: 'Entra a un canal antes de hablar.' };
    if (!canTalk(ch, p.role)) return { granted: false, error: `En ${ch.name} solo escuchas: tu rol no puede hablar aquí.` };
    const em = this.emergencySpeaker();
    if (em && !ch.emergency && em.id !== id) return { granted: false, busy: em, channel: channelId!, position: 0 };
    if (room.speaker === id) return { granted: true, channel: channelId!, emergency: !!ch.emergency };
    if (room.speaker) {
      if (!room.queue.includes(id)) room.queue.push(id);
      return { granted: false, busy: room.members.get(room.speaker)!, channel: channelId!, position: room.queue.indexOf(id) + 1 };
    }
    room.speaker = id;
    room.speakingSince = now;
    room.queue = room.queue.filter((q) => q !== id);
    return { granted: true, channel: channelId!, emergency: !!ch.emergency };
  }

  /** Soltar el PTT (o abandonar la cola). Devuelve qué se habló y a quién le toca. */
  releaseTalk(id: string, now: number): TalkReleased | null {
    const channelId = this.where.get(id);
    const room = channelId ? this.rooms.get(channelId) : undefined;
    if (!channelId || !room) return null;
    room.queue = room.queue.filter((q) => q !== id);
    if (room.speaker !== id) return null;
    const speaker = room.members.get(id)!;
    const startedAt = room.speakingSince;
    room.speaker = null;
    let next: RadioParticipant | null = null;
    while (room.queue.length && !next) {
      const candidate = room.queue.shift()!;
      const member = room.members.get(candidate);
      if (member) { next = member; room.speaker = candidate; room.speakingSince = now; }
    }
    return { channel: channelId, speaker, startedAt, durationMs: Math.max(0, now - startedAt), emergency: !!this.channel(channelId)?.emergency, next };
  }

  /** Crea una orden con destino canal o participante concreto. */
  createOrder(from: RadioParticipant, input: { code: string; gate?: string; channel?: string; to?: string }, now: number): { ok: true; order: RadioOrder; recipients: RadioParticipant[] } | { ok: false; error: string } {
    if (!canSendOrders(from.role)) return { ok: false, error: 'Solo supervisores, coordinación o administración envían órdenes.' };
    const template = this.config.orders.find((o) => o.code === input.code);
    if (!template) return { ok: false, error: 'Esa orden no está en el catálogo.' };
    if (template.requiresGate && !input.gate?.trim()) return { ok: false, error: 'Indica la puerta para esta orden.' };
    let recipients: RadioParticipant[];
    let channel = input.channel;
    if (input.to) {
      const target = this.participant(input.to);
      if (!target) return { ok: false, error: 'Ese equipo no está conectado a la radio.' };
      recipients = [target];
      channel = undefined;
    } else if (template.emergency) {
      recipients = [...this.where.keys()].map((id) => this.participant(id)!);
      channel = emergencyChannel(this.config)?.id ?? channel;
    } else {
      channel = channel ?? this.where.get(from.id);
      if (!channel || !this.channel(channel)) return { ok: false, error: 'Indica el canal al que va la orden.' };
      recipients = this.members(channel);
    }
    recipients = recipients.filter((r) => r.id !== from.id);
    const order: RadioOrder = {
      id: `ord-${now.toString(36)}-${(++this.orderSeq).toString(36)}`, code: template.code, text: orderText(template, input.gate), gate: input.gate?.trim() || undefined,
      channel, to: input.to, from, at: new Date(now).toISOString(), emergency: !!template.emergency, acks: []
    };
    this.orders.set(order.id, order);
    return { ok: true, order, recipients };
  }

  /** Acusa recibo de una orden (idempotente por participante). */
  ack(orderId: string, by: RadioParticipant, now: number): { ok: true; order: RadioOrder; first: boolean } | { ok: false; error: string } {
    const order = this.orders.get(orderId);
    if (!order) return { ok: false, error: 'Esa orden ya no existe.' };
    if (order.acks.some((a) => a.by.id === by.id)) return { ok: true, order, first: false };
    order.acks.push({ by, at: new Date(now).toISOString() });
    return { ok: true, order, first: true };
  }

  order(id: string): RadioOrder | undefined {
    return this.orders.get(id);
  }

  /** Órdenes recientes (las últimas `limit`, más nueva primero). */
  recentOrders(limit = 50): RadioOrder[] {
    return [...this.orders.values()].slice(-limit).reverse();
  }

  status(): { channels: RadioStatusChannel[]; connected: number; emergency: RadioParticipant | null } {
    const channels = this.config.channels.map((channel) => {
      const room = this.rooms.get(channel.id)!;
      return { channel, participants: [...room.members.values()], speaker: room.speaker ? room.members.get(room.speaker) ?? null : null, queue: room.queue.map((q) => room.members.get(q)).filter((m): m is RadioParticipant => !!m) };
    });
    return { channels, connected: this.where.size, emergency: this.emergencySpeaker() };
  }
}

// ---------- eventos para el log de sync ----------

/** `deviceId` virtual con el que el host guarda los hechos de la radio en el mismo log append-only. */
export const RADIO_EVENT_DEVICE_ID = 'radio';

export type RadioEventMeta =
  | { type: 'radio_ptt'; reason: string; by: string; participantId: string; kind: RadioParticipant['kind']; channel: string; startedAt: string; durationMs: number; emergency: boolean }
  | { type: 'radio_order'; reason: string; by: string; participantId: string; orderId: string; code: string; text: string; channel?: string; to?: string; emergency: boolean }
  | { type: 'radio_ack'; reason: string; by: string; participantId: string; orderId: string; code: string };

export type RadioEventMetaInput = RadioEventMeta extends infer M ? (M extends { reason: string } ? Omit<M, 'reason'> : never) : never;

export const RADIO_EVENT_REASON: Record<RadioEventMeta['type'], string> = { radio_ptt: 'RADIO_PTT', radio_order: 'RADIO_ORDER', radio_ack: 'RADIO_ACK' };

export function describeRadioEvent(meta: RadioEventMetaInput): string {
  switch (meta.type) {
    case 'radio_ptt': return `${meta.by} habló en ${meta.channel} ${Math.round(meta.durationMs / 100) / 10} s${meta.emergency ? ' · EMERGENCIA' : ''}`;
    case 'radio_order': return `Orden "${meta.text}" de ${meta.by} → ${meta.to ?? meta.channel ?? 'todos'}${meta.emergency ? ' · EMERGENCIA' : ''}`;
    case 'radio_ack': return `${meta.by} recibió la orden ${meta.code}`;
  }
}

/** Evento de radio con la forma de `ScanEvent` (decision `EVENT`, device `radio`, seq que asigna el host). */
export function buildRadioEvent(args: { seq: number; at: string; meta: RadioEventMetaInput }): ScanEvent {
  const { seq, at, meta } = args;
  const channel = 'channel' in meta && meta.channel ? meta.channel : RADIO_EVENT_DEVICE_ID;
  return {
    id: `${RADIO_EVENT_DEVICE_ID}:${seq}`,
    deviceId: RADIO_EVENT_DEVICE_ID, seq, zone: channel, at,
    credentialId: null, direction: 'IN',
    decision: 'EVENT' as unknown as Decision,
    reasonCode: RADIO_EVENT_REASON[meta.type] as ReasonCode,
    manual: { ...meta, reason: describeRadioEvent(meta) }
  };
}

export function isRadioEvent(e: Pick<ScanEvent, 'deviceId'>): boolean {
  return e.deviceId === RADIO_EVENT_DEVICE_ID;
}

export function radioEventMeta(e: Pick<ScanEvent, 'manual' | 'deviceId'>): RadioEventMeta | undefined {
  if (!isRadioEvent(e)) return undefined;
  const m = e.manual as (RadioEventMeta & { type?: string }) | undefined;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string' || !(m.type in RADIO_EVENT_REASON)) return undefined;
  return m;
}
