/**
 * Cliente de Tatami Radio (ADR-0010, docs/34): WebSocket de señalización con el
 * host + una RTCPeerConnection por compañero de canal (malla P2P en la LAN,
 * candidatos host, sin STUN/TURN). Audio Opus con cancelación de eco y
 * supresión de ruido, micrófono SILENCIADO salvo mientras se mantiene pulsado
 * el botón (PTT). El host nunca recibe audio.
 *
 * Resiliencia: si el host cae, los pares ya conectados siguen oyéndose y el
 * PTT pasa a modo local (sin arbitraje); el WebSocket reintenta con backoff y
 * al volver re-señaliza solo lo que falte (las conexiones vivas se conservan).
 *
 * Las dependencias del navegador (WebSocket, RTCPeerConnection, getUserMedia,
 * elementos de audio, voz, tonos) se inyectan para poder probar la lógica en Node.
 */
import type { RadioClientMessage, RadioParticipant, RadioServerMessage } from '@tatami/core';
import { initialRadioState, reduce, type RadioAction, type RadioState } from './state.js';

export interface RemoteAudio { setVolume(v: number): void; remove(): void }

export interface RadioDeps {
  WebSocket: new (url: string, protocols?: string | string[]) => WebSocket;
  RTCPeerConnection: new (config?: RTCConfiguration) => RTCPeerConnection;
  getUserMedia(): Promise<MediaStream>;
  attachRemote(stream: MediaStream, volume: number): RemoteAudio;
  now(): number;
  speak?(text: string): void;
  tone?(kind: 'order' | 'emergency' | 'ok'): void;
  vibrate?(pattern: number | number[]): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
}

export interface RadioOptions {
  hostUrl: string;
  token: string;
  /** Canal inicial (si el rol puede entrar). */
  channel?: string;
}

interface Peer {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  remote?: RemoteAudio;
  /** Si fuimos nosotros quienes ofrecimos (para resolver colisiones: gana el id menor). */
  initiator: boolean;
}

type Listener = (s: RadioState) => void;

export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 10_000;
/** Tras terminar una emergencia, cuánto esperar antes de volver al canal anterior. */
export const EMERGENCY_RETURN_MS = 5000;

export function radioWsUrl(hostUrl: string): string {
  return `${hostUrl.replace(/\/$/, '').replace(/^http/, 'ws')}/radio/ws`;
}

export class RadioClient {
  state: RadioState = initialRadioState();
  private listeners = new Set<Listener>();
  private ws: WebSocket | undefined;
  private peers = new Map<string, Peer>();
  private stream: MediaStream | undefined;
  private opts: RadioOptions | undefined;
  private stopped = true;
  private backoff = RECONNECT_MIN_MS;
  private reconnectTimer: unknown;
  private returnTimer: unknown;
  private pendingAcks = new Set<string>();
  private wantedChannel: string | undefined;

  constructor(private deps: RadioDeps) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private dispatch(a: RadioAction): void {
    const next = reduce(this.state, a);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l(next);
  }

  /** Enciende la radio: pide micrófono y conecta la señalización. */
  async start(opts: RadioOptions): Promise<void> {
    this.opts = opts;
    this.wantedChannel = opts.channel ?? this.wantedChannel;
    this.stopped = false;
    this.backoff = RECONNECT_MIN_MS;
    if (!this.stream) {
      try {
        this.stream = await this.deps.getUserMedia();
        for (const t of this.stream.getAudioTracks()) t.enabled = false;
        this.dispatch({ type: 'mic', mic: 'granted' });
      } catch {
        this.dispatch({ type: 'mic', mic: 'denied' });
      }
    }
    if (this.stopped) return;
    this.connect();
  }

