/**
 * Tatami Radio en el scanner con WebSocket y RTCPeerConnection falsos:
 * estados del PTT (escuchando / hablando / ocupado / sin radio), cola,
 * órdenes con tono + voz + acuse (y acuse diferido sin host), emergencia
 * que cambia de canal y vuelve, reconexión con backoff y malla que sobrevive
 * a la caída del host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadioClientMessage, RadioParticipant, RadioServerMessage } from '@tatami/core';
import { EMERGENCY_RETURN_MS, RECONNECT_MIN_MS, RadioClient, radioWsUrl, type RadioDeps } from '../src/radio/client.js';
import { initialRadioState, isPttKey, pttLabel, reduce } from '../src/radio/state.js';
import { pickSpanishVoice } from '../src/radio/speech.js';

// ---------- dobles ----------

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: RadioClientMessage[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string, public protocols?: string | string[]) { FakeWS.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  // lado "servidor"
  open() { this.readyState = 1; this.onopen?.(); }
  receive(m: RadioServerMessage) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
  last<T extends RadioClientMessage['type']>(type: T): Extract<RadioClientMessage, { type: T }> | undefined {
    return [...this.sent].reverse().find((m) => m.type === type) as Extract<RadioClientMessage, { type: T }> | undefined;
  }
}

class FakeTrack { kind = 'audio'; enabled = true; stopped = false; stop() { this.stopped = true; } }
class FakeStream { constructor(public tracks: FakeTrack[] = [new FakeTrack()]) {} getAudioTracks() { return this.tracks; } getTracks() { return this.tracks; } }

class FakePC {
  static instances: FakePC[] = [];
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  tracks: unknown[] = [];
  candidates: RTCIceCandidateInit[] = [];
  closed = false;
  onicecandidate: ((ev: { candidate: RTCIceCandidateInit | null }) => void) | null = null;
  ontrack: ((ev: { streams: unknown[]; track: unknown }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  constructor() { FakePC.instances.push(this); }
  addTrack(t: unknown) { this.tracks.push(t); }
  addTransceiver() { /* nada */ }
  async createOffer() { return { type: 'offer' as const, sdp: `offer-${FakePC.instances.indexOf(this)}` }; }
  async createAnswer() { return { type: 'answer' as const, sdp: `answer-${FakePC.instances.indexOf(this)}` }; }
  async setLocalDescription(d: RTCSessionDescriptionInit) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d: RTCSessionDescriptionInit) { if (d.sdp === 'bad') throw new Error('sdp'); this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; }
  async addIceCandidate(c: RTCIceCandidateInit) { this.candidates.push(c); }
  getReceivers() { return [{ track: { kind: 'audio' } }]; }
  async getStats() { const m = new Map(); m.set('in', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 1234, packetsReceived: 12 }); return m; }
  close() { this.closed = true; this.connectionState = 'closed'; }
  // lado "red"
  setState(s: RTCPeerConnectionState) { this.connectionState = s; this.onconnectionstatechange?.(); }
}

const remotes: Array<{ volume: number; removed: boolean }> = [];
const spoken: string[] = [];
const tones: string[] = [];
const vibrations: Array<number | number[]> = [];
let micOk = true;

function deps(): RadioDeps {
  return {
    WebSocket: FakeWS as unknown as RadioDeps['WebSocket'],
    RTCPeerConnection: FakePC as unknown as RadioDeps['RTCPeerConnection'],
    getUserMedia: async () => { if (!micOk) throw new Error('denied'); return new FakeStream() as unknown as MediaStream; },
    attachRemote: (_s, volume) => { const r = { volume, removed: false }; remotes.push(r); return { setVolume: (v) => { r.volume = v; }, remove: () => { r.removed = true; } }; },
    now: () => Date.now(),
    speak: (t) => spoken.push(t),
    tone: (k) => tones.push(k),
    vibrate: (p) => vibrations.push(p),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t)
  };
}

