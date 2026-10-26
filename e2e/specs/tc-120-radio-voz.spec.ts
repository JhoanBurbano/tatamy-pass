/**
 * TC-120 · Tatami Radio (voz por la LAN): dos scanners enrolados entran al canal
 * Puertas, A pulsa para hablar → B ve "Radio A hablando" y su RTCPeerConnection
 * llega a `connected` con una pista de audio remota y bytes recibidos > 0;
 * B pulsa mientras A habla → "Ocupado"; el supervisor envía una orden desde
 * /admin → B la ve, la acusa y /admin muestra el acuse; el host cae (proxy
 * apagado) → el audio P2P sigue (los bytes siguen subiendo) → el host vuelve →
 * la presencia se restablece. Chromium con micrófono falso
 * (--use-fake-device-for-media-stream). Capturas en design/screenshots/radio-*.png.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { join } from 'node:path';
import { ROOT, adminGo, adminLogin, enrollScanner, proxy } from '../helpers.js';

const SHOTS = join(ROOT, 'design', 'screenshots');

type PeerStat = { id: string; state: string; receivers: number; bytesReceived: number; packetsReceived: number };
const radio = (page: Page) => page.evaluate(() => window.__tpRadio!());
const stats = (page: Page) => page.evaluate(() => window.__tpRadioStats!());
const bytesFrom = async (page: Page, peerName: string): Promise<number> => {
  const s = await radio(page);
  const peer = s.participants.find((p) => p.name === peerName);
  const st = (await stats(page)).find((x: PeerStat) => x.id === peer?.id);
  return st?.bytesReceived ?? 0;
};

declare global {
  interface Window {
    __tpRadio?: () => { connection: string; channel?: string; ptt: string; participants: Array<{ id: string; name: string }>; speaker: { name: string } | null; peers: Record<string, string>; orders: Array<{ acked: boolean }> };
    __tpRadioStats?: () => Promise<PeerStat[]>;
  }
}

async function scannerPage(browser: Browser, name: string, zone: string): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  const page = await ctx.newPage();
  await enrollScanner(page, { zone, name });
  return page;
}

async function holdPtt(page: Page) {
  const btn = page.getByTestId('radio-ptt');
  await expect(btn).toBeEnabled();
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
}

test.describe.configure({ mode: 'serial' });
test.afterEach(async () => { await proxy.up(); });

test('TC-120 radio: voz P2P entre dos scanners, ocupado, orden con acuse desde /admin y host caído @smoke', async ({ browser }) => {
  test.setTimeout(120_000);
  const A = await scannerPage(browser, 'Radio A', 'T');
  const B = await scannerPage(browser, 'Radio B', 'W');

  // 1. Ambos conectados a la radio en el canal Puertas y se ven entre sí.
  for (const p of [A, B]) {
    await expect.poll(() => radio(p).then((s) => `${s.connection}:${s.channel}`), { timeout: 15_000 }).toBe('online:puertas');
    await expect(p.getByTestId('radio-pill')).toHaveAttribute('data-connection', 'online');
  }
  await expect.poll(() => radio(B).then((s) => s.participants.map((x) => x.name).sort())).toEqual(['Radio A', 'Radio B']);
  await A.getByTestId('radio-pill').click();
  await B.getByTestId('radio-pill').click();
  await expect(A.getByTestId('radio-panel')).toBeVisible();
  await expect(B.getByTestId('radio-panel')).toBeVisible();
  await expect(B.getByTestId('radio-ptt')).toContainText('Escuchando');

  // 2. A habla: B lo ve y recibe audio de verdad (conexión P2P `connected`, pista remota, bytes > 0).
  await holdPtt(A);
  await expect(A.getByTestId('radio-ptt')).toHaveAttribute('data-ptt', 'talking', { timeout: 10_000 });
  await expect(B.getByTestId('radio-speaker')).toContainText('Radio A hablando');
  await expect(A.getByTestId('radio-pill')).toContainText('Hablando');
  await expect.poll(async () => {
    const s = await radio(B);
    const a = s.participants.find((p) => p.name === 'Radio A');
    return a ? s.peers[a.id] : 'none';
  }, { timeout: 15_000 }).toBe('connected');
  await expect.poll(async () => (await stats(B)).map((x) => `${x.state}/${x.receivers}`)).toEqual(['connected/1']);
  await expect.poll(() => bytesFrom(B, 'Radio A'), { timeout: 15_000 }).toBeGreaterThan(0);
  const bytes1 = await bytesFrom(B, 'Radio A');
  await A.screenshot({ path: join(SHOTS, 'radio-01-scanner-hablando.png'), animations: 'disabled' });

  // 3. B pulsa mientras A habla → Ocupado (y queda en cola).
  await holdPtt(B);
  await expect(B.getByTestId('radio-ptt')).toHaveAttribute('data-ptt', 'busy');
  await expect(B.getByTestId('radio-ptt')).toContainText('Ocupado');
  await B.screenshot({ path: join(SHOTS, 'radio-02-scanner-ocupado.png'), animations: 'disabled' });
  await B.mouse.up();
  await expect(B.getByTestId('radio-ptt')).toHaveAttribute('data-ptt', 'idle');

  // 4. Supervisor en /admin envía "Pausar ingreso" al canal Puertas; B la ve, la acusa; /admin muestra el acuse.
  const adminCtx = await browser.newContext({ permissions: ['microphone'] });
  const admin = await adminCtx.newPage();
  await adminLogin(admin, 'super');
  await adminGo(admin, 'radio');
  await expect(admin.getByTestId('radio-connection')).toHaveAttribute('data-state', 'online', { timeout: 15_000 });
  await expect(admin.getByTestId('radio-channel-puertas')).toContainText('Radio A');
  await expect(admin.getByTestId('radio-channel-puertas').getByTestId('radio-speaker')).toContainText('Radio A');
  await admin.getByTestId('radio-order-code').selectOption('PAUSE');
  await admin.getByTestId('radio-order-target').selectOption('channel:puertas');
  await admin.getByTestId('radio-order-send').click();
  await expect(B.getByTestId('radio-order').first()).toContainText('Pausar ingreso');
  await expect(B.getByTestId('radio-order').first()).toHaveAttribute('data-acked', 'no');
  await expect(admin.getByTestId('radio-sent-order').first()).toContainText('sin acuse');
  await B.getByTestId('radio-ack').first().click();
  await expect(B.getByTestId('radio-order').first()).toHaveAttribute('data-acked', 'yes');
  await expect(admin.getByTestId('radio-sent-order').first().getByTestId('radio-acks')).toContainText('Radio B recibió');
  await admin.screenshot({ path: join(SHOTS, 'radio-03-admin-radio.png'), fullPage: true, animations: 'disabled' });

  // 5. Cae el host (proxy apagado): la señalización se pierde pero el audio P2P sigue.
  await proxy.down();
  await expect.poll(() => radio(A).then((s) => s.connection), { timeout: 15_000 }).toBe('reconnecting');
  await expect(A.getByTestId('radio-ptt')).toHaveAttribute('data-ptt', 'local');
  await expect(A.getByTestId('radio-ptt')).toContainText('sin host');
  const bytes2 = await bytesFrom(B, 'Radio A');
  expect(bytes2).toBeGreaterThanOrEqual(bytes1);
  await A.waitForTimeout(1500);
  const bytes3 = await bytesFrom(B, 'Radio A');
  expect(bytes3).toBeGreaterThan(bytes2);
  await expect.poll(async () => (await stats(B))[0]?.state).toBe('connected');
  await A.screenshot({ path: join(SHOTS, 'radio-04-scanner-sin-host.png'), animations: 'disabled' });

  // 6. Vuelve el host: presencia restablecida sin cortar el audio.
  await proxy.up();
  for (const p of [A, B]) await expect.poll(() => radio(p).then((s) => `${s.connection}:${s.channel}`), { timeout: 20_000 }).toBe('online:puertas');
  await expect.poll(() => radio(B).then((s) => s.participants.map((x) => x.name).sort()), { timeout: 15_000 }).toEqual(['Radio A', 'Radio B']);
  await expect.poll(async () => (await stats(B))[0]?.state).toBe('connected');
  const bytes4 = await bytesFrom(B, 'Radio A');
  expect(bytes4).toBeGreaterThan(bytes3);
  await A.mouse.up();
  await expect(A.getByTestId('radio-ptt')).toHaveAttribute('data-ptt', 'idle');
  await expect(B.getByTestId('radio-speaker')).toContainText('Nadie habla ahora', { timeout: 10_000 });

  // Lo hablado y la orden con su acuse quedaron en el log (sin audio).
  await expect.poll(async () => {
    const r = await admin.request.get(`${admin.url().split('/admin')[0]}/radio/events`, { headers: { authorization: `Bearer ${await admin.evaluate(() => sessionStorage.getItem('tp.panel.token'))}` } });
    const body = await r.json() as { events: Array<{ meta: { type: string; by?: string } | null }> };
    return body.events.map((e) => e.meta?.type).sort();
  }).toEqual(expect.arrayContaining(['radio_ack', 'radio_order', 'radio_ptt']));

  await adminCtx.close();
  await A.context().close();
  await B.context().close();
});
