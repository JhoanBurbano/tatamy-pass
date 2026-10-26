import { describe, expect, it } from 'vitest';
import {
  RadioArbiter, buildRadioEvent, canSendOrders, canTalk, canListen, channelsFor, createDefaultConfig, createDefaultRadioConfig, describeRadioEvent, emergencyChannel,
  isRadioEvent, orderText, parseClientMessage, participantId, radioConfigOf, radioEventMeta, validateEventConfig, type RadioParticipant
} from '../src/index.js';

const dev = (n: number, role: 'CONTROL' | 'SUPERVISOR' = 'CONTROL'): RadioParticipant => ({ id: `dev:d${n}`, name: `Puerta ${n}`, kind: 'device', role, zone: 'T' });
const sup: RadioParticipant = { id: 'usr:super', name: 'super', kind: 'user', role: 'SUPERVISOR' };
const T0 = Date.parse('2026-11-20T09:00:00.000Z');

describe('config y permisos', () => {
  it('config por defecto: 4 canales, uno de emergencia, 6 órdenes y válida', () => {
    const cfg = createDefaultRadioConfig();
    expect(cfg.channels.map((c) => c.id)).toEqual(['puertas', 'supervisores', 'acreditacion', 'emergencia']);
    expect(emergencyChannel(cfg)?.id).toBe('emergencia');
    expect(cfg.orders).toHaveLength(6);
    expect(radioConfigOf({})).toEqual(cfg);
    expect(radioConfigOf({ radio: { ...cfg, maxPerChannel: 4 } }).maxPerChannel).toBe(4);
    expect(validateEventConfig(createDefaultConfig())).toEqual([]);
  });

  it('control habla en Puertas y Emergencia pero no entra a Supervisores', () => {
    const cfg = createDefaultRadioConfig();
    const [puertas, supervisores, , emergencia] = cfg.channels;
    expect(canTalk(puertas, 'CONTROL')).toBe(true);
    expect(canListen(supervisores, 'CONTROL')).toBe(false);
    expect(canTalk(supervisores, 'SUPERVISOR')).toBe(true);
    expect(canTalk(emergencia, 'CONTROL')).toBe(true);
    expect(channelsFor(cfg, 'CONTROL').map((c) => c.id)).toEqual(['puertas', 'emergencia']);
    expect(channelsFor(cfg, 'ADMIN')).toHaveLength(4);
    expect(canSendOrders('SUPERVISOR')).toBe(true);
    expect(canSendOrders('CONTROL')).toBe(false);
    expect(participantId('device', 'abc')).toBe('dev:abc');
    expect(participantId('user', 'ana')).toBe('usr:ana');
  });

  it('orderText sustituye {n}', () => {
    expect(orderText({ code: 'OPEN_GATE', label: 'Abrir Puerta {n}', requiresGate: true }, '3')).toBe('Abrir Puerta 3');
    expect(orderText({ code: 'PAUSE', label: 'Pausar ingreso' })).toBe('Pausar ingreso');
    expect(orderText({ code: 'OPEN_GATE', label: 'Abrir Puerta {n}' }, '')).toBe('Abrir Puerta —');
  });

  it('validación de radio: ids, colores, emergencia única, órdenes con {n}, máximo por canal', () => {
    const base = createDefaultConfig();
    const bad = { ...base, radio: { channels: [{ id: 'Puertas', name: '', color: 'red', talk: [], listen: ['*'], priority: -1 }, { id: 'x', name: 'X', color: '#000000', talk: ['*'], listen: ['*'], priority: 0 }], orders: [{ code: 'open', label: 'Abrir {n}' }, { code: 'OPEN', label: 'Abrir', requiresGate: true }, { code: 'OPEN', label: '' }], maxPerChannel: 1 } };
    const paths = validateEventConfig(bad).map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['radio.channels[0].id', 'radio.channels[0].name', 'radio.channels[0].color', 'radio.channels[0].talk', 'radio.channels[0].priority', 'radio.channels', 'radio.orders[0].code', 'radio.orders[1].label', 'radio.orders[2].code', 'radio.orders[2].label', 'radio.maxPerChannel']));
    expect(validateEventConfig({ ...base, radio: null as never }).map((e) => e.path)).toContain('radio');
    expect(validateEventConfig({ ...base, radio: { channels: [], orders: 'x' as never, maxPerChannel: 10 } }).map((e) => e.path)).toEqual(expect.arrayContaining(['radio.channels', 'radio.orders']));
    expect(validateEventConfig({ ...base, radio: { ...createDefaultRadioConfig(), channels: [null as never] } }).map((e) => e.path)).toContain('radio.channels[0]');
    expect(validateEventConfig({ ...base, radio: { ...createDefaultRadioConfig(), orders: [null as never] } }).map((e) => e.path)).toContain('radio.orders[0]');
    const dup = { ...base, radio: { ...createDefaultRadioConfig(), channels: [...createDefaultRadioConfig().channels, { ...createDefaultRadioConfig().channels[0] }] } };
    expect(validateEventConfig(dup).map((e) => e.message)).toContain('El canal puertas está repetido.');
  });

  it('parseClientMessage acepta formas válidas y rechaza el resto', () => {
    expect(parseClientMessage({ type: 'join', channel: 'puertas' })).toEqual({ type: 'join', channel: 'puertas' });
    expect(parseClientMessage({ type: 'join' })).toBeUndefined();
    expect(parseClientMessage({ type: 'offer', to: 'dev:x', sdp: 'v=0' })).toEqual({ type: 'offer', to: 'dev:x', sdp: 'v=0' });
    expect(parseClientMessage({ type: 'answer', to: 'dev:x' })).toBeUndefined();
    expect(parseClientMessage({ type: 'ice', to: 'dev:x', candidate: { c: 1 } })).toEqual({ type: 'ice', to: 'dev:x', candidate: { c: 1 } });
    expect(parseClientMessage({ type: 'ice' })).toBeUndefined();
    expect(parseClientMessage({ type: 'order', code: 'PAUSE', gate: 3 })).toEqual({ type: 'order', code: 'PAUSE', gate: undefined, channel: undefined, to: undefined });
    expect(parseClientMessage({ type: 'order' })).toBeUndefined();
    expect(parseClientMessage({ type: 'ack', orderId: 'o1' })).toEqual({ type: 'ack', orderId: 'o1' });
    expect(parseClientMessage({ type: 'ack' })).toBeUndefined();
    expect(parseClientMessage({ type: 'ptt-start' })).toEqual({ type: 'ptt-start' });
    expect(parseClientMessage({ type: 'hack' })).toBeUndefined();
    expect(parseClientMessage('x')).toBeUndefined();
    expect(parseClientMessage(null)).toBeUndefined();
  });
});