const ME: RadioParticipant = { id: 'dev:me', name: 'Puerta 1', kind: 'device', role: 'CONTROL', zone: 'T' };
const OTHER: RadioParticipant = { id: 'dev:other', name: 'Puerta 2', kind: 'device', role: 'CONTROL', zone: 'W' };
const SUP: RadioParticipant = { id: 'usr:super', name: 'super', kind: 'user', role: 'SUPERVISOR' };
const CHANNELS = [
  { id: 'puertas', name: 'Puertas', color: '#1C4FD1', talk: ['*'], listen: ['*'], priority: 0 },
  { id: 'supervisores', name: 'Supervisores', color: '#0E7490', talk: ['SUPERVISOR'], listen: ['SUPERVISOR'], priority: 1 },
  { id: 'emergencia', name: 'Emergencia', color: '#E0323B', talk: ['*'], listen: ['*'], priority: 100, emergency: true }
];
const welcome = (self = ME): RadioServerMessage => ({ type: 'welcome', self, channels: CHANNELS, orders: [{ code: 'PAUSE', label: 'Pausar ingreso' }], serverTime: new Date().toISOString(), emergency: null });
const tick = () => new Promise((r) => setTimeout(r, 0));

let client: RadioClient;
let ws: FakeWS;

async function connected(): Promise<void> {
  client = new RadioClient(deps());
  await client.start({ hostUrl: 'https://host.local:8443', token: 'tok' });
  ws = FakeWS.instances.at(-1)!;
  ws.open();
  ws.receive(welcome());
  await tick();
  ws.receive({ type: 'presence', channel: 'puertas', participants: [ME], speaker: null });
  await tick();
}

