/**
 * HostRunner con el host real (apps/host compilado) sobre una carpeta temporal
 * y un puerto libre: arranca, siembra la demo, genera un código de enrolamiento,
 * hace copias (incluida la "USB") y se detiene. Sin Electron.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HostRunner } from '../src/main/host-runner.js';
import { dataPaths } from '../src/main/paths.js';
import { DEFAULT_SETTINGS } from '../src/main/settings.js';
import { createEnrollment } from '../src/main/enroll.js';
import { buildState } from '../src/main/state.js';

async function freePort(): Promise<number> {
  return new Promise((resolve) => { const s = createServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
}

describe('HostRunner (host real en proceso)', () => {
  let tmp: string;
  let port: number;
  const logs: string[] = [];
  const runner = new HostRunner({ log: (l, m) => logs.push(`${l} ${m}`) });

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'tp-runner-'));
    port = await freePort();
  });
  afterAll(async () => { await runner.stop(); rmSync(tmp, { recursive: true, force: true }); });

  it('arranca como principal con la passphrase dada y responde /health', async () => {
    const paths = dataPaths(tmp);
    await runner.start({ ...DEFAULT_SETTINGS, setupDone: true, port }, paths, 'passphrase-de-prueba-123');
    expect(runner.running).toBe(true);
    expect(existsSync(paths.db)).toBe(true);
    expect(existsSync(join(paths.keysDir, 'signing.enc.json'))).toBe(true);
    expect(existsSync(paths.configFile)).toBe(true);
    const h = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()) as { ok: boolean; mode: string };
    expect(h).toMatchObject({ ok: true, mode: 'primary' });
    expect(logs.some((l) => /Host corriendo \(primary\)/.test(l))).toBe(true);
  });

  it('siembra la demo una sola vez', async () => {
    const m = await runner.seedDemo();
    expect(m).toMatch(/2000 credenciales/);
    expect(runner.ctx!.users.count()).toBe(7);
    expect(await runner.seedDemo()).toMatch(/ya tiene datos/);
  });

  it('genera un código de enrolamiento canjeable por el scanner', async () => {
    const r = await createEnrollment(runner.ctx!, { name: 'Puerta G9', zone: 'G', role: 'CONTROL' }, `http://127.0.0.1:${port}`);
    const res = await fetch(`http://127.0.0.1:${port}/devices/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: r.token, pin: '123456' }) });
    expect(res.status).toBe(200);
    const dev = await res.json() as { name: string; zone: string };
    expect(dev).toMatchObject({ name: 'Puerta G9', zone: 'G' });
    const st = buildState({ version: 't', platform: process.platform, settings: { ...DEFAULT_SETTINGS, port }, ctx: runner.ctx, running: true, starting: false, hostError: null, lanIps: [], caddy: { running: false, error: null, binaryFound: false, rootCertAvailable: false, port: 8443 }, passphraseSet: true, passphraseStorage: 'plain', dataDir: tmp });
    expect(st.devices.map((d) => d.name)).toContain('Puerta G9');
    expect(st.counts.credentials).toBe(2000);
  });

  it('hace copias en la carpeta de datos y en una "USB", verificadas', async () => {
    const m = await runner.backupNow();
    expect(m).toMatch(/Copia de seguridad creada/);
    expect(readdirSync(dataPaths(tmp).backupsDir).filter((f) => f.endsWith('.db'))).toHaveLength(1);
    const usb = join(tmp, 'usb');
    const m2 = await runner.backupTo(usb);
    expect(m2).toMatch(/verificada: 2000 credenciales/);
    expect(readdirSync(usb).filter((f) => f.endsWith('.db'))).toHaveLength(1);
  });

  it('sin nube configurada, "Traer ahora" explica qué falta', async () => {
    await expect(runner.cloudPullNow()).rejects.toThrow(/nube no está configurada/);
  });

  it('se detiene y libera el puerto; un segundo start en el mismo puerto ocupado da un mensaje claro', async () => {
    await runner.stop();
    expect(runner.running).toBe(false);
    const blocker = createServer();
    await new Promise<void>((r) => blocker.listen(port, '0.0.0.0', () => r()));
    try {
      await expect(runner.start({ ...DEFAULT_SETTINGS, setupDone: true, port }, dataPaths(tmp), 'passphrase-de-prueba-123')).rejects.toThrow(/ya está en uso/);
      expect(runner.error).toMatch(/Ajustes/);
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()));
    }
  });
});