describe('RadioArbiter: salas y PTT', () => {
  it('entrar, cambiar de canal, salir y presencia', () => {
    const a = new RadioArbiter(createDefaultRadioConfig());
    expect(a.join(dev(1), 'nope', T0)).toEqual({ ok: false, error: 'Ese canal no existe.' });
    expect(a.join(dev(1), 'supervisores', T0)).toMatchObject({ ok: false });
    const j1 = a.join(dev(1), 'puertas', T0);
    expect(j1).toMatchObject({ ok: true, previous: undefined, peers: [] });
    const j2 = a.join(dev(2), 'puertas', T0);
    expect(j2).toMatchObject({ ok: true, peers: [dev(1)] });
    expect(a.members('puertas').map((m) => m.id)).toEqual(['dev:d1', 'dev:d2']);
    expect(a.channelOf('dev:d2')).toBe('puertas');
    expect(a.participant('dev:d2')?.name).toBe('Puerta 2');
    // volver a entrar al mismo canal (reconexión) actualiza datos sin duplicar
    expect(a.join({ ...dev(2), zone: 'W' }, 'puertas', T0)).toMatchObject({ ok: true, previous: 'puertas', peers: [dev(1)] });
    expect(a.members('puertas')).toHaveLength(2);
    expect(a.participant('dev:d2')?.zone).toBe('W');
    // cambiar de canal
    expect(a.join(dev(2), 'emergencia', T0)).toMatchObject({ ok: true, previous: 'puertas', peers: [] });
    expect(a.members('puertas')).toHaveLength(1);
    expect(a.leave('dev:d2', T0)).toEqual({ channel: 'emergencia', released: null });
    expect(a.leave('dev:d2', T0)).toEqual({ channel: undefined, released: null });
    expect(a.status().connected).toBe(1);
    expect(a.status().channels[0]).toMatchObject({ participants: [dev(1)], speaker: null, queue: [] });
  });

  it('setConfig añade salas nuevas sin echar a nadie', () => {
    const a = new RadioArbiter(createDefaultRadioConfig());
    a.join(dev(1), 'puertas', T0);
    const cfg = createDefaultRadioConfig();
    cfg.channels.push({ id: 'medico', name: 'Médico', color: '#16A34A', talk: ['*'], listen: ['*'], priority: 2 });
    a.setConfig(cfg);
    expect(a.members('puertas')).toHaveLength(1);
    expect(a.join(dev(2), 'medico', T0)).toMatchObject({ ok: true });
    expect(a.status().channels).toHaveLength(5);
  });

  it('canal lleno según maxPerChannel', () => {
    const a = new RadioArbiter({ ...createDefaultRadioConfig(), maxPerChannel: 2 });
    a.join(dev(1), 'puertas', T0);
    a.join(dev(2), 'puertas', T0);
    const r = a.join(dev(3), 'puertas', T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/lleno/);
  });

  it('un hablante por canal: el segundo recibe ocupado y hereda la palabra al soltar', () => {
    const a = new RadioArbiter(createDefaultRadioConfig());
    expect(a.requestTalk('dev:d1', T0)).toEqual({ granted: false, error: 'Entra a un canal antes de hablar.' });
    a.join(dev(1), 'puertas', T0); a.join(dev(2), 'puertas', T0); a.join(dev(3), 'puertas', T0);
    expect(a.requestTalk('dev:d1', T0)).toEqual({ granted: true, channel: 'puertas', emergency: false });
    expect(a.requestTalk('dev:d1', T0 + 10)).toEqual({ granted: true, channel: 'puertas', emergency: false }); // repetir no cambia nada
    expect(a.requestTalk('dev:d2', T0 + 100)).toEqual({ granted: false, busy: dev(1), channel: 'puertas', position: 1 });
    expect(a.requestTalk('dev:d3', T0 + 200)).toEqual({ granted: false, busy: dev(1), channel: 'puertas', position: 2 });
    expect(a.requestTalk('dev:d2', T0 + 300)).toMatchObject({ granted: false, position: 1 });
    expect(a.speaker('puertas')?.id).toBe('dev:d1');
    expect(a.status().channels[0].queue.map((q) => q.id)).toEqual(['dev:d2', 'dev:d3']);
    expect(a.releaseTalk('dev:d3', T0 + 400)).toBeNull(); // d3 se cansó de esperar
    const rel = a.releaseTalk('dev:d1', T0 + 2500);
    expect(rel).toEqual({ channel: 'puertas', speaker: dev(1), startedAt: T0, durationMs: 2500, emergency: false, next: dev(2) });
    expect(a.speaker('puertas')?.id).toBe('dev:d2');
    expect(a.releaseTalk('dev:d2', T0 + 3000)).toMatchObject({ durationMs: 500, next: null });
    expect(a.releaseTalk('dev:d2', T0 + 3000)).toBeNull();
    expect(a.releaseTalk('dev:nadie', T0)).toBeNull();
  });

  it('salir del canal mientras habla libera la palabra; el siguiente en cola que ya salió se salta', () => {
    const a = new RadioArbiter(createDefaultRadioConfig());
    a.join(dev(1), 'puertas', T0); a.join(dev(2), 'puertas', T0); a.join(dev(3), 'puertas', T0);
    a.requestTalk('dev:d1', T0);
    a.requestTalk('dev:d2', T0 + 1);
    a.requestTalk('dev:d3', T0 + 2);
    // d2 se va a otro canal mientras espera (cambiar de canal lo saca de la cola)
    a.join(dev(2), 'emergencia', T0 + 3);
    const left = a.leave('dev:d1', T0 + 1000);
    expect(left.released).toMatchObject({ speaker: dev(1), durationMs: 1000, next: dev(3) });
    expect(a.speaker('puertas')?.id).toBe('dev:d3');
  });

  it('solo escucha: un rol sin permiso de hablar recibe error', () => {
    const cfg = createDefaultRadioConfig();
    cfg.channels[0].talk = ['SUPERVISOR'];
    const a = new RadioArbiter(cfg);
    a.join(dev(1), 'puertas', T0);
    expect(a.requestTalk('dev:d1', T0)).toMatchObject({ granted: false, error: expect.stringContaining('solo escuchas') });
  });

  it('Emergencia interrumpe: mientras alguien habla allí, los demás canales están ocupados', () => {
    const a = new RadioArbiter(createDefaultRadioConfig());
    a.join(dev(1), 'puertas', T0); a.join(dev(2), 'puertas', T0); a.join(sup, 'emergencia', T0);
    expect(a.requestTalk('dev:d1', T0)).toMatchObject({ granted: true });
    expect(a.requestTalk('usr:super', T0 + 10)).toEqual({ granted: true, channel: 'emergencia', emergency: true });
    expect(a.emergencySpeaker()).toEqual(sup);
    expect(a.status().emergency).toEqual(sup);
    expect(a.requestTalk('dev:d2', T0 + 20)).toEqual({ granted: false, busy: sup, channel: 'puertas', position: 0 });
    // el que ya hablaba sigue (no se le corta por software: el cliente baja el volumen) y puede soltar
    expect(a.releaseTalk('dev:d1', T0 + 500)).toMatchObject({ durationMs: 500 });
    expect(a.releaseTalk('usr:super', T0 + 4000)).toMatchObject({ emergency: true, durationMs: 3990 });
    expect(a.emergencySpeaker()).toBeNull();
    expect(a.requestTalk('dev:d2', T0 + 4100)).toMatchObject({ granted: true });
  });

  it('sin canal de emergencia configurado no hay bloqueo', () => {
    const cfg = createDefaultRadioConfig();
    cfg.channels = cfg.channels.filter((c) => !c.emergency);
    const a = new RadioArbiter(cfg);
    expect(a.emergencySpeaker()).toBeNull();
    a.join(dev(1), 'puertas', T0);
    expect(a.requestTalk('dev:d1', T0)).toMatchObject({ granted: true });
  });
});