beforeEach(() => { FakeWS.instances = []; FakePC.instances = []; remotes.length = spoken.length = tones.length = vibrations.length = 0; micOk = true; vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { client?.stop(); vi.useRealTimers(); });

// ---------- pruebas ----------

describe('conexión y canal', () => {
  it('la URL del WebSocket deriva de la del host y el token va como subprotocolo', async () => {
    expect(radioWsUrl('https://host.local:8443/')).toBe('wss://host.local:8443/radio/ws');
    expect(radioWsUrl('http://10.10.0.2:8787')).toBe('ws://10.10.0.2:8787/radio/ws');
    await connected();
    expect(ws.url).toBe('wss://host.local:8443/radio/ws');
    expect(ws.protocols).toEqual(['tatami-radio', 'tok']);
    expect(client.state).toMatchObject({ connection: 'online', mic: 'granted', self: ME, channel: 'puertas', participants: [ME] });
    expect(ws.last('join')).toEqual({ type: 'join', channel: 'puertas' });
    expect(pttLabel(client.state)).toMatchObject({ title: 'Escuchando', tone: 'idle' });
  });

  it('con canal inicial explícito (panel) entra a ese canal y la presencia se aplica', async () => {
    client = new RadioClient(deps());
    await client.start({ hostUrl: 'http://h', token: 't', channel: 'supervisores' });
    ws = FakeWS.instances.at(-1)!;
    ws.open();
    expect(ws.last('join')?.channel).toBe('supervisores');
    expect(client.state.channel).toBe('supervisores');
    ws.receive(welcome(SUP));
    ws.receive({ type: 'presence', channel: 'supervisores', participants: [SUP], speaker: null });
    expect(client.state.participants).toEqual([SUP]);
    expect(ws.sent.filter((m) => m.type === 'join')).toHaveLength(1);
  });

  it('elige el primer canal no de emergencia que su rol puede escuchar', async () => {
    client = new RadioClient(deps());
    await client.start({ hostUrl: 'http://h', token: 't' });
    ws = FakeWS.instances.at(-1)!;
    ws.open();
    const chans = [CHANNELS[1], CHANNELS[0], CHANNELS[2]];
    ws.receive({ ...welcome(), channels: chans });
    expect(ws.last('join')?.channel).toBe('puertas');
  });

  it('sin micrófono: sigue escuchando y el PTT explica qué pasa', async () => {
    micOk = false;
    await connected();
    expect(client.state.mic).toBe('denied');
    expect(pttLabel(client.state)).toMatchObject({ title: 'Sin micrófono', tone: 'off' });
    client.pttDown();
    expect(client.state.error).toMatch(/micrófono/);
    expect(ws.last('ptt-start')).toBeUndefined();
    client.clearError();
    expect(client.state.error).toBeUndefined();
  });

  it('cambiar de canal cierra las conexiones y pide join; presencia de otro canal se ignora', async () => {
    await connected();
    ws.receive({ type: 'presence', channel: 'puertas', participants: [ME, OTHER], speaker: null });
    await tick();
    expect(FakePC.instances).toHaveLength(1);
    client.joinChannel('emergencia');
    expect(FakePC.instances[0].closed).toBe(true);
    expect(client.state).toMatchObject({ channel: 'emergencia', participants: [], peers: {} });
    expect(ws.last('join')?.channel).toBe('emergencia');
    ws.receive({ type: 'presence', channel: 'puertas', participants: [ME, OTHER], speaker: OTHER });
    expect(client.state.participants).toEqual([]);
    client.joinChannel('emergencia'); // repetido: no hace nada
    expect(ws.sent.filter((m) => m.type === 'join')).toHaveLength(2);
  });
});

describe('malla WebRTC', () => {
  it('el que entra ofrece a los que ya están; el que ya estaba espera la oferta y responde', async () => {
    await connected();
    // Entro y hay otro: ofrezco
    ws.receive({ type: 'presence', channel: 'puertas', participants: [OTHER, ME], speaker: null });
    await tick();
    const pc = FakePC.instances[0];
    expect(pc.tracks).toHaveLength(1);
    expect(ws.last('offer')).toMatchObject({ to: 'dev:other', sdp: 'offer-0' });
    expect(client.state.peers).toEqual({ 'dev:other': 'connecting' });
    // ICE local → al host; ICE remoto antes de la respuesta se guarda y se aplica después
    pc.onicecandidate?.({ candidate: { candidate: 'c1' } });
    expect(ws.last('ice')).toMatchObject({ to: 'dev:other', candidate: { candidate: 'c1' } });
    ws.receive({ type: 'ice', from: 'dev:other', candidate: { candidate: 'r1' } });
    await tick();
    expect(pc.candidates).toEqual([]);
    ws.receive({ type: 'answer', from: 'dev:other', sdp: 'answer-x' });
    await tick();
    expect(pc.remoteDescription?.sdp).toBe('answer-x');
    expect(pc.candidates).toEqual([{ candidate: 'r1' }]);
    ws.receive({ type: 'ice', from: 'dev:other', candidate: { candidate: 'r2' } });
    await tick();
    expect(pc.candidates).toHaveLength(2);
    ws.receive({ type: 'ice', from: 'dev:other', candidate: null });
    ws.receive({ type: 'ice', from: 'dev:nadie', candidate: { candidate: 'x' } });
    pc.setState('connected');
    expect(client.state.peers['dev:other']).toBe('connected');
    pc.ontrack?.({ streams: [{}], track: {} });
    expect(remotes).toHaveLength(1);
    client.setVolume(0.3);
    expect(remotes[0].volume).toBe(0.3);
    // La presencia repetida no vuelve a ofrecer si ya está conectado
    ws.receive({ type: 'presence', channel: 'puertas', participants: [OTHER, ME], speaker: null });
    await tick();
    expect(FakePC.instances).toHaveLength(1);
    // Alguien nuevo entra: no ofrezco, espero su offer
    const third: RadioParticipant = { ...OTHER, id: 'dev:third', name: 'Puerta 3' };
    ws.receive({ type: 'peer-joined', channel: 'puertas', participant: third });
    await tick();
    expect(FakePC.instances).toHaveLength(1);
    expect(client.state.participants.map((p) => p.id)).toEqual(['dev:other', 'dev:me', 'dev:third']);
    ws.receive({ type: 'offer', from: 'dev:third', sdp: 'offer-third' });
    await tick();
    const pc2 = FakePC.instances[1];
    expect(pc2.remoteDescription?.sdp).toBe('offer-third');
    expect(ws.last('answer')).toMatchObject({ to: 'dev:third', sdp: 'answer-1' });
    // Se va: se cierra su conexión y su audio
    pc2.ontrack?.({ streams: [{}], track: {} });
    ws.receive({ type: 'peer-left', channel: 'puertas', participantId: 'dev:third' });
    expect(pc2.closed).toBe(true);
    expect(remotes[1].removed).toBe(true);
    expect(client.state.participants.map((p) => p.id)).toEqual(['dev:other', 'dev:me']);
    const stats = await client.peerStats();
    expect(stats).toEqual([{ id: 'dev:other', state: 'connected', receivers: 1, bytesReceived: 1234, packetsReceived: 12 }]);
  });

  it('colisión de ofertas: cede el de id mayor; una oferta inválida cierra la conexión', async () => {
    await connected();
    ws.receive({ type: 'presence', channel: 'puertas', participants: [ME, { ...OTHER, id: 'dev:aaa' }], speaker: null });
    await tick();
    expect(FakePC.instances).toHaveLength(1);
    // 'dev:me' > 'dev:aaa' → yo cedo: ignoro mi oferta y respondo a la suya
    ws.receive({ type: 'offer', from: 'dev:aaa', sdp: 'offer-aaa' });
    await tick();
    expect(FakePC.instances[0].closed).toBe(true);
    expect(ws.last('answer')?.to).toBe('dev:aaa');
    // Ahora al revés: 'dev:zzz' ofrece mientras yo tengo oferta en vuelo → gano yo (ignoro la suya)
    ws.receive({ type: 'peer-joined', channel: 'puertas', participant: { ...OTHER, id: 'dev:zzz' } });
    ws.receive({ type: 'presence', channel: 'puertas', participants: [ME, { ...OTHER, id: 'dev:aaa' }, { ...OTHER, id: 'dev:zzz' }], speaker: null });
    await tick();
    const n = FakePC.instances.length;
    ws.receive({ type: 'offer', from: 'dev:zzz', sdp: 'offer-zzz' });
    await tick();
    expect(FakePC.instances).toHaveLength(n);
    ws.receive({ type: 'offer', from: 'dev:bad', sdp: 'bad' });
    await tick();
    expect(client.state.peers['dev:bad']).toBeUndefined();
    ws.receive({ type: 'answer', from: 'dev:zzz', sdp: 'bad' });
    await tick();
    expect(client.state.peers['dev:zzz']).toBeUndefined();
  });
});

describe('pulsar para hablar', () => {
  it('escuchando → pidiendo → hablando (micrófono abierto) → soltar (micrófono cerrado)', async () => {
    await connected();
    const track = (client as unknown as { stream: FakeStream }).stream.tracks[0];
    expect(track.enabled).toBe(false);
    client.pttDown();
    expect(client.state.ptt).toBe('requesting');
    expect(ws.last('ptt-start')).toBeTruthy();
    expect(pttLabel(client.state).title).toBe('Pidiendo la palabra…');
    client.pttDown(); // repetir no manda otro
    expect(ws.sent.filter((m) => m.type === 'ptt-start')).toHaveLength(1);
    ws.receive({ type: 'ptt-granted', channel: 'puertas' });
    expect(client.state.ptt).toBe('talking');
    expect(track.enabled).toBe(true);
    expect(tones).toEqual(['ok']);
    expect(pttLabel(client.state)).toMatchObject({ title: 'Hablando', tone: 'talking' });
    ws.receive({ type: 'speaking', channel: 'puertas', speaker: ME });
    expect(client.state.speaker).toEqual(ME);
    client.pttUp();
    expect(client.state.ptt).toBe('idle');
    expect(track.enabled).toBe(false);
    expect(ws.last('ptt-end')).toBeTruthy();
    client.pttUp(); // idempotente
    expect(ws.sent.filter((m) => m.type === 'ptt-end')).toHaveLength(1);
  });

  it('ocupado: otro habla, sigo pulsando y me toca; si suelto, salgo de la cola', async () => {
    await connected();
    ws.receive({ type: 'speaking', channel: 'puertas', speaker: OTHER });
    expect(pttLabel(client.state)).toMatchObject({ title: 'Puerta 2 hablando', tone: 'busy' });
    client.pttDown();
    ws.receive({ type: 'ptt-busy', channel: 'puertas', speaker: OTHER, position: 1 });
    expect(client.state).toMatchObject({ ptt: 'busy', busyWith: OTHER, queuePosition: 1 });
    expect(pttLabel(client.state)).toMatchObject({ title: 'Ocupado', sub: expect.stringContaining('Puerta 2'), tone: 'busy' });
    ws.receive({ type: 'ptt-granted', channel: 'puertas' });
    expect(client.state.ptt).toBe('talking');
    ws.receive({ type: 'ptt-ended', channel: 'puertas' });
    expect(client.state.ptt).toBe('idle');
    client.pttDown();
    ws.receive({ type: 'ptt-busy', channel: 'puertas', speaker: OTHER, position: 1 });
    client.pttUp();
    expect(client.state.ptt).toBe('idle');
    expect(ws.last('ptt-end')).toBeTruthy();
    ws.receive({ type: 'error', error: 'En Puertas solo escuchas: tu rol no puede hablar aquí.' });
    expect(client.state.error).toMatch(/solo escuchas/);
  });

  it('la barra espaciadora es PTT salvo en campos de texto', () => {
    expect(isPttKey({ code: 'Space' })).toBe(true);
    expect(isPttKey({ key: ' ', repeat: true })).toBe(false);
    expect(isPttKey({ code: 'Enter' })).toBe(false);
    expect(isPttKey({ code: 'Space', target: { tagName: 'INPUT' } })).toBe(false);
    expect(isPttKey({ code: 'Space', target: { tagName: 'DIV', isContentEditable: true } })).toBe(false);
    expect(isPttKey({ code: 'Space', target: { tagName: 'BUTTON' } })).toBe(true);
  });
});

describe('órdenes', () => {
  it('una orden suena, vibra, se lee en voz alta y se acusa; la propia no suena', async () => {
    await connected();
    const order = { id: 'o1', code: 'PAUSE', text: 'Pausar ingreso', channel: 'puertas', from: SUP, at: new Date().toISOString(), emergency: false, acks: [] };
    ws.receive({ type: 'order', order });
    expect(client.state.orders).toHaveLength(1);
    expect(tones).toEqual(['order']);
    expect(vibrations).toEqual([[120, 80, 120]]);
    expect(spoken).toEqual(['Orden: Pausar ingreso']);
    ws.receive({ type: 'order', order }); // repetida: idempotente
    expect(client.state.orders).toHaveLength(1);
    expect(tones).toHaveLength(1);
    client.ack('o1');
    expect(ws.last('ack')).toEqual({ type: 'ack', orderId: 'o1' });
    expect(client.state.orders[0]).toMatchObject({ acked: true, ackPending: false });
    ws.receive({ type: 'ack', orderId: 'o1', by: ME, at: new Date().toISOString() });
    expect(client.state.orders[0].order.acks).toHaveLength(1);
    ws.receive({ type: 'ack', orderId: 'o1', by: ME, at: new Date().toISOString() });
    expect(client.state.orders[0].order.acks).toHaveLength(1);
    const evac = { ...order, id: 'o2', code: 'EVACUATE', text: 'Evacuación', emergency: true };
    ws.receive({ type: 'order', order: evac });
    expect(tones.at(-1)).toBe('emergency');
    expect(spoken.at(-1)).toBe('Emergencia. Evacuación');
    ws.receive({ type: 'order', order: { ...order, id: 'o3', from: ME } });
    expect(tones).toHaveLength(2);
    expect(client.sendOrder({ code: 'PAUSE' })).toBe(true);
    expect(ws.last('order')).toMatchObject({ type: 'order', code: 'PAUSE' });
  });

  it('sin host, el acuse queda pendiente y se manda al reconectar', async () => {
    await connected();
    const order = { id: 'o9', code: 'PAUSE', text: 'Pausar ingreso', channel: 'puertas', from: SUP, at: new Date().toISOString(), emergency: false, acks: [] };
    ws.receive({ type: 'order', order });
    ws.drop();
    expect(client.state.connection).toBe('reconnecting');
    client.ack('o9');
    expect(client.state.orders[0]).toMatchObject({ acked: true, ackPending: true });
    await vi.advanceTimersByTimeAsync(RECONNECT_MIN_MS + 5);
    const ws2 = FakeWS.instances.at(-1)!;
    expect(ws2).not.toBe(ws);
    ws2.open();
    expect(ws2.sent.map((m) => m.type)).toEqual(['join', 'ack']);
    expect(ws2.last('ack')?.orderId).toBe('o9');
  });
});

describe('emergencia', () => {
  it('al activarse: tono, vibración y salto al canal de emergencia; al terminar vuelve al cabo de unos segundos', async () => {
    await connected();
    ws.receive({ type: 'emergency', active: true, speaker: SUP, channel: 'emergencia' });
    expect(tones).toEqual(['emergency']);
    expect(vibrations).toHaveLength(1);
    expect(client.state).toMatchObject({ channel: 'emergencia', returnTo: 'puertas', emergency: SUP });
    expect(ws.last('join')?.channel).toBe('emergencia');
    ws.receive({ type: 'emergency', active: true, speaker: SUP, channel: 'emergencia' }); // repetido: sin tono extra
    expect(tones).toHaveLength(1);
    ws.receive({ type: 'emergency', active: false, speaker: null, channel: 'emergencia' });
    expect(client.state.emergency).toBeNull();
    expect(client.state.channel).toBe('emergencia');
    await vi.advanceTimersByTimeAsync(EMERGENCY_RETURN_MS + 5);
    expect(client.state.channel).toBe('puertas');
    expect(client.state.returnTo).toBeUndefined();
    expect(ws.last('join')?.channel).toBe('puertas');
  });

  it('hablar en Emergencia desde Puertas: entra al canal y pide la palabra; quien habla no recibe su propio tono', async () => {
    await connected();
    client.emergencyDown();
    expect(client.state.channel).toBe('emergencia');
    expect(ws.sent.map((m) => m.type).slice(-2)).toEqual(['join', 'ptt-start']);
    ws.receive({ type: 'emergency', active: true, speaker: ME, channel: 'emergencia' });
    expect(tones).toEqual([]);
    ws.receive({ type: 'ptt-granted', channel: 'emergencia' });
    expect(client.state.ptt).toBe('talking');
    client.pttUp();
    ws.receive({ type: 'emergency', active: false, speaker: null, channel: 'emergencia' });
    await vi.advanceTimersByTimeAsync(EMERGENCY_RETURN_MS + 5);
    expect(client.state.channel).toBe('puertas');
  });
});

describe('caída del host y reconexión', () => {
  it('el audio ya conectado sigue, el PTT pasa a local y al volver se re-señaliza solo lo que falta', async () => {
    await connected();
    ws.receive({ type: 'presence', channel: 'puertas', participants: [ME, OTHER, { ...OTHER, id: 'dev:third', name: 'Puerta 3' }], speaker: null });
    await tick();
    const [pcOther, pcThird] = FakePC.instances;
    pcOther.setState('connected');
    pcThird.setState('connecting');
    ws.drop();
    expect(client.state.connection).toBe('reconnecting');
    expect(pcOther.closed).toBe(false);
    expect(pcThird.closed).toBe(true); // el que no llegó a conectar no se puede completar sin host
    expect(client.state.peers).toEqual({ 'dev:other': 'connected' });
    expect(pttLabel(client.state)).toMatchObject({ title: 'Escuchando (sin host)', tone: 'idle' });
    const track = (client as unknown as { stream: FakeStream }).stream.tracks[0];
    client.pttDown();
    expect(client.state.ptt).toBe('local');
    expect(track.enabled).toBe(true);
    expect(pttLabel(client.state)).toMatchObject({ title: 'Hablando (sin host)', sub: 'Te oyen 1 equipo que ya estaban' });
    client.pttUp();
    expect(track.enabled).toBe(false);
    // backoff: 1 s, 2 s, 4 s…
    await vi.advanceTimersByTimeAsync(RECONNECT_MIN_MS + 5);
    const ws2 = FakeWS.instances.at(-1)!;
    expect(FakeWS.instances).toHaveLength(2);
    ws2.drop();
    await vi.advanceTimersByTimeAsync(RECONNECT_MIN_MS + 5);
    expect(FakeWS.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(RECONNECT_MIN_MS + 5);
    expect(FakeWS.instances).toHaveLength(3);
    const ws3 = FakeWS.instances.at(-1)!;
    ws3.open();
    expect(client.state.connection).toBe('online');
    expect(ws3.last('join')?.channel).toBe('puertas');
    ws3.receive(welcome());
    ws3.receive({ type: 'presence', channel: 'puertas', participants: [ME, OTHER, { ...OTHER, id: 'dev:third', name: 'Puerta 3' }], speaker: null });
    await tick();
    // Solo se ofrece a Puerta 3 (Puerta 2 seguía conectada)
    expect(FakePC.instances).toHaveLength(3);
    expect(pcOther.closed).toBe(false);
    expect(ws3.sent.filter((m) => m.type === 'offer').map((m) => (m as { to: string }).to)).toEqual(['dev:third']);
  });

  it('hablando cuando cae el host: sigue hablando en local sin cortar el micrófono', async () => {
    await connected();
    client.pttDown();
    ws.receive({ type: 'ptt-granted', channel: 'puertas' });
    const track = (client as unknown as { stream: FakeStream }).stream.tracks[0];
    ws.drop();
    expect(client.state.ptt).toBe('local');
    expect(track.enabled).toBe(true);
    client.pttUp();
    expect(track.enabled).toBe(false);
    expect(ws.sent.filter((m) => m.type === 'ptt-end')).toHaveLength(0); // sin host no hay a quién avisar
  });

  it('stop apaga todo y libera el micrófono; sin presencia tras caer el host el PTT dice Sin radio', async () => {
    await connected();
    ws.drop();
    expect(pttLabel(client.state)).toMatchObject({ title: 'Sin radio', tone: 'off' });
    const track = (client as unknown as { stream: FakeStream }).stream.tracks[0];
    client.stop();
    expect(track.stopped).toBe(true);
    expect(client.state).toEqual(initialRadioState());
    await vi.advanceTimersByTimeAsync(RECONNECT_MAX_MS_SAFE);
    expect(FakeWS.instances).toHaveLength(1);
  });
});
const RECONNECT_MAX_MS_SAFE = 20_000;

describe('reductor y voz', () => {
  it('reduce no cambia la referencia cuando no hay cambios', () => {
    const s = initialRadioState();
    expect(reduce(s, { type: 'ws', connection: 'off' })).toBe(s);
    expect(reduce(s, { type: 'mic', mic: 'unknown' })).toBe(s);
    expect(reduce(s, { type: 'clear-error' })).toBe(s);
    expect(reduce(s, { type: 'server', msg: { type: 'pong', serverTime: '' }, now: 0 })).toBe(s);
    expect(reduce(s, { type: 'volume', volume: 3 }).volume).toBe(1);
    expect(reduce({ ...s, ptt: 'requesting' }, { type: 'server', msg: { type: 'error', error: 'x' }, now: 0 })).toMatchObject({ ptt: 'idle', error: 'x' });
    expect(reduce({ ...s, ptt: 'busy', connection: 'online' }, { type: 'ws', connection: 'reconnecting' }).ptt).toBe('idle');
    expect(reduce({ ...s, channel: 'puertas', speaker: OTHER, participants: [OTHER] }, { type: 'server', msg: { type: 'peer-left', channel: 'puertas', participantId: OTHER.id }, now: 0 })).toMatchObject({ speaker: null, participants: [] });
    expect(reduce({ ...s, channel: 'puertas', participants: [OTHER] }, { type: 'server', msg: { type: 'peer-joined', channel: 'puertas', participant: OTHER }, now: 0 }).participants).toHaveLength(1);
    expect(reduce({ ...s, mic: 'granted', connection: 'online', ptt: 'talking' }, { type: 'ptt-down', now: 1 }).ptt).toBe('talking');
    expect(reduce(s, { type: 'server', msg: { type: 'ptt-ended', channel: 'puertas' }, now: 0 })).toBe(s);
  });

  it('elige voz es-CO, luego cualquier español', () => {
    expect(pickSpanishVoice([{ lang: 'en-US' }, { lang: 'es-MX' }, { lang: 'es_CO' }])).toEqual({ lang: 'es_CO' });
    expect(pickSpanishVoice([{ lang: 'en-US' }, { lang: 'es-MX' }])).toEqual({ lang: 'es-MX' });
    expect(pickSpanishVoice([{ lang: 'es' }])).toEqual({ lang: 'es' });
    expect(pickSpanishVoice([{ lang: 'en-US' }])).toBeUndefined();
  });
});
