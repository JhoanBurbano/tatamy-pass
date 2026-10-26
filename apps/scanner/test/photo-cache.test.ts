/**
 * Caché de fotos en IndexedDB (§2): se descarga una vez y luego sale de la
 * caché sin red; iniciales cuando no hay foto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDevice } from '../src/db.js';
import { cachedPhotoCount, getPhoto, prefetchPhotos } from '../src/lib/photo-cache.js';
import { initials } from '../src/lib/search.js';

let hits = 0;
let online = true;
const fetchFn = (async (url: string) => {
  hits++;
  if (!online) throw new TypeError('Failed to fetch');
  if (String(url).endsWith('404.jpg')) return new Response('', { status: 404 });
  return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
}) as unknown as typeof fetch;

beforeEach(async () => { await resetDevice(); hits = 0; online = true; });
afterEach(() => vi.unstubAllGlobals());

describe('caché de fotos', () => {
  it('descarga una vez y luego sirve de IndexedDB aunque no haya red', async () => {
    const a = await getPhoto('http://host.test/photos/1.png', fetchFn);
    expect(a?.size).toBe(4);
    expect(hits).toBe(1);
    online = false;
    const b = await getPhoto('http://host.test/photos/1.png', fetchFn);
    expect(b?.size).toBe(4);
    expect(hits).toBe(1);
    expect(await cachedPhotoCount()).toBe(1);
  });
  it('sin red y sin caché devuelve undefined (se muestran iniciales); data: no se cachea', async () => {
    online = false;
    expect(await getPhoto('http://host.test/photos/2.png', fetchFn)).toBeUndefined();
    expect(await getPhoto('data:image/png;base64,AAAA', fetchFn)).toBeUndefined();
    expect(hits).toBe(1);
    expect(initials('Juan Pérez')).toBe('JP');
    expect(initials('Ana')).toBe('A');
  });
  it('precarga en segundo plano sin repetir las que ya están y tolerando errores', async () => {
    const n = await prefetchPhotos(['http://h/1.png', 'http://h/2.png', 'http://h/2.png', 'http://h/404.jpg', 'data:x'], { fetchFn, concurrency: 2 });
    expect(n).toBe(2);
    expect(await cachedPhotoCount()).toBe(2);
    const again = await prefetchPhotos(['http://h/1.png', 'http://h/2.png'], { fetchFn });
    expect(again).toBe(0);
  });
});
