import { describe, expect, it } from 'vitest';
import {
  credentialIdFromPayload, evaluateScan, localDate, localTime, toScanEvent, type ScanInput, type ScanResult
} from '../src/access-rules.js';
import { signCredentialToken, signRotatingToken, verifyToken } from '../src/qr-token.js';
import type { Credential, ScanEvent } from '../src/types.js';
import { CONFIG, DAY1_9AM, KEY, OTHER_KEY, makeConfig, makeCredential, makeScan } from './fixtures.js';

const DEVICE_T1 = { id: 'dev-t1', zone: 'T', role: 'CONTROL' as const };
const DEVICE_T2 = { id: 'dev-t2', zone: 'T', role: 'CONTROL' as const };

function scanToken(cred: Credential, opts: Partial<ScanInput> & { token?: string } = {}): ScanResult {
  const token = opts.token ?? signCredentialToken(cred, KEY);
  return evaluateScan({
    source: { kind: 'token', verification: verifyToken(token, CONFIG.signingKeys) },
    credential: cred,
    zone: 'T',
    now: DAY1_9AM,
    device: DEVICE_T1,
    recentScans: [],
    revocations: [],
    config: CONFIG,
    ...opts
  });
}

describe('utilidades de tiempo', () => {
  it('fecha y hora local según desfase del evento', () => {
    expect(localDate(DAY1_9AM, -300)).toBe('2026-11-20');
    expect(localTime(DAY1_9AM, -300)).toBe('9:00');
    expect(localTime('2026-11-20T14:14:00.000Z', -300)).toBe('9:14');
    // 23:30 Colombia = 04:30Z del día siguiente
    expect(localDate(Date.parse('2026-11-21T04:30:00.000Z'), -300)).toBe('2026-11-20');
  });

  it('credentialIdFromPayload reconstruye el ID corto', () => {
    const cred = makeCredential(77, 'COMP');
    const v = verifyToken(signCredentialToken(cred, KEY), CONFIG.signingKeys);
    if (!v.ok) throw new Error();
    expect(credentialIdFromPayload(v.payload, CONFIG)).toBe(cred.id);
  });
});

describe('evaluateScan — camino feliz', () => {
  it('ALLOW con revisión de foto para competidor', () => {
    const cred = makeCredential(1, 'COMP');
    const r = scanToken(cred);
    expect(r.decision).toBe('ALLOW');
    expect(r.reasonCode).toBe('OK_PHOTO_CHECK');
    expect(r.messageTitle).toBe('Adelante, Juan');
    expect(r.messageBody).toContain('Competidor');
    expect(r.messageBody).toContain('Academia Caucana');
    expect(r.requiresPhotoCheck).toBe(true);
    expect(r.feedback).toBe('ok');
    expect(r.tokenVersion).toBe(1);
  });

  it('ALLOW sin foto para General en Gradería', () => {
    const cred = makeCredential(2, 'GEN', { club: undefined });
    const r = scanToken(cred, { zone: 'G', device: { id: 'dev-g', zone: 'G', role: 'CONTROL' } });
    expect(r).toMatchObject({ decision: 'ALLOW', reasonCode: 'OK', requiresPhotoCheck: false });
    expect(r.nextAction).toBe('Deja pasar.');
  });

  it('STAFF entra a cualquier zona (zonas *)', () => {
    const cred = makeCredential(3, 'STAFF');
    for (const z of ['G', 'T', 'J', 'V']) {
      expect(scanToken(cred, { zone: z }).decision).toBe('ALLOW');
    }
  });

  it('entrada manual por ID corto usa el registro local', () => {
    const cred = makeCredential(4, 'COACH');
    const r = evaluateScan({
      source: { kind: 'manual-id', credentialId: cred.id }, credential: cred, zone: 'W', now: DAY1_9AM,
      device: DEVICE_T1, recentScans: [], revocations: [], config: CONFIG
    });
    expect(r.decision).toBe('ALLOW');
    expect(r.tokenVersion).toBeUndefined();
  });

  it('override de supervisor siempre pasa y queda con motivo', () => {
    const cred = makeCredential(5, 'COMP', { status: 'REVOKED' });
    const r = evaluateScan({
      source: { kind: 'override', credentialId: cred.id, reason: 'Credencial dañada, identidad verificada', by: 'sup-ana' },
      credential: cred, zone: 'T', now: DAY1_9AM, device: DEVICE_T1, recentScans: [], revocations: [], config: CONFIG
    });
    expect(r).toMatchObject({ decision: 'ALLOW', reasonCode: 'OK_MANUAL' });
    expect(r.messageBody).toContain('sup-ana');
    const ev = toScanEvent({ deviceId: 'dev-t1', seq: 9, zone: 'T', at: DAY1_9AM, result: r, manual: { reason: 'x', by: 'sup-ana' } });
    expect(ev).toMatchObject({ id: 'dev-t1:9', credentialId: cred.id, decision: 'ALLOW', reasonCode: 'OK_MANUAL', direction: 'IN' });
    expect(ev.manual?.by).toBe('sup-ana');
  });
});