  /** Apaga la radio: cierra el WebSocket y todas las conexiones; libera el micrófono. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) this.deps.clearTimeout(this.reconnectTimer);
    if (this.returnTimer) this.deps.clearTimeout(this.returnTimer);
    this.reconnectTimer = this.returnTimer = undefined;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    if (this.ws) { const w = this.ws; this.ws = undefined; try { w.close(); } catch { /* nada */ } }
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = undefined;
    this.state = initialRadioState();
    for (const l of this.listeners) l(this.state);
  }

  // ---------- señalización ----------

  private connect(): void {
    if (this.stopped || !this.opts) return;
    this.dispatch({ type: 'ws', connection: this.state.connection === 'off' ? 'connecting' : 'reconnecting' });
    let ws: WebSocket;
    try {
      ws = new this.deps.WebSocket(radioWsUrl(this.opts.hostUrl), ['tatami-radio', this.opts.token]);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoff = RECONNECT_MIN_MS;
      this.dispatch({ type: 'ws', connection: 'online' });
      if (this.wantedChannel) {
        if (this.state.channel !== this.wantedChannel) this.dispatch({ type: 'joining', channel: this.wantedChannel });
        this.send({ type: 'join', channel: this.wantedChannel });
      }
      for (const id of this.pendingAcks) this.send({ type: 'ack', orderId: id });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: RadioServerMessage;
      try { msg = JSON.parse(String(ev.data)) as RadioServerMessage; } catch { return; }
      void this.onServer(msg);
    };
    ws.onclose = () => { if (this.ws === ws) { this.ws = undefined; this.scheduleReconnect(); } };
    ws.onerror = () => { /* onclose llega después */ };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.dispatch({ type: 'ws', connection: 'reconnecting' });
    // Sin host, los pares que no estén realmente conectados ya no se pueden re-señalizar: se limpian.
    for (const [id, p] of this.peers) if (p.pc.connectionState !== 'connected') this.closePeer(id);
    if (this.reconnectTimer) this.deps.clearTimeout(this.reconnectTimer);
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = this.deps.setTimeout(() => { this.reconnectTimer = undefined; this.connect(); }, delay);
  }

  private send(m: RadioClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(m)); return true; } catch { return false; }
  }

  private async onServer(m: RadioServerMessage): Promise<void> {
    const now = this.deps.now();
    switch (m.type) {
      case 'welcome': {
        this.dispatch({ type: 'server', msg: m, now });
        if (!this.wantedChannel) {
          const first = m.channels.find((c) => !c.emergency && (c.listen.includes('*') || c.listen.includes(m.self.role))) ?? m.channels[0];
          if (first) this.joinChannel(first.id);
        }
        return;
      }
      case 'presence': {
        this.dispatch({ type: 'server', msg: m, now });
        if (m.channel !== this.state.channel) return;
        const ids = new Set(m.participants.map((p) => p.id));
        for (const id of [...this.peers.keys()]) if (!ids.has(id) && this.peers.get(id)!.pc.connectionState !== 'connected') this.closePeer(id);
        // El que entra ofrece a los que ya estaban (salvo a quien siga conectado de antes).
        for (const p of m.participants) if (p.id !== this.state.self?.id) await this.ensureOffer(p.id);
        return;
      }
      case 'peer-joined': return this.dispatch({ type: 'server', msg: m, now }); // esperamos su offer
      case 'peer-left': this.closePeer(m.participantId); return this.dispatch({ type: 'server', msg: m, now });
      case 'offer': return this.onOffer(m.from, m.sdp);
      case 'answer': {
        const p = this.peers.get(m.from);
        if (!p) return;
        try { await p.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); await this.flushIce(p); } catch { this.closePeer(m.from); }
        return;
      }
      case 'ice': {
        const p = this.peers.get(m.from);
        if (!p) return;
        const c = m.candidate as RTCIceCandidateInit | null;
        if (!c) return;
        if (p.pc.remoteDescription) { try { await p.pc.addIceCandidate(c); } catch { /* candidato tardío */ } } else p.pendingIce.push(c);
        return;
      }
      case 'ptt-granted': {
        this.dispatch({ type: 'server', msg: m, now });
        if (this.state.ptt === 'talking') { this.setMic(true); this.deps.tone?.('ok'); }
        return;
      }
      case 'ptt-ended': this.setMic(false); return this.dispatch({ type: 'server', msg: m, now });
      case 'emergency': {
        const wasActive = !!this.state.emergency;
        this.dispatch({ type: 'server', msg: m, now });
        const em = this.state.channels.find((c) => c.emergency);
        if (m.active && m.speaker?.id !== this.state.self?.id) {
          if (!wasActive) { this.deps.tone?.('emergency'); this.deps.vibrate?.([300, 100, 300, 100, 600]); }
          if (em && this.state.channel !== em.id) {
            if (this.returnTimer) { this.deps.clearTimeout(this.returnTimer); this.returnTimer = undefined; }
            this.joinChannel(em.id, this.state.channel);
          }
        } else if (!m.active && this.state.returnTo && em && this.state.channel === em.id) {
          const back = this.state.returnTo;
          if (this.returnTimer) this.deps.clearTimeout(this.returnTimer);
          this.returnTimer = this.deps.setTimeout(() => { this.returnTimer = undefined; if (this.state.channel === em.id && this.state.ptt === 'idle') this.joinChannel(back); }, EMERGENCY_RETURN_MS);
        }
        return;
      }
      case 'order': {
        const before = this.state.orders.length;
        this.dispatch({ type: 'server', msg: m, now });
        if (this.state.orders.length === before || m.order.from.id === this.state.self?.id) return;
        this.deps.tone?.(m.order.emergency ? 'emergency' : 'order');
        this.deps.vibrate?.(m.order.emergency ? [300, 100, 300, 100, 600] : [120, 80, 120]);
        this.deps.speak?.(m.order.emergency ? `Emergencia. ${m.order.text}` : `Orden: ${m.order.text}`);
        return;
      }
      default: return this.dispatch({ type: 'server', msg: m, now });
    }
  }

  // ---------- canal, PTT, órdenes ----------

  joinChannel(id: string, returnTo?: string): void {
    this.wantedChannel = id;
    if (this.state.channel === id) return;
    this.setMic(false);
    for (const pid of [...this.peers.keys()]) this.closePeer(pid);
    this.dispatch({ type: 'joining', channel: id, returnTo });
    this.send({ type: 'join', channel: id });
  }

  pttDown(): void {
    const before = this.state.ptt;
    this.dispatch({ type: 'ptt-down', now: this.deps.now() });
    if (this.state.ptt === 'local') this.setMic(true);
    else if (this.state.ptt === 'requesting' && before !== 'requesting') this.send({ type: 'ptt-start' });
  }

  pttUp(): void {
    if (this.state.ptt === 'idle') return;
    this.setMic(false);
    if (this.state.ptt !== 'local') this.send({ type: 'ptt-end' });
    this.dispatch({ type: 'ptt-up' });
  }

  /** Hablar en Emergencia desde cualquier canal: entra al canal y pide la palabra. */
  emergencyDown(): void {
    const em = this.state.channels.find((c) => c.emergency);
    if (!em) return;
    if (this.state.channel !== em.id) this.joinChannel(em.id, this.state.channel);
    this.pttDown();
  }

  ack(orderId: string): void {
    const sent = this.send({ type: 'ack', orderId });
    if (!sent) this.pendingAcks.add(orderId); else this.pendingAcks.delete(orderId);
    this.dispatch({ type: 'ack', orderId, sent });
  }

  sendOrder(input: { code: string; gate?: string; channel?: string; to?: string }): boolean {
    return this.send({ type: 'order', ...input });
  }

  setVolume(v: number): void {
    this.dispatch({ type: 'volume', volume: v });
    for (const p of this.peers.values()) p.remote?.setVolume(this.state.volume);
  }

  clearError(): void { this.dispatch({ type: 'clear-error' }); }

  private setMic(on: boolean): void {
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = on;
  }

  // ---------- malla WebRTC ----------

  private createPeer(id: string, initiator: boolean): Peer {
    this.closePeer(id);
    const pc = new this.deps.RTCPeerConnection({ iceServers: [] });
    const peer: Peer = { pc, pendingIce: [], initiator };
    this.peers.set(id, peer);
    this.dispatch({ type: 'peer', id, state: 'connecting' });
    if (this.stream) for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    else { try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch { /* implementación sin transceivers */ } }
    pc.onicecandidate = (ev) => { if (ev.candidate) this.send({ type: 'ice', to: id, candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate }); };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      peer.remote?.remove();
      peer.remote = this.deps.attachRemote(stream, this.state.volume);
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      const st = pc.connectionState;
      if (st === 'connected') this.dispatch({ type: 'peer', id, state: 'connected' });
      else if (st === 'failed' || st === 'closed') this.dispatch({ type: 'peer', id, state: 'failed' });
      else if (st === 'disconnected') this.dispatch({ type: 'peer', id, state: 'connecting' });
    };
    return peer;
  }

  private closePeer(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.remote?.remove();
    try { p.pc.close(); } catch { /* nada */ }
    this.dispatch({ type: 'peer', id, state: null });
  }

  private async ensureOffer(id: string): Promise<void> {
    const existing = this.peers.get(id);
    if (existing) {
      const cs = existing.pc.connectionState;
      if (cs === 'connected' || cs === 'connecting') return;
      if (cs === 'new' && existing.initiator) return; // oferta en vuelo
    }
    const peer = this.createPeer(id, true);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.send({ type: 'offer', to: id, sdp: offer.sdp ?? '' });
    } catch { this.closePeer(id); }
  }

  private async onOffer(from: string, sdp: string): Promise<void> {
    const existing = this.peers.get(from);
    // Colisión (los dos ofrecimos a la vez): cede el de id mayor.
    if (existing?.initiator && existing.pc.signalingState === 'have-local-offer' && (this.state.self?.id ?? '') < from) return;
    const peer = this.createPeer(from, false);
    try {
      await peer.pc.setRemoteDescription({ type: 'offer', sdp });
      await this.flushIce(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.send({ type: 'answer', to: from, sdp: answer.sdp ?? '' });
    } catch { this.closePeer(from); }
  }

  private async flushIce(p: Peer): Promise<void> {
    const list = p.pendingIce.splice(0);
    for (const c of list) { try { await p.pc.addIceCandidate(c); } catch { /* nada */ } }
  }

  /** Estado de cada conexión P2P (pruebas y diagnóstico): receptores de audio y bytes recibidos. */
  async peerStats(): Promise<Array<{ id: string; state: RTCPeerConnectionState; receivers: number; bytesReceived: number; packetsReceived: number }>> {
    const out = [];
    for (const [id, p] of this.peers) {
      let bytesReceived = 0, packetsReceived = 0;
      try {
        const stats = await p.pc.getStats();
        stats.forEach((s: { type?: string; kind?: string; bytesReceived?: number; packetsReceived?: number }) => {
          if (s.type === 'inbound-rtp' && (s.kind === 'audio' || !s.kind)) { bytesReceived += s.bytesReceived ?? 0; packetsReceived += s.packetsReceived ?? 0; }
        });
      } catch { /* sin stats */ }
      out.push({ id, state: p.pc.connectionState, receivers: p.pc.getReceivers ? p.pc.getReceivers().filter((r) => r.track?.kind === 'audio').length : 0, bytesReceived, packetsReceived });
    }
    return out;
  }
}
