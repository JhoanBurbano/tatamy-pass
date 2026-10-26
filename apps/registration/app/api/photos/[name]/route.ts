import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { photosDir } from '@/lib/photos';

export const dynamic = 'force-dynamic';

/** Sirve las fotos guardadas en disco (modo sin Vercel Blob). */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!/^[a-z0-9_-]+\.(jpg|png)$/i.test(name)) return new Response('No encontrada', { status: 404 });
  try {
    const buf = await readFile(join(photosDir(), name));
    return new Response(new Uint8Array(buf), { headers: { 'content-type': name.endsWith('.png') ? 'image/png' : 'image/jpeg', 'cache-control': 'public, max-age=86400, immutable' } });
  } catch {
    return new Response('No encontrada', { status: 404 });
  }
}