describe('evaluateScan — firma y evento', () => {
  it('DENY por token malformado', () => {
    const r = scanToken(makeCredential(1, 'COMP'), { token: 'https://evil' });
    expect(r).toMatchObject({ decision: 'DENY', reasonCode: 'MALFORMED', messageTitle: 'No puede entrar', feedback: 'no' });
  });

  it('DENY por firma alterada', () => {
    const cred = makeCredential(1, 'COMP');
    const t = signCredentialToken(cred, KEY);
    const r = scanToken(cred, { token: t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA') });
    expect(r.reasonCode).toBe('BAD_SIGNATURE');
    expect(r.nextAction).toContain('supervisor');
  });

  it('DENY por clave desconocida', () => {
    const cred = makeCredential(1, 'COMP');
    const r = scanToken(cred, { token: signCredentialToken(cred, OTHER_KEY) });
    expect(r.reasonCode).toBe('UNKNOWN_KEY');
  });

  it('DENY por evento distinto', () => {
    const cred = makeCredential(1, 'COMP', { eventId: 'otro2025' });
    expect(scanToken(cred).reasonCode).toBe('WRONG_EVENT');
  });

  it('DENY por credencial desconocida localmente', () => {
    const cred = makeCredential(1, 'COMP');
    const r = scanToken(cred, { credential: undefined });
    expect(r.reasonCode).toBe('UNKNOWN_CREDENTIAL');
    expect(r.tokenVersion).toBe(1);
  });
});

describe('evaluateScan — revocación y versión', () => {
  it('DENY si el registro local está revocado', () => {
    const cred = makeCredential(1, 'COMP', { status: 'REVOKED' });
    expect(scanToken(cred).reasonCode).toBe('REVOKED');
  });

  it('DENY por lista de revocación (todas las versiones)', () => {
    const cred = makeCredential(1, 'COMP');
    const r = scanToken(cred, { revocations: [{ credentialId: cred.id, version: null, reason: 'perdida', at: '2026-11-19T00:00:00Z', by: 'coord' }] });
    expect(r.reasonCode).toBe('REVOKED');
  });

  it('DENY versión anterior tras re-emisión', () => {
    const cred = makeCredential(1, 'COMP');
    const oldToken = signCredentialToken(cred, KEY); // n=1
    const reissued = { ...cred, version: 2 };
    const r = scanToken(reissued, { token: oldToken });
    expect(r.reasonCode).toBe('OLD_VERSION');
    expect(r.messageBody).toContain('versión anterior');
    // la nueva sí entra
    expect(scanToken(reissued).decision).toBe('ALLOW');
  });

  it('DENY versión revocada por lista aunque el registro local esté desactualizado', () => {
    const cred = makeCredential(1, 'COMP'); // local aún en v1
    const revs = [{ credentialId: cred.id, version: 1, reason: 'reemisión', at: '2026-11-19T00:00:00Z', by: 'coord' }];
    expect(scanToken(cred, { revocations: revs }).reasonCode).toBe('OLD_VERSION');
    const manual = evaluateScan({
      source: { kind: 'manual-id', credentialId: cred.id }, credential: cred, zone: 'T', now: DAY1_9AM,
      device: DEVICE_T1, recentScans: [], revocations: revs, config: CONFIG
    });
    expect(manual.reasonCode).toBe('REVOKED');
    // una v2 firmada no se ve afectada por la revocación de v1
    const v2 = { ...cred, version: 2 };
    expect(scanToken(v2, { revocations: revs }).decision).toBe('ALLOW');
  });
});

describe('evaluateScan — zona y vigencia', () => {
  it('DENY zona no permitida con lista de zonas válidas', () => {
    const cred = makeCredential(1, 'GEN');
    const r = scanToken(cred, { zone: 'T' });
    expect(r.reasonCode).toBe('ZONE_NOT_ALLOWED');
    expect(r.messageBody).toContain('Tatamis');
    expect(r.nextAction).toContain('Gradería');
  });

  it('DENY antes y después de la vigencia', () => {
    const cred = makeCredential(1, 'COMP');
    expect(scanToken(cred, { now: Date.parse('2026-11-19T14:00:00Z') }).reasonCode).toBe('NOT_YET_VALID');
    expect(scanToken(cred, { now: Date.parse('2026-11-23T14:00:00Z') }).reasonCode).toBe('EXPIRED');
    // 22 de nov a las 23:00 Colombia sigue siendo válido (04:00Z del 23)
    expect(scanToken(cred, { now: Date.parse('2026-11-23T04:00:00Z') }).decision).toBe('ALLOW');
  });

  it('DENY día no permitido para rol por día', () => {
    const config = makeConfig();
    config.roles = config.roles.map((r) => (r.code === 'GEN' ? { ...r, days: ['2026-11-21'] } : r));
    const cred = makeCredential(1, 'GEN', {}, config);
    const r = scanToken(cred, { zone: 'G', config });
    expect(r.reasonCode).toBe('DAY_NOT_ALLOWED');
    expect(r.nextAction).toContain('2026-11-21');
    expect(scanToken(cred, { zone: 'G', config, now: Date.parse('2026-11-21T14:00:00Z') }).decision).toBe('ALLOW');
  });
});

describe('evaluateScan — credencial digital', () => {
  it('ALLOW token rotativo vigente para General', () => {
    const cred = makeCredential(1, 'GEN');
    const r = scanToken(cred, { zone: 'G', token: signRotatingToken(cred, KEY, DAY1_9AM - 20_000) });
    expect(r.decision).toBe('ALLOW');
  });

  it('DENY token rotativo caducado (pantallazo)', () => {
    const cred = makeCredential(1, 'GEN');
    const r = scanToken(cred, { zone: 'G', token: signRotatingToken(cred, KEY, DAY1_9AM - 10 * 60_000) });
    expect(r.reasonCode).toBe('DIGITAL_TOKEN_EXPIRED');
    expect(r.messageBody).toContain('pantallazo');
  });

  it('DENY digital para rol que exige credencial física', () => {
    const cred = makeCredential(1, 'COMP');
    const r = scanToken(cred, { token: signRotatingToken(cred, KEY, DAY1_9AM) });
    expect(r.reasonCode).toBe('DIGITAL_NOT_ALLOWED');
  });
});

describe('evaluateScan — anti-passback y duplicados', () => {
  const cred = makeCredential(10, 'COMP');
  const t914 = '2026-11-20T14:14:00.000Z';

  it('DENY anti-passback: ya dentro de Tatamis sin salida', () => {
    const scans: ScanEvent[] = [makeScan({ deviceId: 'dev-t1', seq: 1, credentialId: cred.id, zone: 'T', at: t914 })];
    const r = scanToken(cred, { now: Date.parse(t914) + 10 * 60_000, recentScans: scans });
    expect(r.reasonCode).toBe('ANTI_PASSBACK');
    expect(r.messageBody).toBe('Esta credencial ya entró a Tatamis a las 9:14 y no registró salida.');
    expect(r.nextAction).toContain('salga');
  });

  it('ALLOW tras registrar salida', () => {
    const scans: ScanEvent[] = [
      makeScan({ deviceId: 'dev-t1', seq: 1, credentialId: cred.id, zone: 'T', at: t914 }),
      makeScan({ deviceId: 'dev-t1', seq: 2, credentialId: cred.id, zone: 'T', direction: 'OUT', reasonCode: 'OK_EXIT', at: '2026-11-20T14:30:00.000Z' })
    ];
    const r = scanToken(cred, { now: Date.parse('2026-11-20T15:00:00Z'), recentScans: scans });
    expect(r.decision).toBe('ALLOW');
  });

  it('la salida se registra siempre', () => {
    const r = scanToken(cred, { direction: 'OUT' });
    expect(r).toMatchObject({ decision: 'ALLOW', reasonCode: 'OK_EXIT' });
    expect(r.messageTitle).toContain('Salida registrada');
  });

  it('un DENY previo no cuenta como estar dentro', () => {
    const scans: ScanEvent[] = [makeScan({ deviceId: 'dev-t1', seq: 1, credentialId: cred.id, zone: 'T', decision: 'DENY', reasonCode: 'ZONE_NOT_ALLOWED', at: t914 })];
    expect(scanToken(cred, { now: Date.parse(t914) + 60_000 * 5, recentScans: scans }).decision).toBe('ALLOW');
  });

  it('sin anti-passback en Gradería (zona sin control de salida)', () => {
    const gen = makeCredential(11, 'GEN');
    const scans: ScanEvent[] = [makeScan({ deviceId: 'dev-g', seq: 1, credentialId: gen.id, zone: 'G', at: t914 })];
    const r = scanToken(gen, { zone: 'G', device: { id: 'dev-g', zone: 'G', role: 'CONTROL' }, now: Date.parse(t914) + 10 * 60_000, recentScans: scans });
    expect(r.decision).toBe('ALLOW');
  });

  it('ALERT duplicado: mismo QR en otra puerta en < 2 min', () => {
    const scans: ScanEvent[] = [makeScan({ deviceId: 'dev-t1', seq: 1, credentialId: cred.id, zone: 'T', at: t914 })];
    const r = scanToken(cred, { device: DEVICE_T2, now: Date.parse(t914) + 90_000, recentScans: scans });
    expect(r).toMatchObject({ decision: 'ALERT', reasonCode: 'DUPLICATE', feedback: 'alert', requiresPhotoCheck: true });
    expect(r.messageTitle).toContain('duplicado');
    expect(r.messageBody).toContain('9:14');
  });

  it('pasados 2 min en otra puerta ya no es duplicado (pero sí anti-passback)', () => {
    const scans: ScanEvent[] = [makeScan({ deviceId: 'dev-t1', seq: 1, credentialId: cred.id, zone: 'T', at: t914 })];
    const r = scanToken(cred, { device: DEVICE_T2, now: Date.parse(t914) + 3 * 60_000, recentScans: scans });
    expect(r.reasonCode).toBe('ANTI_PASSBACK');
  });

  it('ignora escaneos de otras credenciales', () => {
    const other = makeCredential(12, 'COMP');
    const scans: ScanEvent[] = [makeScan({ deviceId: 'dev-t2', seq: 1, credentialId: other.id, zone: 'T', at: t914 })];
    expect(scanToken(cred, { now: Date.parse(t914) + 30_000, recentScans: scans }).decision).toBe('ALLOW');
  });
});
