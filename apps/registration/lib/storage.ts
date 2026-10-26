/**
 * Adaptador de archivos (fotos de credencial). Una interfaz, dos implementaciones:
 * - `blobStorage`  → Vercel Blob (producción), activo cuando existe `BLOB_READ_WRITE_TOKEN`.
 * - `diskStorage`  → carpeta local (`PHOTOS_DIR`, por defecto data/photos) servida por `/api/photos/<nombre>`.
 *
 * `put` devuelve siempre una URL absoluta que el host puede descargar para imprimir la credencial.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appUrl } from './mail';

export interface StoredFile {
  /** URL pública (absoluta) del archivo. */
  url: string;
  /** Identificador interno (ruta en Blob o nombre en disco) para borrarlo después. */
  key: string;
}

export interface FileStorage {
  readonly kind: 'blob' | 'disk' | 'memory';
  put(name: string, data: Buffer, contentType: string): Promise<StoredFile>;
  /** Borra si existe; nunca lanza (una foto huérfana no es un error de negocio). */
  remove(key: string): Promise<void>;
}

export function photosDir(): string {
  return process.env.PHOTOS_DIR ?? 'data/photos';
}

export function diskStorage(dir = photosDir()): FileStorage & { read(name: string): Buffer | null } {
  return {
    kind: 'disk',
    async put(name, data) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), data);
      return { url: `${appUrl()}/api/photos/${name}`, key: name };
    },
    async remove(key) {
      try { unlinkSync(join(dir, key)); } catch { /* ya no existe */ }
    },
    read(name) {
      try { return readFileSync(join(dir, name)); } catch { return null; }
    }
  };
}

export function blobStorage(): FileStorage {
  return {
    kind: 'blob',
    async put(name, data, contentType) {
      const { put } = await import('@vercel/blob');
      const res = await put(`photos/${name}`, data, { access: 'public', contentType, addRandomSuffix: false });
      return { url: res.url, key: res.url };
    },
    async remove(key) {
      try { const { del } = await import('@vercel/blob'); await del(key); } catch (e) { console.warn('[storage] no pude borrar en Blob:', (e as Error).message); }
    }
  };
}

/** Para tests: no toca disco ni red. */
export function memoryStorage(): FileStorage & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  return {
    kind: 'memory', files,
    async put(name, data) { files.set(name, data); return { url: `memory://photos/${name}`, key: name }; },
    async remove(key) { files.delete(key); }
  };
}

let current: FileStorage | undefined;

/** Almacenamiento según el entorno (se decide una vez por proceso). */
export function getStorage(): FileStorage {
  if (!current) current = process.env.BLOB_READ_WRITE_TOKEN ? blobStorage() : diskStorage();
  return current;
}

/** Para tests. */
export function setStorage(s: FileStorage | undefined): void { current = s; }
