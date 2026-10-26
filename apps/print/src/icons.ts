/**
 * Iconos vectoriales simples (caja de 24 × 24) que el renderer dibuja con
 * primitivas de pdf-lib. Son monocromos y deliberadamente geométricos: el
 * objetivo es que se lean a 4–6 mm en la credencial. Ids en `BADGE_ICONS` (core).
 */
import type { PDFPage } from 'pdf-lib';
import { rgb, type RGB } from 'pdf-lib';
import type { BadgeIcon } from '@tatami/core';

type Op =
  | { t: 'circle'; cx: number; cy: number; r: number; stroke?: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; stroke?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number }
  | { t: 'path'; d: string; stroke?: number };

const ICONS: Record<BadgeIcon, Op[]> = {
  none: [],
  // figura pateando: cabeza, tronco inclinado, pierna de apoyo y patada alta
  kick: [
    { t: 'circle', cx: 9, cy: 4, r: 2.6 },
    { t: 'line', x1: 9, y1: 7, x2: 11, y2: 14, w: 3 },
    { t: 'line', x1: 11, y1: 14, x2: 7, y2: 22, w: 2.6 },
    { t: 'line', x1: 11, y1: 13, x2: 22, y2: 8, w: 2.8 },
    { t: 'line', x1: 9.5, y1: 9, x2: 3, y2: 12, w: 2.2 }
  ],
  lock: [
    { t: 'rect', x: 4, y: 10, w: 16, h: 12 },
    { t: 'path', d: 'M8 10 V7 A4 4 0 0 1 16 7 V10', stroke: 2.4 },
    { t: 'circle', cx: 12, cy: 16, r: 1.6, stroke: -1 }
  ],
  info: [
    { t: 'circle', cx: 12, cy: 12, r: 10 },
    { t: 'circle', cx: 12, cy: 7.5, r: 1.5, stroke: -1 },
    { t: 'rect', x: 10.6, y: 10.5, w: 2.8, h: 7.5, stroke: -1 }
  ],
  person: [
    { t: 'circle', cx: 12, cy: 7, r: 4.2 },
    { t: 'path', d: 'M3 22 C3 15 7 13 12 13 C17 13 21 15 21 22 Z' }
  ],
  calendar: [
    { t: 'rect', x: 3, y: 5, w: 18, h: 16, stroke: 2 },
    { t: 'rect', x: 3, y: 5, w: 18, h: 4 },
    { t: 'line', x1: 8, y1: 2.5, x2: 8, y2: 7, w: 2 },
    { t: 'line', x1: 16, y1: 2.5, x2: 16, y2: 7, w: 2 },
    { t: 'rect', x: 7, y: 12, w: 3, h: 3 }, { t: 'rect', x: 12, y: 12, w: 3, h: 3 }, { t: 'rect', x: 7, y: 16.5, w: 3, h: 2.5 }
  ],
  'id-card': [
    { t: 'rect', x: 2, y: 5, w: 20, h: 14, stroke: 2 },
    { t: 'circle', cx: 8, cy: 11, r: 2.2 },
    { t: 'path', d: 'M4.5 16.5 C4.5 13.5 11.5 13.5 11.5 16.5 Z' },
    { t: 'line', x1: 13.5, y1: 10, x2: 19.5, y2: 10, w: 1.6 }, { t: 'line', x1: 13.5, y1: 13.5, x2: 19.5, y2: 13.5, w: 1.6 }
  ],
  ban: [
    { t: 'circle', cx: 12, cy: 12, r: 9, stroke: 2.4 },
    { t: 'line', x1: 5.5, y1: 5.5, x2: 18.5, y2: 18.5, w: 2.4 }
  ],
  warning: [
    { t: 'path', d: 'M12 2.5 L22.5 21 H1.5 Z', stroke: 2.2 },
    { t: 'rect', x: 10.8, y: 8.5, w: 2.4, h: 6.5 },
    { t: 'circle', cx: 12, cy: 17.8, r: 1.3 }
  ],
  phone: [
    { t: 'path', d: 'M5 3 L9 3 L11 8 L8.5 9.5 C9.5 12.5 11.5 14.5 14.5 15.5 L16 13 L21 15 L21 19 C21 20 20 21 19 21 C10 21 3 14 3 5 C3 4 4 3 5 3 Z' }
  ],
  cross: [
    { t: 'circle', cx: 12, cy: 12, r: 10 },
    { t: 'rect', x: 10.2, y: 5.5, w: 3.6, h: 13, stroke: -1 },
    { t: 'rect', x: 5.5, y: 10.2, w: 13, h: 3.6, stroke: -1 }
  ],
  star: [
    { t: 'path', d: 'M12 2 L14.9 8.6 L22 9.3 L16.6 14.1 L18.2 21.2 L12 17.5 L5.8 21.2 L7.4 14.1 L2 9.3 L9.1 8.6 Z' }
  ],
  whistle: [
    { t: 'path', d: 'M3 10 H15 L21 7 V13 L15 12 A6 6 0 1 1 3 10 Z' },
    { t: 'circle', cx: 9, cy: 15, r: 1.6, stroke: -1 }
  ],
  camera: [
    { t: 'path', d: 'M3 7 H8 L10 4 H14 L16 7 H21 V19 H3 Z' },
    { t: 'circle', cx: 12, cy: 13, r: 3.4, stroke: -1 }
  ],
  medical: [
    { t: 'rect', x: 3, y: 6, w: 18, h: 14 },
    { t: 'rect', x: 9, y: 3, w: 6, h: 4 },
    { t: 'rect', x: 10.8, y: 9, w: 2.4, h: 8, stroke: -1 }, { t: 'rect', x: 8, y: 11.8, w: 8, h: 2.4, stroke: -1 }
  ],
  shield: [
    { t: 'path', d: 'M12 2 L21 5.5 V11.5 C21 16.5 17.5 20.5 12 22 C6.5 20.5 3 16.5 3 11.5 V5.5 Z' },
    { t: 'path', d: 'M8 12 L11 15 L16.5 9', stroke: -2.2 }
  ],
  mic: [
    { t: 'rect', x: 9, y: 2.5, w: 6, h: 11 },
    { t: 'path', d: 'M5.5 11 A6.5 6.5 0 0 0 18.5 11', stroke: 2 },
    { t: 'line', x1: 12, y1: 17.5, x2: 12, y2: 21, w: 2 }, { t: 'line', x1: 8, y1: 21, x2: 16, y2: 21, w: 2 }
  ],
  handshake: [
    { t: 'path', d: 'M2 9 L7 5 L12 8 L17 5 L22 9 L17 15 L12 19 L7 15 Z' },
    { t: 'line', x1: 9, y1: 11, x2: 13, y2: 11, w: -1.8 }
  ]
};

