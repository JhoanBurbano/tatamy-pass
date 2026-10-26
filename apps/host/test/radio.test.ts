/**
 * Tatami Radio en el host: dos scanners y un supervisor conectados por WebSocket real
 * (`ws`): autenticación, presencia, relay de offer/answer/ice, PTT ocupado y cola,
 * Emergencia, orden con acuse, eventos persistidos en el log y estado/historial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createDefaultConfig, generateKeyPair, type RadioServerMessage } from '@tatami/core';
import { buildApp } from '../src/server.js';

const key = generateKeyPair('ktest');
const tmp = mkdtempSync(join(tmpdir(), 'tatami-radio-'));
let app: Awaited<ReturnType<typeof buildApp>>;
let base = '';
let wsBase = '';
let adminToken = '';
let superToken = '';
let auditToken = '';
const devices: Array<{ id: string; token: string; name: string }> = [];

class Client {
  ws!: WebSocket;
  inbox: RadioServerMessage[] = [];
  private waiters: Array<{ pred: (m: RadioServerMessage) => boolean; resolve: (m: RadioServerMessage) => void }> = [];
  constructor(public label: string) {}
  async connect(token: string, mode: 'protocol' | 'query' = 'protocol', base = wsBase): Promise<this> {
    this.ws = mode === 'protocol' ? new WebSocket(`${base}/radio/ws`, ['tatami-radio', token]) : new WebSocket(`${base}/radio/ws?token=${encodeURIComponent(token)}`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as RadioServerMessage;
      this.inbox.push(m);
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) { const [w] = this.waiters.splice(i, 1); w.resolve(m); }
    });
    await new Promise<void>((resolve, reject) => { this.ws.once('open', () => resolve()); this.ws.once('error', reject); });
    return this;
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  /** Espera un mensaje (ya recibido o futuro) que cumpla el predicado. */
  wait<T extends RadioServerMessage['type']>(type: T, pred: (m: Extract<RadioServerMessage, { type: T }>) => boolean = () => true, ms = 3000): Promise<Extract<RadioServerMessage, { type: T }>> {
    const p = (m: RadioServerMessage): boolean => m.type === type && pred(m as Extract<RadioServerMessage, { type: T }>);
    const idx = this.inbox.findIndex(p);
    if (idx >= 0) return Promise.resolve(this.inbox.splice(idx, 1)[0] as Extract<RadioServerMessage, { type: T }>);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.label}: no llegó "${type}" en ${ms} ms. Buzón: ${this.inbox.map((m) => m.type).join(', ')}`)), ms);
      this.waiters.push({ pred: p, resolve: (m) => { clearTimeout(t); this.inbox.splice(this.inbox.indexOf(m), 1); resolve(m as Extract<RadioServerMessage, { type: T }>); } });
    });
  }
  async join(channel: string) { this.send({ type: 'join', channel }); return this.wait('presence', (m) => m.channel === channel); }
  close() { this.ws.close(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  app = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, backupsDir: join(tmp, 'backups'), configPath: null });
  app.ctx.users.create('admin', 'admin123', 'ADMIN');
  app.ctx.users.create('super', 'super123', 'SUPERVISOR');
  app.ctx.users.create('audit', 'audit123', 'AUDITOR');
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
  wsBase = `ws://127.0.0.1:${addr.port}`;
  const login = async (username: string, password: string) => (await app.inject({ method: 'POST', url: '/auth/login', payload: { username, password } })).json().token as string;
  adminToken = await login('admin', 'admin123');
  superToken = await login('super', 'super123');
  auditToken = await login('audit', 'audit123');
  for (const n of [1, 2, 3]) {
    const t = app.ctx.devices.createEnrollToken({ name: `Puerta ${n}`, zone: 'T', role: 'CONTROL' });
    const d = app.ctx.devices.enroll(t.token, '123456')!;
    devices.push({ id: d.id, token: d.token, name: d.name });
  }
});

