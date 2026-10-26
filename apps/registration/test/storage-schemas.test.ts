import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloudKeyInfo, checkCloudKey, rotateCloudKey } from '../lib/cloud-auth';
import { decodePhoto, PHOTO_MAX_BYTES, storePhoto } from '../lib/photos';
import { editRegistrationSchema, registerSchema, zodErrors } from '../lib/schemas';
import { diskStorage, memoryStorage, setStorage } from '../lib/storage';
import { memoryRepos, TINY_JPEG } from './helpers';

const jpeg = (bytes: number) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes, 1), Buffer.from([0xff, 0xd9])]).toString('base64');

describe('fotos: decodificación y límite de 2 MB', () => {
  it('acepta JPEG/PNG reales hasta 2 MB y rechaza el resto', () => {
    expect(decodePhoto(TINY_JPEG)).not.toBeNull();
    expect(decodePhoto(jpeg(PHOTO_MAX_BYTES - 100))).not.toBe('TOO_BIG');
    expect(decodePhoto(jpeg(PHOTO_MAX_BYTES + 10))).toBe('TOO_BIG');
    expect(decodePhoto('data:image/jpeg;base64,' + Buffer.alloc(300, 7).toString('base64'))).toBeNull(); // sin firma JPEG
    expect(decodePhoto('data:text/plain;base64,aGVsbG8=')).toBeNull();
    expect(decodePhoto(undefined)).toBeNull();
  });

  it('adaptador: memoria, disco (URL /api/photos) y selección por entorno', async () => {
    const mem = memoryStorage();
    const f = await mem.put('a.jpg', Buffer.from('x'), 'image/jpeg');
    expect(f.url).toBe('memory://photos/a.jpg');
    await mem.remove('a.jpg');
    expect(mem.files.size).toBe(0);

    const dir = mkdtempSync(join(tmpdir(), 'tp-photos-'));
    const disk = diskStorage(dir);
    const d = await disk.put('b.jpg', Buffer.from('hola'), 'image/jpeg');
    expect(d.url).toMatch(/\/api\/photos\/b\.jpg$/);
    expect(disk.read('b.jpg')?.toString()).toBe('hola');
    await disk.remove('b.jpg');
    expect(disk.read('b.jpg')).toBeNull();
    rmSync(dir, { recursive: true, force: true });

    setStorage(mem);
    const url = await storePhoto('r_1', decodePhoto(TINY_JPEG) as { buffer: Buffer; mime: string });
    expect(url).toMatch(/^memory:\/\/photos\/r_1-/);
    setStorage(undefined);
  });
});

describe('esquemas zod', () => {
  it('inscripción: normaliza casillas y vacíos, rechaza fotos que no son data URL y acompañantes de más', () => {
    const ok = registerSchema.safeParse({ firstName: ' Ana ', privacyConsent: 'on', guardianConsent: false, photo: '', companions: [{ name: 'Pepe', photo: '' }] });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    expect(ok.data.firstName).toBe('Ana'); expect(ok.data.privacyConsent).toBe(true); expect(ok.data.guardianConsent).toBe(false); expect(ok.data.photo).toBeUndefined();
    const bad = registerSchema.safeParse({ photo: 'http://x/y.jpg', companions: Array.from({ length: 21 }, () => ({ name: 'x' })), email: 'x'.repeat(200) });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    const e = zodErrors(bad.error);
    expect(e.photo).toMatch(/No pude leer la foto/); expect(e.companions).toMatch(/Demasiados/); expect(e.email).toMatch(/Máximo/);
  });

  it('edición: nombre obligatorio, correo y fecha con formato', () => {
    expect(editRegistrationSchema.safeParse({ firstName: '', lastName: 'R', birthDate: '2000-01-01' }).success).toBe(false);
    expect(zodErrors(editRegistrationSchema.safeParse({ firstName: 'A', lastName: 'R', birthDate: '01/01/2000' }).error!).birthDate).toMatch(/fecha/);
    expect(zodErrors(editRegistrationSchema.safeParse({ firstName: 'A', lastName: 'R', birthDate: '', email: 'nope' }).error!).email).toMatch(/correo/);
    const ok = editRegistrationSchema.safeParse({ firstName: 'A', lastName: 'R', birthDate: '2000-01-01', email: 'A@X.COM', documentNumber: '123' });
    expect(ok.success && ok.data.email).toBe('a@x.com');
  });
});

describe('clave compartida host ↔ nube', () => {
  it('la clave del panel manda sobre TP_CLOUD_KEY y rotar invalida la anterior', async () => {
    const repos = await memoryRepos();
    const prev = process.env.TP_CLOUD_KEY;
    delete process.env.TP_CLOUD_KEY;
    expect((await cloudKeyInfo(repos)).source).toBe('none');
    expect((await checkCloudKey(new Request('http://x/api/export', { headers: { 'x-tatami-key': 'a' } }), repos))).toMatchObject({ ok: false, status: 503 });
    process.env.TP_CLOUD_KEY = 'env-key';
    expect((await cloudKeyInfo(repos)).source).toBe('env');
    expect((await checkCloudKey(new Request('http://x/api/export', { headers: { 'x-tatami-key': 'env-key' } }), repos)).ok).toBe(true);
    const k = await rotateCloudKey(repos);
    expect((await cloudKeyInfo(repos))).toMatchObject({ key: k, source: 'panel' });
    expect((await checkCloudKey(new Request('http://x/api/export', { headers: { 'x-tatami-key': 'env-key' } }), repos))).toMatchObject({ ok: false, status: 401 });
    expect((await checkCloudKey(new Request('http://x/api/export', { headers: { 'x-tatami-key': k } }), repos)).ok).toBe(true);
    if (prev === undefined) delete process.env.TP_CLOUD_KEY; else process.env.TP_CLOUD_KEY = prev;
  });
});
