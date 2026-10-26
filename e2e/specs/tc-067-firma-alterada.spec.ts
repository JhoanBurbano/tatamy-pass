/**
 * TC-067 · QR con firma alterada, payload manipulado, clave desconocida, otro evento y
 * sin estructura: todos rojos "No puede entrar", ninguno registra entrada, todos quedan en el log.
 */
import { expect, test } from '@playwright/test';
import { b64urlDecode, b64urlEncode, decodeToken, generateKeyPair, signPayload, type QrPayload } from '@tatami/core';
import { enrollScanner, forceSync, host, scan, signingKey, tamperSignature } from '../helpers.js';

test('TC-067 firma alterada y variantes de ataque → rojo y registradas como DENY', async ({ page }) => {
  await enrollScanner(page, { zone: 'T', name: 'E2E ataques' });
  const comp = await host.pick('COMP', 1);
  const key = signingKey();
  const payload = decodeToken(comp.token) as QrPayload;

  // 1. Un carácter de la firma cambiado.
  const r1 = await scan(page, tamperSignature(comp.token));
  expect(r1).toMatchObject({ decision: 'DENY', reasonCode: 'BAD_SIGNATURE', messageTitle: 'No puede entrar' });

  // 2. Rol cambiado en el payload manteniendo la firma.
  const [prefix, , sig] = comp.token.split('.');
  const tamperedPayload = JSON.parse(new TextDecoder().decode(b64urlDecode(comp.token.split('.')[1])));
  tamperedPayload.r = 'STAFF'; tamperedPayload.z = ['*'];
  const r2 = await scan(page, `${prefix}.${b64urlEncode(new TextEncoder().encode(JSON.stringify(tamperedPayload)))}.${sig}`);
  expect(r2.reasonCode).toBe('BAD_SIGNATURE');

  // 3. Otro evento firmado con la clave real.
  const r3 = await scan(page, signPayload({ ...payload, e: 'otro2026' }, key.privateKeyHex));
  expect(r3.reasonCode).toBe('WRONG_EVENT');

  // 4. Clave desconocida k9.
  const k9 = generateKeyPair('k9');
  const r4 = await scan(page, signPayload({ ...payload, k: 'k9' }, k9.privateKeyHex));
  expect(r4.reasonCode).toBe('UNKNOWN_KEY');

  // 5. Prefijo TP2 / sin estructura.
  const r5 = await scan(page, comp.token.replace(/^TP1\./, 'TP2.'));
  expect(r5.reasonCode).toBe('MALFORMED');
  const r6 = await scan(page, 'https://ejemplo.com/no-es-un-token');
  expect(r6.reasonCode).toBe('MALFORMED');

  for (const r of [r1, r2, r3, r4, r5, r6]) expect(r.decision).toBe('DENY');

  // Ningún intento registró entrada y los 6 quedaron en el log del host.
  const status = await forceSync(page);
  expect(status.pending).toBe(0);
  const admin = await host.login('admin');
  const { events } = await host.get<{ events: { deviceId: string; decision: string; reasonCode: string }[] }>('/sync/events?since=&limit=20000', admin);
  const devices = await host.get<{ id: string; name: string }[]>('/devices', admin);
  const me = devices.find((d) => d.name === 'E2E ataques')!;
  // Se excluye el `shift_start` (evento de dispositivo, decision EVENT).
  const mine = events.filter((e) => e.deviceId === me.id && e.decision !== 'EVENT');
  expect(mine.length).toBe(6);
  expect(mine.every((e) => e.decision === 'DENY')).toBe(true);
  expect(mine.map((e) => e.reasonCode).sort()).toEqual(['BAD_SIGNATURE', 'BAD_SIGNATURE', 'MALFORMED', 'MALFORMED', 'UNKNOWN_KEY', 'WRONG_EVENT']);
});
