/**
 * Fuentes de la credencial. Si existen los TTF en `apps/print/fonts/` (Barlow y
 * Barlow Condensed, licencia OFL en `fonts/OFL.txt`) se embeben con fontkit; si
 * no, se usan Helvetica / Helvetica-Bold de pdf-lib (sin acentos fuera de WinAnsi).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `src/` en dev y `dist/` compilado están al mismo nivel que `fonts/`. */
export const FONTS_DIR = join(HERE, '..', 'fonts');

export interface BadgeFonts {
  /** Condensada muy negra: título, número de edición, banda del rol. */
  display: PDFFont;
  /** Condensada bold: subtítulos, etiquetas. */
  displayBold: PDFFont;
  body: PDFFont;
  bodyBold: PDFFont;
  /** `true` si se embebieron los TTF (soportan acentos y ñ sin sustituciones). */
  embedded: boolean;
}

const FILES = {
  display: 'BarlowCondensed_800ExtraBold.ttf',
  displayBold: 'BarlowCondensed_700Bold.ttf',
  body: 'Barlow_400Regular.ttf',
  bodyBold: 'Barlow_600SemiBold.ttf'
} as const;

export function fontsAvailable(): boolean {
  return Object.values(FILES).every((f) => existsSync(join(FONTS_DIR, f)));
}

export async function loadFonts(doc: PDFDocument): Promise<BadgeFonts> {
  if (fontsAvailable()) {
    try {
      doc.registerFontkit(fontkit);
      const load = (f: string) => doc.embedFont(readFileSync(join(FONTS_DIR, f)), { subset: true });
      const [display, displayBold, body, bodyBold] = await Promise.all([load(FILES.display), load(FILES.displayBold), load(FILES.body), load(FILES.bodyBold)]);
      return { display, displayBold, body, bodyBold, embedded: true };
    } catch (e) {
      console.warn(`[print] No pude embeber las fuentes (${(e as Error).message}); uso Helvetica.`);
    }
  }
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  return { display: bold, displayBold: bold, body: regular, bodyBold: bold, embedded: false };
}
