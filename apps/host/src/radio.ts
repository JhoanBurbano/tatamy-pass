/**
 * Tatami Radio en el host (ADR-0010, docs/34): señalización WebSocket para la
 * malla P2P de voz. El host NUNCA recibe ni reenvía audio: solo presencia,
 * SDP/ICE entre pares, arbitraje de "pulsar para hablar" y órdenes con acuse.
 * Los hechos (quién habló, órdenes, acuses) van al mismo log append-only de
 * los escaneos bajo el dispositivo virtual `radio` (solo en el primario).
 */
import type { WebSocket } from 'ws';
import {
  RadioArbiter, buildRadioEvent, parseClientMessage, radioConfigOf, RADIO_EVENT_DEVICE_ID,
  type RadioClientMessage, type RadioEventMetaInput, type RadioOrder, type RadioParticipant, type RadioServerMessage, type ScanEvent
} from '@tatami/core';
import type { AppContext } from './server.js';

interface Conn { ws: WebSocket; p: RadioParticipant; alive: boolean }

/** Intervalo del ping del servidor; un socket sin pong en dos intervalos se cierra. */
export const RADIO_PING_MS = 20_000;

export class RadioHub {
  arbiter: RadioArbiter;
  private conns = new Map<string, Conn>();
  private seq: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private ctx: AppContext) {
    this.arbiter = new RadioArbiter(radioConfigOf(ctx.config));
    this.seq = ctx.scans.maxSeq(RADIO_EVENT_DEVICE_ID);
  }

  /** Tras `PUT /config`: canales y órdenes nuevos sin desconectar a nadie. */
  reloadConfig(): void {
    this.arbiter.setConfig(radioConfigOf(this.ctx.config));
    const msg = { type: 'welcome' as const, channels: this.arbiter.config.channels, orders: this.arbiter.config.orders, serverTime: new Date().toISOString(), emergency: this.arbiter.emergencySpeaker() };
    for (const c of this.conns.values()) this.send(c.p.id, { ...msg, self: c.p });
  }

  connected(): number {
    return this.conns.size;
  }

  status() {
    const s = this.arbiter.status();
    return { ...s, connected: this.conns.size, orders: this.arbiter.recentOrders(50), at: new Date().toISOString() };
  }

  /** Nuevo socket autenticado. Si el mismo participante ya estaba (otra pestaña/reconexión), se cierra el anterior. */
  attach(ws: WebSocket, p: RadioParticipant): void {
    const prev = this.conns.get(p.id);
    if (prev && prev.ws !== ws) { try { prev.ws.close(4000, 'Conectado desde otro lugar'); } catch { /* nada */ } this.detach(p.id, prev.ws); }
    const conn: Conn = { ws, p, alive: true };
    this.conns.set(p.id, conn);
    this.send(p.id, { type: 'welcome', self: p, channels: this.arbiter.config.channels, orders: this.arbiter.config.orders, serverTime: new Date().toISOString(), emergency: this.arbiter.emergencySpeaker() });
    ws.on('message', (data) => {
      let raw: unknown;
      try { raw = JSON.parse(String(data)); } catch { return this.send(p.id, { type: 'error', error: 'Mensaje no válido.' }); }
      const msg = parseClientMessage(raw);
      if (!msg) return this.send(p.id, { type: 'error', error: 'Mensaje no válido.' });
      try { this.handle(p.id, msg); } catch (e) { this.send(p.id, { type: 'error', error: (e as Error).message }); }
    });
    ws.on('pong', () => { conn.alive = true; });
    ws.on('close', () => this.detach(p.id, ws));
    ws.on('error', () => this.detach(p.id, ws));
    this.ensureTimer();
  }

  private detach(id: string, ws: WebSocket): void {
    const c = this.conns.get(id);
    if (!c || c.ws !== ws) return;
    this.conns.delete(id);
    this.leave(id);
    if (this.conns.size === 0 && this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      for (const c of this.conns.values()) {
        if (!c.alive) { try { c.ws.terminate(); } catch { /* nada */ } continue; }
        c.alive = false;
        try { c.ws.ping(); } catch { /* nada */ }
      }
    }, RADIO_PING_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const c of this.conns.values()) { try { c.ws.close(1001, 'El host se apaga'); } catch { /* nada */ } }
    this.conns.clear();
  }

  private send(id: string, msg: RadioServerMessage): void {
    const c = this.conns.get(id);
    if (!c || c.ws.readyState !== c.ws.OPEN) return;
    try { c.ws.send(JSON.stringify(msg)); } catch { /* el socket se cerró en medio */ }
  }

  private broadcast(channel: string, msg: RadioServerMessage, except?: string): void {
    for (const m of this.arbiter.members(channel)) if (m.id !== except) this.send(m.id, msg);
  }

  private broadcastAll(msg: RadioServerMessage): void {
    for (const id of this.conns.keys()) this.send(id, msg);
  }

  private persist(meta: RadioEventMetaInput): ScanEvent | undefined {
    if (this.ctx.mode !== 'primary') return undefined;
    const e = buildRadioEvent({ seq: ++this.seq, at: new Date().toISOString(), meta });
    this.ctx.scans.appendBatch([e]);
    return e;
  }

  private afterRelease(rel: { channel: string; speaker: RadioParticipant; startedAt: number; durationMs: number; emergency: boolean; next: RadioParticipant | null } | null): void {
    if (!rel) return;
    this.persist({ type: 'radio_ptt', by: rel.speaker.name, participantId: rel.speaker.id, kind: rel.speaker.kind, channel: rel.channel, startedAt: new Date(rel.startedAt).toISOString(), durationMs: rel.durationMs, emergency: rel.emergency });
    this.send(rel.speaker.id, { type: 'ptt-ended', channel: rel.channel });
    if (rel.next) this.send(rel.next.id, { type: 'ptt-granted', channel: rel.channel });
    this.broadcast(rel.channel, { type: 'speaking', channel: rel.channel, speaker: rel.next });
    if (rel.emergency) this.broadcastAll({ type: 'emergency', active: !!rel.next, speaker: rel.next, channel: rel.channel });
  }

  private leave(id: string): void {
    const { channel, released } = this.arbiter.leave(id, Date.now());
    if (!channel) return;
    this.broadcast(channel, { type: 'peer-left', channel, participantId: id });
    this.afterRelease(released);
  }

  private presenceOf(channel: string): RadioServerMessage {
    return { type: 'presence', channel, participants: this.arbiter.members(channel), speaker: this.arbiter.speaker(channel) };
  }

  handle(id: string, msg: RadioClientMessage): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    const p = conn.p;
    const now = Date.now();
    switch (msg.type) {
      case 'ping': return this.send(id, { type: 'pong', serverTime: new Date().toISOString() });
      case 'join': {
        const r = this.arbiter.join(p, msg.channel, now);
        if (!r.ok) return this.send(id, { type: 'error', error: r.error });
        if (r.previous && r.previous !== msg.channel) {
          this.broadcast(r.previous, { type: 'peer-left', channel: r.previous, participantId: id });
          this.afterRelease(r.released);
        }
        this.send(id, this.presenceOf(msg.channel));
        if (r.previous !== msg.channel) this.broadcast(msg.channel, { type: 'peer-joined', channel: msg.channel, participant: p }, id);
        const em = this.arbiter.emergencySpeaker();
        if (em) this.send(id, { type: 'emergency', active: true, speaker: em, channel: this.arbiter.channelOf(em.id)! });
        return;
      }
      case 'leave': return this.leave(id);
      case 'offer':
      case 'answer':
      case 'ice': {
        if (!this.conns.has(msg.to)) return;
        const relay = msg.type === 'ice' ? { type: 'ice' as const, from: id, candidate: msg.candidate } : { type: msg.type, from: id, sdp: msg.sdp };
        return this.send(msg.to, relay);
      }
      case 'ptt-start': {
        const r = this.arbiter.requestTalk(id, now);
        if (!r.granted) return this.send(id, 'error' in r ? { type: 'error', error: r.error } : { type: 'ptt-busy', channel: r.channel, speaker: r.busy, position: r.position });
        this.send(id, { type: 'ptt-granted', channel: r.channel });
        this.broadcast(r.channel, { type: 'speaking', channel: r.channel, speaker: p });
        if (r.emergency) this.broadcastAll({ type: 'emergency', active: true, speaker: p, channel: r.channel });
        return;
      }
      case 'ptt-end': return this.afterRelease(this.arbiter.releaseTalk(id, now));
      case 'order': {
        const r = this.arbiter.createOrder(p, msg, now);
        if (!r.ok) return this.send(id, { type: 'error', error: r.error });
        this.persist({ type: 'radio_order', by: p.name, participantId: p.id, orderId: r.order.id, code: r.order.code, text: r.order.text, channel: r.order.channel, to: r.order.to, emergency: r.order.emergency });
        const out: RadioServerMessage = { type: 'order', order: r.order };
        const sent = new Set<string>();
        for (const rcpt of r.recipients) { this.send(rcpt.id, out); sent.add(rcpt.id); }
        this.send(id, out); sent.add(id);
        for (const c of this.conns.values()) if (c.p.kind === 'user' && !sent.has(c.p.id)) this.send(c.p.id, out);
        return;
      }
      case 'ack': {
        const r = this.arbiter.ack(msg.orderId, p, now);
        if (!r.ok) return this.send(id, { type: 'error', error: r.error });
        if (r.first) this.persist({ type: 'radio_ack', by: p.name, participantId: p.id, orderId: r.order.id, code: r.order.code });
        const at = r.order.acks.find((a) => a.by.id === id)?.at ?? new Date(now).toISOString();
        const out: RadioServerMessage = { type: 'ack', orderId: r.order.id, by: p, at };
        const targets = new Set<string>([id, r.order.from.id]);
        for (const c of this.conns.values()) if (c.p.kind === 'user') targets.add(c.p.id);
        for (const t of targets) this.send(t, out);
        return;
      }
    }
  }

  /** Órdenes vivas (en memoria) para el estado. */
  orders(): RadioOrder[] {
    return this.arbiter.recentOrders(50);
  }
}