describe('RadioArbiter: órdenes y acuses', () => {
  it('orden a un canal llega a todos menos al emisor; acuse idempotente', () => {
    const a = new RadioArbiter(createDefaultRadioConfig());
    a.join(dev(1), 'puertas', T0); a.join(dev(2), 'puertas', T0); a.join(sup, 'puertas', T0);
    expect(a.createOrder(dev(1), { code: 'PAUSE' }, T0)).toMatchObject({ ok: false, error: expect.stringContaining('Solo supervisores') });
    expect(a.createOrder(sup, { code: 'NOPE' }, T0)).toMatchObject({ ok: false, error: 'Esa orden no está en el catálogo.' });
    expect(a.createOrder(sup, { code: 'OPEN_GATE' }, T0)).toMatchObject({ ok: false, error: 'Indica la puerta para esta orden.' });
    const r = a.createOrder(sup, { code: 'OPEN_GATE', gate: '3' }, T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order).toMatchObject({ code: 'OPEN_GATE', text: 'Abrir Puerta 3', gate: '3', channel: 'puertas', from: sup, at: new Date(T0).toISOString(), emergency: false, acks: [] });
    expect(r.recipients.map((p) => p.id)).toEqual(['dev:d1', 'dev:d2']);
    expect(a.order(r.order.id)).toBe(r.order);
    expect(a.ack(r.order.id, dev(1), T0 + 50)).toMatchObject({ ok: true, first: true });
    expect(a.ack(r.order.id, dev(1), T0 + 60)).toMatchObject({ ok: true, first: false });
    expect(a.order(r.order.id)?.acks).toEqual([{ by: dev(1), at: new Date(T0 + 50).toISOString() }]);
    expect(a.ack('ord-x', dev(1), T0)).toEqual({ ok: false, error: 'Esa orden ya no existe.' });
    expect(a.recentOrders()[0].id).toBe(r.order.id);
  });

  it('orden a una puerta concreta, a un canal explícito y de emergencia a todos', () => {
    const a = new RadioArbiter(createDefaultRadioConfig());
    a.join(dev(1), 'puertas', T0); a.join(dev(2), 'puertas', T0); a.join(sup, 'supervisores', T0); a.join(dev(9, 'SUPERVISOR'), 'supervisores', T0);
    const direct = a.createOrder(sup, { code: 'SUPERVISOR_TO_GATE', gate: 'Norte', to: 'dev:d2' }, T0);
    expect(direct).toMatchObject({ ok: true, recipients: [dev(2)] });
    if (direct.ok) expect(direct.order).toMatchObject({ to: 'dev:d2', channel: undefined, text: 'Supervisor a Puerta Norte' });
    expect(a.createOrder(sup, { code: 'PAUSE', to: 'dev:nope' }, T0)).toMatchObject({ ok: false, error: 'Ese equipo no está conectado a la radio.' });
    const toChannel = a.createOrder(sup, { code: 'PAUSE', channel: 'puertas' }, T0 + 1);
    expect(toChannel).toMatchObject({ ok: true, recipients: [dev(1), dev(2)] });
    expect(a.createOrder(sup, { code: 'PAUSE', channel: 'nope' }, T0)).toMatchObject({ ok: false, error: 'Indica el canal al que va la orden.' });
    const none = new RadioArbiter(createDefaultRadioConfig());
    expect(none.createOrder(sup, { code: 'PAUSE' }, T0)).toMatchObject({ ok: false, error: 'Indica el canal al que va la orden.' });
    const evac = a.createOrder(sup, { code: 'EVACUATE' }, T0 + 2);
    expect(evac).toMatchObject({ ok: true });
    if (evac.ok) {
      expect(evac.order).toMatchObject({ emergency: true, channel: 'emergencia', text: 'Evacuación' });
      expect(evac.recipients.map((p) => p.id).sort()).toEqual(['dev:d1', 'dev:d2', 'dev:d9']);
    }
    expect(a.recentOrders(2)).toHaveLength(2);
  });
});

