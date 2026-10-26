/**
 * Genera los iconos PNG de la PWA a partir de un logo tipográfico "TP"
 * (azul dobok + franja lima, §12). `node scripts/gen-icons.mjs`.
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

function svg(size, { maskable = false } = {}) {
  const pad = maskable ? size * 0.1 : 0;
  const r = maskable ? 0 : size * 0.22;
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A63E8"/><stop offset="1" stop-color="#1C4FD1"/></linearGradient>
    <clipPath id="c"><rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${r}"/></clipPath>
  </defs>
  ${maskable ? `<rect width="${size}" height="${size}" fill="#1C4FD1"/>` : ''}
  <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${r}" fill="url(#g)"/>
  <g clip-path="url(#c)">
    <rect x="${-size * 0.2}" y="${size * 0.72}" width="${size * 1.4}" height="${size * 0.16}" fill="#C8F560" transform="rotate(-14 ${size / 2} ${size * 0.8})"/>
  </g>
  <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" font-family="Sora, Inter, Arial, Helvetica, sans-serif" font-weight="800" font-size="${size * 0.42}" fill="#FFFFFF" letter-spacing="${-size * 0.02}">TP</text>
</svg>`;
}

const jobs = [
  ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-192.png', 192, true], ['icon-maskable-512.png', 512, true], ['apple-touch-icon.png', 180, false]
];
for (const [name, size, maskable] of jobs) {
  const png = await sharp(Buffer.from(svg(size, { maskable }))).png().toBuffer();
  writeFileSync(join(out, name), png);
  console.log('icono', name, png.length, 'bytes');
}