export const WHITE = rgb(1, 1, 1);

/**
 * Dibuja el icono con su esquina superior izquierda en (x, yTop) (coordenadas PDF,
 * yTop medido desde abajo) y `size` puntos de lado. `stroke < 0` significa "hueco
 * en blanco" (se dibuja en `holeColor`, por defecto blanco) para contrastar sobre el relleno.
 */
export function drawIcon(page: PDFPage, icon: BadgeIcon, x: number, yTop: number, size: number, color: RGB, holeColor: RGB = WHITE): void {
  const ops = ICONS[icon] ?? [];
  const k = size / 24;
  const Y = (v: number) => yTop - v * k;
  for (const op of ops) {
    const hole = (op as { stroke?: number }).stroke !== undefined && (op as { stroke?: number }).stroke! < 0;
    const c = hole ? holeColor : color;
    const sw = (op as { stroke?: number }).stroke;
    const strokeOnly = sw !== undefined && sw > 0;
    switch (op.t) {
      case 'circle':
        page.drawCircle({ x: x + op.cx * k, y: Y(op.cy), size: op.r * k, ...(strokeOnly ? { borderColor: c, borderWidth: sw * k } : { color: c }) });
        break;
      case 'rect':
        page.drawRectangle({ x: x + op.x * k, y: Y(op.y + op.h), width: op.w * k, height: op.h * k, ...(strokeOnly ? { borderColor: c, borderWidth: sw * k } : { color: c }) });
        break;
      case 'line':
        page.drawLine({ start: { x: x + op.x1 * k, y: Y(op.y1) }, end: { x: x + op.x2 * k, y: Y(op.y2) }, thickness: Math.abs(op.w) * k, color: op.w < 0 ? holeColor : color, lineCap: 1 });
        break;
      case 'path':
        if (strokeOnly) page.drawSvgPath(op.d, { x, y: yTop, scale: k, borderColor: c, borderWidth: sw * k, borderLineCap: 1 });
        else if (hole) page.drawSvgPath(op.d, { x, y: yTop, scale: k, borderColor: holeColor, borderWidth: Math.abs(sw!) * k, borderLineCap: 1 });
        else page.drawSvgPath(op.d, { x, y: yTop, scale: k, color: c });
        break;
    }
  }
}
