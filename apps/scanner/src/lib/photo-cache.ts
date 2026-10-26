/**
 * Caché de fotos de credencial en IndexedDB (§2): la primera vez que se
 * muestra una foto se descarga y se guarda como Blob; después sale de la
 * caché aunque no haya red. Tras cada snapshot se precargan en segundo plano.
 */
import { db } from '../db.js';

const inflight = new Map<string, Promise<Blob | undefined>>();

export function isInlineUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

export async function cachedPhoto(url: string): Promise<Blob | undefined> {
  try {
    return (await db.photos.get(url))?.blob;
  } catch {
    return undefined;
  }
}

async function download(url: string, fetchFn: typeof fetch): Promise<Blob | undefined> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!blob.size) return undefined;
    await db.photos.put({ url, blob, at: new Date().toISOString() });
    return blob;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Devuelve el Blob de la foto (de caché o descargándola). `undefined` si no se
 * pudo obtener; el llamador muestra iniciales.
 */
export async function getPhoto(url: string, fetchFn: typeof fetch = fetch): Promise<Blob | undefined> {
  if (!url || isInlineUrl(url)) return undefined;
  const hit = await cachedPhoto(url);
  if (hit) return hit;
  let p = inflight.get(url);
  if (!p) {
    p = download(url, fetchFn).finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  return p;
}

/**
 * Precarga en segundo plano (concurrencia limitada, sin bloquear). Devuelve
 * cuántas se descargaron de verdad.
 */
export async function prefetchPhotos(urls: string[], opts: { concurrency?: number; limit?: number; fetchFn?: typeof fetch } = {}): Promise<number> {
  const unique = [...new Set(urls.filter((u) => u && !isInlineUrl(u)))].slice(0, opts.limit ?? 5000);
  const fetchFn = opts.fetchFn ?? fetch;
  let i = 0;
  let downloaded = 0;
  const worker = async () => {
    while (i < unique.length) {
      const url = unique[i++];
      if (await cachedPhoto(url)) continue;
      if (await download(url, fetchFn)) downloaded++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));
  return downloaded;
}

export async function cachedPhotoCount(): Promise<number> {
  try { return await db.photos.count(); } catch { return 0; }
}