describe('eventos de radio en el log', () => {
  it('buildRadioEvent produce un ScanEvent EVENT del dispositivo virtual radio', () => {
    const ptt = buildRadioEvent({ seq: 7, at: '2026-11-20T09:00:02.500Z', meta: { type: 'radio_ptt', by: 'Puerta 1', participantId: 'dev:d1', kind: 'device', channel: 'puertas', startedAt: '2026-11-20T09:00:00.000Z', durationMs: 2500, emergency: false } });
    expect(ptt).toMatchObject({ id: 'radio:7', deviceId: 'radio', seq: 7, zone: 'puertas', credentialId: null, decision: 'EVENT', reasonCode: 'RADIO_PTT' });
    expect(ptt.manual?.reason).toBe('Puerta 1 habló en puertas 2.5 s');
    expect(isRadioEvent(ptt)).toBe(true);
    expect(radioEventMeta(ptt)?.type).toBe('radio_ptt');
    const order = buildRadioEvent({ seq: 8, at: '2026-11-20T09:01:00.000Z', meta: { type: 'radio_order', by: 'super', participantId: 'usr:super', orderId: 'o1', code: 'OPEN_GATE', text: 'Abrir Puerta 3', channel: 'puertas', emergency: false } });
    expect(order.manual?.reason).toBe('Orden "Abrir Puerta 3" de super → puertas');
    const direct = buildRadioEvent({ seq: 9, at: '2026-11-20T09:01:00.000Z', meta: { type: 'radio_order', by: 'super', participantId: 'usr:super', orderId: 'o2', code: 'EVACUATE', text: 'Evacuación', to: 'dev:d1', emergency: true } });
    expect(direct.zone).toBe('radio');
    expect(direct.manual?.reason).toBe('Orden "Evacuación" de super → dev:d1 · EMERGENCIA');
    const ack = buildRadioEvent({ seq: 10, at: '2026-11-20T09:01:05.000Z', meta: { type: 'radio_ack', by: 'Puerta 3', participantId: 'dev:d3', orderId: 'o1', code: 'OPEN_GATE' } });
    expect(ack.manual?.reason).toBe('Puerta 3 recibió la orden OPEN_GATE');
    expect(describeRadioEvent({ type: 'radio_ptt', by: 'x', participantId: 'usr:x', kind: 'user', channel: 'emergencia', startedAt: '', durationMs: 1000, emergency: true })).toContain('EMERGENCIA');
    expect(radioEventMeta({ deviceId: 'd1', manual: { reason: '', by: '' } })).toBeUndefined();
    expect(radioEventMeta({ deviceId: 'radio', manual: undefined })).toBeUndefined();
    expect(radioEventMeta({ deviceId: 'radio', manual: { type: 'shift_start', reason: '', by: '' } as never })).toBeUndefined();
  });
});
