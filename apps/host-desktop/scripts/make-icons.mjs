// Genera los iconos desde resources/icon.svg con sharp (PNG en varios tamaños,
// icono de bandeja normal y "template" para la barra de menús de Mac) y, si
// png2icons está instalado, icon.icns e icon.ico. electron-builder usa
// icon.png (512) y lo convierte si faltan los otros. Sin sharp no falla: deja
// los que haya y avisa.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESOURCES, log } from './lib.mjs';

const out = join(RESOURCES, 'icons');
mkdirSync(out, { recursive: true });
const svg = readFileSync(join(RESOURCES, 'icon.svg'));

let sharp;
try { sharp = (await import('sharp')).default; } catch {
  log(`✗ sharp no está instalado: no regenero iconos${existsSync(join(out, 'icon.png')) ? ' (uso los existentes)' : ''}.`);
  process.exit(existsSync(join(out, 'icon.png')) ? 0 : 1);
}

const png = async (size, file, input = svg) => { await sharp(input, { density: 384 }).resize(size, size).png().toFile(join(out, file)); };
await png(1024, 'icon-1024.png');
await png(512, 'icon.png');
await png(256, 'icon-256.png');
await png(32, 'tray.png');
await png(64, 'tray@2x.png');

// Icono "template" de Mac: solo negro con alfa (el sistema lo tiñe).
const template = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect x="64" y="64" width="896" height="896" rx="200" fill="#000"/><text x="512" y="640" text-anchor="middle" font-family="Sora, Inter, Helvetica, Arial, sans-serif" font-weight="700" font-size="520" fill="#fff" letter-spacing="-10">TP</text></svg>`);
await png(22, 'trayTemplate.png', template);
await png(44, 'trayTemplate@2x.png', template);

try {
  const png2icons = (await import('png2icons')).default;
  const big = readFileSync(join(out, 'icon-1024.png'));
  const icns = png2icons.createICNS(big, png2icons.BICUBIC, 0);
  const ico = png2icons.createICO(big, png2icons.BICUBIC, 0, false);
  if (icns) writeFileSync(join(out, 'icon.icns'), icns);
  if (ico) writeFileSync(join(out, 'icon.ico'), ico);
  log('✓ iconos: png, icns, ico y bandeja generados en resources/icons/');
} catch (e) {
  log(`✓ iconos PNG generados; sin png2icons (${e.message}) electron-builder convertirá icon.png.`);
}
