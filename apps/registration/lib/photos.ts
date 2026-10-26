/**
 * Fotos de credencial. El navegador manda un JPEG cuadrado ya recortado (data URL, ≈ 60–120 KB).
 * Límite de entrada: 2 MB (más que suficiente para un recorte de 600×600; protege la API de
 * subidas enormes). El guardado lo hace el adaptador `lib/storage.ts` (disco en dev, Vercel Blob
 * con `BLOB_READ_WRITE_TOKEN`); `photoUrl` siempre es una URL absoluta que el host puede descargar.
 */
import { getStorage } from './storage';

export { photosDir } from './storage';

export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export type DecodedPhoto = { buffer: Buffer; mime: 'image/jpeg' | 'image/png' };

/** Decodifica `data:image/jpeg;base64,…`. Devuelve null si no es una imagen válida y 'TOO_BIG' si pesa más de 2 MB. */
export function decodePhoto(dataUrl: string | undefined): DecodedPhoto | null | 'TOO_BIG' {
  if (!dataUrl) return null;
  const m = /^data:(image\/jpeg|image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  // 4 caracteres base64 = 3 bytes: rechazar antes de decodificar algo enorme.
  if (m[2].length > Math.ceil(PHOTO_MAX_BYTES / 3) * 4 + 4) return 'TOO_BIG';
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > PHOTO_MAX_BYTES) return 'TOO_BIG';
  if (buffer.length < 100) return null;
  const mime = m[1] as DecodedPhoto['mime'];
  // Firma del formato (magic bytes): evita que suban otra cosa con el mime cambiado.
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if ((mime === 'image/jpeg' && !isJpeg) || (mime === 'image/png' && !isPng)) return null;
  return { buffer, mime };
}

export async function storePhoto(id: string, photo: { buffer: Buffer; mime: string }): Promise<string> {
  const ext = photo.mime === 'image/png' ? 'png' : 'jpg';
  const name = `${id}-${Date.now().toString(36)}.${ext}`;
  return (await getStorage().put(name, photo.buffer, photo.mime)).url;
}
