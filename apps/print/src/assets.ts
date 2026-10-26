/**
 * Assets de la plantilla (logos, silueta, fondo) → imágenes embebidas en el PDF.
 * PNG y JPG se embeben directo; SVG se rasteriza con `sharp` si está instalado
 * (lo trae apps/registration) y, si no, se dibuja un recuadro con el nombre del
 * asset para que se note qué falta. Caché por documento.
 */
import type { PDFDocument, PDFImage } from 'pdf-lib';
import type { BadgeAsset } from '@tatami/core';

export type Embedded = { kind: 'image'; image: PDFImage; ratio: number } | { kind: 'placeholder'; name: string };

type SharpLike = (input: Buffer, opts?: { density?: number }) => { png: () => { toBuffer: () => Promise<Buffer> } };
let sharpPromise: Promise<SharpLike | null> | undefined;

async function loadSharp(): Promise<SharpLike | null> {
  if (!sharpPromise) {
    sharpPromise = import('sharp').then((m) => (m.default ?? m) as unknown as SharpLike).catch(() => null);
  }
  return sharpPromise;
}

/** Rasteriza un SVG a PNG (300 dpi aprox.). `null` si no hay sharp o el SVG no se pudo leer. */
export async function svgToPng(svg: Buffer): Promise<Buffer | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try { return await sharp(svg, { density: 300 }).png().toBuffer(); } catch { return null; }
}

export class AssetCache {
  private cache = new Map<string, Promise<Embedded>>();
  constructor(private doc: PDFDocument, private assets: Record<string, BadgeAsset>) {}

  get(id: string): Promise<Embedded> {
    let p = this.cache.get(id);
    if (!p) { p = this.embed(id); this.cache.set(id, p); }
    return p;
  }

  private async embed(id: string): Promise<Embedded> {
    const a = this.assets[id];
    if (!a) return { kind: 'placeholder', name: id };
    try {
      const bytes = Buffer.from(a.dataBase64, 'base64');
      let image: PDFImage | undefined;
      if (a.mime === 'image/png') image = await this.doc.embedPng(bytes);
      else if (a.mime === 'image/jpeg') image = await this.doc.embedJpg(bytes);
      else {
        const png = await svgToPng(bytes);
        if (png) image = await this.doc.embedPng(png);
      }
      if (!image) return { kind: 'placeholder', name: a.name };
      return { kind: 'image', image, ratio: image.width / image.height };
    } catch {
      return { kind: 'placeholder', name: a.name };
    }
  }
}