afterAll(async () => {
  await app.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('autenticación del WebSocket', () => {
  it('sin token o con token inválido → 401 (no hay upgrade)', async () => {
    for (const url of [`${wsBase}/radio/ws`, `${wsBase}/radio/ws?token=nope`]) {
      const err = await new Promise<Error>((resolve) => { const ws = new WebSocket(url); ws.on('error', resolve); ws.on('open', () => resolve(new Error('abrió'))); });
      expect(err.message).toMatch(/401/);
    }
  });

  it('scanner desactivado → 401', async () => {
    app.ctx.devices.setDisabled(devices[2].id, true);
    const err = await new Promise<Error>((resolve) => { const ws = new WebSocket(`${wsBase}/radio/ws`, ['tatami-radio', devices[2].token]); ws.on('error', resolve); ws.on('open', () => resolve(new Error('abrió'))); });
    expect(err.message).toMatch(/401/);
    app.ctx.devices.setDisabled(devices[2].id, false);
  });

  it('deviceToken por subprotocolo y sesión por ?token= reciben welcome con su identidad', async () => {
    const a = await new Client('A').connect(devices[0].token);
    const w = await a.wait('welcome');
    expect(w.self).toMatchObject({ id: `dev:${devices[0].id}`, name: 'Puerta 1', kind: 'device', role: 'CONTROL', zone: 'T' });
    expect(w.channels.map((c) => c.id)).toEqual(['puertas', 'supervisores', 'acreditacion', 'emergencia']);
    expect(w.orders.length).toBe(6);
    expect(a.ws.protocol).toBe('tatami-radio');
    const s = await new Client('S').connect(superToken, 'query');
    expect((await s.wait('welcome')).self).toMatchObject({ id: 'usr:super', kind: 'user', role: 'SUPERVISOR' });
    expect((await app.inject({ method: 'GET', url: '/health' })).json().radio).toBe(2);
    a.close(); s.close();
    await sleep(50);
    expect(app.ctx.radio.connected()).toBe(0);
  });
});

describe('salas, señalización y PTT', () => {
  let A: Client, B: Client, S: Client;

  beforeAll(async () => {
    A = await new Client('A').connect(devices[0].token);
    B = await new Client('B').connect(devices[1].token);
    S = await new Client('S').connect(superToken);
    await Promise.all([A.wait('welcome'), B.wait('welcome'), S.wait('welcome')]);
  });

  afterAll(() => { A.close(); B.close(); S.close(); });

  it('presencia: el que entra ve a los que están; los demás reciben peer-joined; control no entra a Supervisores', async () => {
    const pa = await A.join('puertas');
    expect(pa.participants.map((p) => p.name)).toEqual(['Puerta 1']);
    const pb = await B.join('puertas');
    expect(pb.participants.map((p) => p.name)).toEqual(['Puerta 1', 'Puerta 2']);
    expect((await A.wait('peer-joined')).participant.name).toBe('Puerta 2');
    A.send({ type: 'join', channel: 'supervisores' });
    expect((await A.wait('error')).error).toMatch(/no puede entrar/);
    A.send({ type: 'join', channel: 'nada' });
    expect((await A.wait('error')).error).toBe('Ese canal no existe.');
    A.send({ nope: 1 });
    expect((await A.wait('error')).error).toBe('Mensaje no válido.');
    A.send({ type: 'ping' });
    expect((await A.wait('pong')).serverTime).toBeTruthy();
  });

  it('relay de offer / answer / ice entre pares, nunca al emisor', async () => {
    A.send({ type: 'offer', to: `dev:${devices[1].id}`, sdp: 'v=0 offer' });
    const off = await B.wait('offer');
    expect(off).toEqual({ type: 'offer', from: `dev:${devices[0].id}`, sdp: 'v=0 offer' });
    B.send({ type: 'answer', to: off.from, sdp: 'v=0 answer' });
    expect(await A.wait('answer')).toEqual({ type: 'answer', from: `dev:${devices[1].id}`, sdp: 'v=0 answer' });
    B.send({ type: 'ice', to: off.from, candidate: { candidate: 'candidate:1 1 udp 1 10.10.0.5 5000 typ host' } });
    expect((await A.wait('ice')).candidate).toMatchObject({ candidate: expect.stringContaining('typ host') });
    A.send({ type: 'ice', to: 'dev:nadie', candidate: {} }); // se ignora sin error
    await sleep(30);
    expect(A.inbox.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  it('PTT: A habla, B recibe ocupado y hereda la palabra; eventos en el log', async () => {
    A.send({ type: 'ptt-start' });
    expect((await A.wait('ptt-granted')).channel).toBe('puertas');
    expect((await B.wait('speaking')).speaker?.name).toBe('Puerta 1');
    expect((await A.wait('speaking')).speaker?.name).toBe('Puerta 1'); // el hablante también lo recibe
    B.send({ type: 'ptt-start' });
    const busy = await B.wait('ptt-busy');
    expect(busy).toMatchObject({ channel: 'puertas', speaker: { name: 'Puerta 1' }, position: 1 });
    const st = (await app.inject({ method: 'GET', url: '/radio/status', headers: { authorization: `Bearer ${adminToken}` } })).json();
    expect(st.channels[0]).toMatchObject({ speaker: { name: 'Puerta 1' }, queue: [{ name: 'Puerta 2' }] });
    expect(st.connected).toBe(3);
    await sleep(120);
    A.send({ type: 'ptt-end' });
    expect((await A.wait('ptt-ended')).channel).toBe('puertas');
    expect((await B.wait('ptt-granted')).channel).toBe('puertas');
    expect((await A.wait('speaking', (m) => m.speaker?.name === 'Puerta 2')).channel).toBe('puertas');
    B.send({ type: 'ptt-end' });
    await B.wait('ptt-ended');
    expect((await A.wait('speaking', (m) => m.speaker === null)).channel).toBe('puertas');
    B.inbox.length = 0; A.inbox.length = 0;
    const events = app.ctx.scans.forDevice('radio', '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z');
    expect(events.map((e) => e.reasonCode)).toEqual(['RADIO_PTT', 'RADIO_PTT']);
    const first = events.find((e) => (e.manual as { by: string }).by === 'Puerta 1')!;
    expect(first).toMatchObject({ deviceId: 'radio', decision: 'EVENT', zone: 'puertas' });
    expect((first.manual as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(100);
    expect(first.manual?.reason).toMatch(/Puerta 1 habló en puertas/);
  });

  it('Emergencia: el supervisor habla en Emergencia, todos reciben emergency y Puertas queda ocupado', async () => {
    await S.join('emergencia');
    S.send({ type: 'ptt-start' });
    await S.wait('ptt-granted');
    expect(await A.wait('emergency')).toMatchObject({ active: true, speaker: { name: 'super' }, channel: 'emergencia' });
    expect(await B.wait('emergency')).toMatchObject({ active: true });
    A.send({ type: 'ptt-start' });
    expect(await A.wait('ptt-busy')).toMatchObject({ speaker: { name: 'super' }, position: 0 });
    // quien entra durante la emergencia se entera al entrar
    const C = await new Client('C').connect(devices[2].token);
    await C.wait('welcome');
    await C.join('puertas');
    expect(await C.wait('emergency')).toMatchObject({ active: true });
    await A.wait('peer-joined');
    await B.wait('peer-joined');
    S.send({ type: 'ptt-end' });
    expect(await A.wait('emergency')).toMatchObject({ active: false, speaker: null });
    A.send({ type: 'ptt-start' });
    await A.wait('ptt-granted');
    A.send({ type: 'ptt-end' });
    await A.wait('ptt-ended');
    A.inbox.length = 0; B.inbox.length = 0;
    C.close();
    await A.wait('peer-left');
    await B.wait('peer-left');
    const em = app.ctx.scans.forDevice('radio', '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z').find((e) => (e.manual as { emergency?: boolean }).emergency);
    expect(em?.zone).toBe('emergencia');
  });

  it('orden del supervisor a Puertas: llega a A y B, el acuse de B vuelve al supervisor; un control no puede ordenar', async () => {
    A.send({ type: 'order', code: 'PAUSE' });
    expect((await A.wait('error')).error).toMatch(/Solo supervisores/);
    S.send({ type: 'order', code: 'OPEN_GATE', gate: '2', channel: 'puertas' });
    const [oa, ob, os] = await Promise.all([A.wait('order'), B.wait('order'), S.wait('order')]);
    expect(oa.order).toMatchObject({ code: 'OPEN_GATE', text: 'Abrir Puerta 2', channel: 'puertas', from: { name: 'super' }, acks: [] });
    expect(ob.order.id).toBe(oa.order.id);
    expect(os.order.id).toBe(oa.order.id);
    B.send({ type: 'ack', orderId: ob.order.id });
    const ack = await S.wait('ack');
    expect(ack).toMatchObject({ orderId: ob.order.id, by: { name: 'Puerta 2' } });
    expect((await B.wait('ack')).by.name).toBe('Puerta 2');
    B.send({ type: 'ack', orderId: ob.order.id }); // repetido: idempotente
    await B.wait('ack');
    B.send({ type: 'ack', orderId: 'ord-nope' });
    expect((await B.wait('error')).error).toBe('Esa orden ya no existe.');
    // orden directa a una puerta
    S.send({ type: 'order', code: 'SUPERVISOR_TO_GATE', gate: '1', to: `dev:${devices[0].id}` });
    expect((await A.wait('order')).order).toMatchObject({ text: 'Supervisor a Puerta 1', to: `dev:${devices[0].id}` });
    await S.wait('order');
    await sleep(30);
    expect(B.inbox.filter((m) => m.type === 'order')).toHaveLength(0);
    const st = (await app.inject({ method: 'GET', url: '/radio/status', headers: { authorization: `Bearer ${superToken}` } })).json();
    expect(st.orders[1]).toMatchObject({ code: 'OPEN_GATE', acks: [{ by: { name: 'Puerta 2' } }] });
    const log = app.ctx.scans.forDevice('radio', '2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z').map((e) => e.reasonCode);
    expect(log.filter((r) => r === 'RADIO_ORDER')).toHaveLength(2);
    expect(log.filter((r) => r === 'RADIO_ACK')).toHaveLength(1);
  });

  it('historial del día por API; auditor lee, scanner no', async () => {
    const r = await app.inject({ method: 'GET', url: '/radio/events', headers: { authorization: `Bearer ${auditToken}` } });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { date: string; events: Array<{ channel: string; meta: { type: string } | null }> };
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.events.map((e) => e.meta?.type)).toEqual(expect.arrayContaining(['radio_ptt', 'radio_order', 'radio_ack']));
    expect((await app.inject({ method: 'GET', url: '/radio/events', headers: { authorization: `Bearer ${devices[0].token}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/radio/events?date=2000-01-01', headers: { authorization: `Bearer ${adminToken}` } })).json().events).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/radio/status' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/radio/status', headers: { authorization: `Bearer ${devices[0].token}` } })).statusCode).toBe(200);
  });

  it('la config nueva (canal extra) llega en caliente como welcome y se puede entrar', async () => {
    const cfg = (await app.inject({ method: 'GET', url: '/config', headers: { authorization: `Bearer ${adminToken}` } })).json().config;
    cfg.radio.channels.push({ id: 'medico', name: 'Médico', color: '#16A34A', talk: ['*'], listen: ['*'], priority: 2 });
    const put = await app.inject({ method: 'PUT', url: '/config', headers: { authorization: `Bearer ${adminToken}` }, payload: { config: cfg } });
    expect(put.statusCode).toBe(200);
    expect((await A.wait('welcome')).channels.map((c) => c.id)).toContain('medico');
    const pm = await A.join('medico');
    expect(pm.participants.map((p) => p.name)).toEqual(['Puerta 1']);
    expect((await B.wait('peer-left')).participantId).toBe(`dev:${devices[0].id}`);
  });

  it('config de radio inválida → 400 con el campo', async () => {
    const cfg = (await app.inject({ method: 'GET', url: '/config', headers: { authorization: `Bearer ${adminToken}` } })).json().config;
    cfg.radio.channels = cfg.radio.channels.filter((c: { emergency?: boolean }) => !c.emergency);
    const put = await app.inject({ method: 'PUT', url: '/config', headers: { authorization: `Bearer ${adminToken}` }, payload: { config: cfg } });
    expect(put.statusCode).toBe(400);
    expect(put.json().errors.map((e: { path: string }) => e.path)).toContain('radio.channels');
  });

  it('reconectar el mismo participante cierra el socket anterior y conserva la sala', async () => {
    await B.join('puertas');
    const B2 = await new Client('B2').connect(devices[1].token);
    await B2.wait('welcome');
    const code = await new Promise<number>((resolve) => B.ws.once('close', (c) => resolve(c)));
    expect(code).toBe(4000);
    await B2.join('puertas');
    expect(app.ctx.radio.arbiter.members('puertas').map((m) => m.name)).toEqual(['Puerta 2']);
    B2.close();
    await sleep(30);
    expect(app.ctx.radio.arbiter.members('puertas')).toEqual([]);
    B = await new Client('B').connect(devices[1].token);
    await B.wait('welcome');
  });
});

describe('respaldo (standby): señaliza pero no escribe en el log', () => {
  it('ptt en standby no persiste', async () => {
    const sb = await buildApp({ dbPath: ':memory:', config: createDefaultConfig(), signingKey: key, backupsDir: join(tmp, 'sb'), mode: 'standby', configPath: null });
    sb.ctx.users.create('admin', 'admin123', 'ADMIN');
    await sb.listen({ port: 0, host: '127.0.0.1' });
    const port = (sb.server.address() as { port: number }).port;
    const token = (await sb.inject({ method: 'POST', url: '/auth/login', payload: { username: 'admin', password: 'admin123' } })).json().token as string;
    const c = await new Client('SB').connect(token, 'protocol', `ws://127.0.0.1:${port}`);
    await c.wait('welcome');
    await c.join('puertas');
    c.send({ type: 'ptt-start' });
    await c.wait('ptt-granted');
    c.send({ type: 'ptt-end' });
    await c.wait('ptt-ended');
    expect(sb.ctx.scans.count()).toBe(0);
    c.close();
    await sb.close();
  });
});
