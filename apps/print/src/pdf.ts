/**
 * Renderer de credenciales a partir de una `BadgeTemplate` (ADR-0009). Dibuja el
 * anverso y el reverso con pdf-lib: franjas diagonales, cabecera, foto, campos,
 * banda del rol, acceso, acreditación, QR, pie de logos; y en el reverso el
 * recuadro de información, contacto de emergencia, EPS, patrocinadores y Code 128.
 * Medidas en milímetros desde la esquina superior izquierda de cada tarjeta.
 *
 * `layout: 'two-pages'` → una página por lado; `'duplex'` → una página de doble
 * ancho con anverso a la izquierda y reverso a la derecha.
 */
import {
  PDFDocument, PDFPage, clip, closePath, endPath, lineTo, moveTo, popGraphicsState, pushGraphicsState, rgb, type PDFFont, type PDFImage, type RGB
} from 'pdf-lib';
import QRCode from 'qrcode';
import {
  accessText, badgeTextsFromConfig, code128Bars, defaultBadgeTemplate, displayCredentialId, encodeCode128B, resolveBadgeFields, roleBandStyle,
  type BadgeIcon, type BadgePersonData, type BadgeTemplate, type Credential, type EventConfig
} from '@tatami/core';
import { AssetCache, type Embedded } from './assets.js';
import { loadFonts, type BadgeFonts } from './fonts.js';
import { drawIcon, WHITE } from './icons.js';

export const MM = 72 / 25.4;
/** Tamaño de la tarjeta por defecto (100 × 150 mm) en puntos. */
export const CARD_W = 100 * MM;
export const CARD_H = 150 * MM;

export interface PrintableCredential extends Credential {
  token: string;
  /** Datos de la persona ya filtrados por `privacy` (ver `filterPersonForBadge`). */
  person?: BadgePersonData;
}

export type BadgeLayout = 'two-pages' | 'duplex';

export interface BuildOptions {
  template?: BadgeTemplate;
  layout?: BadgeLayout;
}

// ---------- utilidades ----------

export function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function isLight(h: string): boolean {
  const n = parseInt(h.replace('#', ''), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62;
}

/** pdf-lib con fuentes estándar (WinAnsi) no soporta todos los caracteres. */
function winAnsi(text: string): string {
  return text.normalize('NFC').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

/** Tarjeta: origen en mm (esquina superior izquierda) sobre una página; convierte a puntos. */
class Card {
  constructor(readonly page: PDFPage, readonly fonts: BadgeFonts, readonly t: BadgeTemplate, readonly ox: number, readonly oy: number, readonly w: number, readonly h: number) {}

  x(mm: number): number { return this.ox + mm * MM; }
  /** y en puntos de un borde superior dado en mm desde arriba. */
  top(mm: number): number { return this.oy + (this.h - mm) * MM; }
  safe(s: string): string { return this.fonts.embedded ? s : winAnsi(s); }
  width(text: string, font: PDFFont, size: number): number { return font.widthOfTextAtSize(this.safe(text), size); }

  fit(text: string, font: PDFFont, maxMm: number, start: number, min = 5): number {
    let size = start;
    while (size > min && this.width(text, font, size) > maxMm * MM) size -= 0.25;
    return size;
  }

  /** Texto con línea base en `yTopMm + size` (aprox. caja de texto cuya parte superior es yTopMm). */
  text(text: string, xMm: number, yTopMm: number, size: number, font: PDFFont, color: RGB, opts: { align?: 'left' | 'center' | 'right'; maxMm?: number; opacity?: number } = {}): number {
    const s = this.safe(text);
    const used = opts.maxMm ? this.fit(s, font, opts.maxMm, size) : size;
    const w = font.widthOfTextAtSize(s, used);
    let x = this.x(xMm);
    if (opts.align === 'center') x -= w / 2;
    if (opts.align === 'right') x -= w;
    this.page.drawText(s, { x, y: this.top(yTopMm) - used * 0.78, size: used, font, color, opacity: opts.opacity });
    return w / MM;
  }

  /** Texto con espaciado entre letras (pdf-lib no lo trae): devuelve el ancho total en mm. */
  spaced(text: string, xMm: number, yTopMm: number, size: number, font: PDFFont, color: RGB, spacingPt: number, align: 'left' | 'center' = 'left'): number {
    const s = this.safe(text);
    const chars = [...s];
    const total = chars.reduce((a, c) => a + font.widthOfTextAtSize(c, size), 0) + spacingPt * (chars.length - 1);
    let x = this.x(xMm) - (align === 'center' ? total / 2 : 0);
    const y = this.top(yTopMm) - size * 0.78;
    for (const c of chars) {
      this.page.drawText(c, { x, y, size, font, color });
      x += font.widthOfTextAtSize(c, size) + spacingPt;
    }
    return total / MM;
  }

  /** Parte un texto en líneas que quepan en `maxMm`. */
  wrap(text: string, font: PDFFont, size: number, maxMm: number, maxLines: number): string[] {
    const words = this.safe(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxMm * MM || !cur) cur = next;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (font.widthOfTextAtSize(last + '…', size) > maxMm * MM && last.length > 1) last = last.slice(0, -1);
      kept[maxLines - 1] = last + '…';
      return kept;
    }
    return lines;
  }

  rect(xMm: number, yTopMm: number, wMm: number, hMm: number, opts: { color?: RGB; border?: RGB; borderWidth?: number; opacity?: number; rotate?: number }) {
    this.page.drawRectangle({
      x: this.x(xMm), y: this.top(yTopMm + hMm), width: wMm * MM, height: hMm * MM, color: opts.color, borderColor: opts.border, borderWidth: opts.borderWidth ?? (opts.border ? 0.6 : undefined),
      opacity: opts.opacity, borderOpacity: opts.opacity, ...(opts.rotate ? { rotate: { type: 'degrees', angle: opts.rotate } as never } : {})
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB, thickness = 0.5, opacity?: number) {
    this.page.drawLine({ start: { x: this.x(x1), y: this.top(y1) }, end: { x: this.x(x2), y: this.top(y2) }, color, thickness, opacity });
  }

  icon(icon: BadgeIcon, xMm: number, yTopMm: number, sizeMm: number, color: RGB, hole?: RGB) {
    drawIcon(this.page, icon, this.x(xMm), this.top(yTopMm), sizeMm * MM, color, hole);
  }

  /** Imagen (o placeholder) contenida en la caja, centrada. */
  image(e: Embedded, xMm: number, yTopMm: number, wMm: number, hMm: number, muted: RGB) {
    if (e.kind === 'image') {
      let w = wMm, h = wMm / e.ratio;
      if (h > hMm) { h = hMm; w = hMm * e.ratio; }
      this.page.drawImage(e.image, { x: this.x(xMm + (wMm - w) / 2), y: this.top(yTopMm + (hMm - h) / 2 + h), width: w * MM, height: h * MM });
    } else {
      this.rect(xMm, yTopMm, wMm, hMm, { border: muted, borderWidth: 0.4, opacity: 0.6 });
      const lines = this.wrap(e.name, this.fonts.bodyBold, 5, wMm - 2, 2);
      lines.forEach((l, i) => this.text(l, xMm + wMm / 2, yTopMm + hMm / 2 - (lines.length * 2.2) / 2 + i * 2.2, 5, this.fonts.bodyBold, muted, { align: 'center', maxMm: wMm - 2 }));
    }
  }

  /** Limita el dibujo al rectángulo de la tarjeta (las franjas se salen a propósito). */
  clipStart() {
    const x0 = this.ox, y0 = this.oy, x1 = this.ox + this.w * MM, y1 = this.oy + this.h * MM;
    this.page.pushOperators(pushGraphicsState(), moveTo(x0, y0), lineTo(x1, y0), lineTo(x1, y1), lineTo(x0, y1), closePath(), clip(), endPath());
  }
  clipEnd() { this.page.pushOperators(popGraphicsState()); }
}

// ---------- piezas compartidas ----------

async function qrImage(doc: PDFDocument, text: string): Promise<PDFImage> {
  const buf = await QRCode.toBuffer(text, { errorCorrectionLevel: 'M', margin: 0, scale: 8 });
  return doc.embedPng(buf);
}

function stripes(c: Card) {
  const { t } = c;
  if (!t.background.stripes) return;
  const a = t.background.angle;
  const op = t.background.opacity;
  const [s1, s2, s3] = [hex(t.colors.stripe1), hex(t.colors.stripe2), hex(t.colors.stripe3)];
  // grupo superior izquierdo: tres franjas que suben hacia la derecha
  const band = (xMm: number, yMm: number, lenMm: number, thick: number, color: RGB, opacity: number) => c.rect(xMm, yMm, lenMm, thick, { color, opacity, rotate: a });
  band(-30, 30, 60, 3.2, s1, op);
  band(-24, 34, 60, 2, s2, op);
  band(-20, 40, 60, 1.2, s3, op);
  band(-4, 60, 40, 1.4, s3, op * 0.7);
  band(0, 110, 30, 1, s3, op * 0.5);
  // grupo inferior derecho
  band(c.w - 36, c.h + 4, 52, 3.2, s1, op);
  band(c.w - 30, c.h + 8, 52, 2, s2, op);
  band(c.w - 26, c.h + 12, 52, 1.2, s3, op);
  band(c.w - 46, c.h - 2, 24, 1, s3, op * 0.6);
  // detalle superior derecho (pequeño)
  band(c.w - 14, -2, 30, 1.6, s1, op * 0.9);
  band(c.w - 10, 2, 30, 1, s2, op * 0.9);
}

async function header(c: Card, assets: AssetCache, config: EventConfig) {
  const { t, fonts } = c;
  const primary = hex(t.colors.primary), accent = hex(t.colors.accent), gold = hex(t.colors.gold);
  const texts = badgeTextsFromConfig(t, config);
  if (t.header.showSkyline && t.header.skylineAsset) {
    const sky = await assets.get(t.header.skylineAsset);
    if (sky.kind === 'image') c.image(sky, c.w - 40, 2, 36, 38, hex(t.colors.muted));
  }
  // número de edición con contorno
  let x = 7;
  if (texts.badgeNumber) {
    const size = 42;
    const wMm = c.width(texts.badgeNumber, fonts.display, size) / MM;
    for (const [dx, dy] of [[-0.9, 0], [0.9, 0], [0, -0.9], [0, 0.9], [-0.65, -0.65], [0.65, 0.65], [-0.65, 0.65], [0.65, -0.65]]) {
      c.page.drawText(c.safe(texts.badgeNumber), { x: c.x(x) + dx, y: c.top(6) - size * 0.78 + dy, size, font: fonts.display, color: primary });
    }
    c.text(texts.badgeNumber, x, 6, size, fonts.display, WHITE);
    x += wMm + 2.5;
  }
  // título en dos líneas si tiene dos palabras
  const words = texts.title.split(/\s+/).filter(Boolean);
  const l1 = words.length > 1 ? words.slice(0, Math.ceil(words.length / 2)).join(' ') : texts.title;
  const l2 = words.length > 1 ? words.slice(Math.ceil(words.length / 2)).join(' ') : '';
  const titleMax = 40;
  const s1 = c.fit(l1, fonts.display, titleMax, 19, 10);
  const s2 = l2 ? c.fit(l2, fonts.display, titleMax, 19, 10) : 0;
  const size = Math.min(s1, s2 || s1);
  c.text(l1, x, 5.2, size, fonts.display, primary);
  if (l2) c.text(l2, x, 5.2 + size * 0.33, size, fonts.display, primary);
  const titleW = Math.max(c.width(l1, fonts.display, size), l2 ? c.width(l2, fonts.display, size) : 0) / MM;
  c.text(texts.subtitle, x, 5.2 + size * 0.68, 7, fonts.displayBold, primary);
  // año en dos líneas en rosa, separado por una línea vertical
  const yx = x + titleW + 2.2;
  c.line(yx, 6.5, yx, 20, primary, 0.7);
  const y1 = texts.year.slice(0, 2), y2 = texts.year.slice(2);
  c.text(y1, yx + 1.8, 7, 13, fonts.display, accent);
  c.text(y2 || '', yx + 1.8, 12, 13, fonts.display, accent);
  // ciudad espaciada y fecha sobre línea dorada
  c.spaced(texts.city, c.w / 2, 23.2, 11, fonts.display, primary, 3.2, 'center');
  c.line(14, 29.6, c.w - 14, 29.6, gold, 0.6);
  c.spaced(texts.dateLine, c.w / 2, 30.6, 5.6, fonts.displayBold, primary, 1.2, 'center');
}

async function footer(c: Card, assets: AssetCache, logos: string[], yTop: number) {
  const { t } = c;
  const gold = hex(t.colors.gold), muted = hex(t.colors.muted);
  // fondo blanco translúcido para que las franjas no tapen los logos
  c.rect(0, yTop + 0.4, c.w, c.h - yTop - 0.4, { color: WHITE, opacity: 0.88 });
  c.line(6, yTop, c.w - 6, yTop, gold, 0.6);
  if (!logos.length) return;
  const inner = c.w - 12;
  const cell = inner / logos.length;
  for (let i = 0; i < logos.length; i++) {
    const e = await assets.get(logos[i]);
    const x = 6 + i * cell;
    c.image(e, x + 1.2, yTop + 1.6, cell - 2.4, c.h - yTop - 3.2, muted);
    if (i > 0) c.line(x, yTop + 2.2, x, c.h - 2.2, muted, 0.3, 0.6);
  }
}

// ---------- anverso ----------

async function front(c: Card, doc: PDFDocument, assets: AssetCache, cred: PrintableCredential, config: EventConfig) {
  const { t, fonts } = c;
  const primary = hex(t.colors.primary), accent = hex(t.colors.accent), text = hex(t.colors.text), muted = hex(t.colors.muted);
  const border = rgb(0.86, 0.88, 0.92);
  c.clipStart();
  c.rect(0, 0, c.w, c.h, { color: WHITE });
  if (t.background.imageAsset) { const bg = await assets.get(t.background.imageAsset); if (bg.kind === 'image') c.page.drawImage(bg.image, { x: c.x(0), y: c.top(c.h), width: c.w * MM, height: c.h * MM }); }
  stripes(c);
  await header(c, assets, config);

  // bloque de datos: foto + campos
  const top = 38;
  let fieldsX = 7;
  const photo = t.front.photo;
  if (photo.visible) {
    c.rect(7, top, photo.widthMm, photo.heightMm, { color: rgb(0.93, 0.94, 0.96), border: muted, borderWidth: 0.6 });
    const initials = cred.displayName.split(' ').slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase();
    c.text(initials, 7 + photo.widthMm / 2, top + photo.heightMm / 2 - 5, 20, fonts.display, muted, { align: 'center' });
    const role = config.roles.find((r) => r.code === cred.roleCode);
    if (role?.requiresPhoto) c.text('FOTO', 7 + photo.widthMm / 2, top + photo.heightMm - 5, 5, fonts.bodyBold, muted, { align: 'center' });
    fieldsX = 7 + photo.widthMm + 3;
  }
  const fields = resolveBadgeFields(t, cred, cred.person, config);
  const fieldsW = c.w - 7 - fieldsX;
  const blockH = photo.visible ? photo.heightMm : 40;
  const gap = 1.4;
  const fh = fields.length ? (blockH - gap * (fields.length - 1)) / fields.length : 0;
  fields.forEach((f, i) => {
    const y = top + i * (fh + gap);
    c.rect(fieldsX, y, fieldsW, fh, { color: WHITE, border, borderWidth: 0.5 });
    c.text(f.label, fieldsX + 2, y + 1.1, 4.6, fonts.displayBold, hex(f.labelColor));
    c.text(f.value || '—', fieldsX + 2, y + fh / 2 - 0.4, Math.min(9, fh * 1.1), fonts.bodyBold, text, { maxMm: fieldsW - 4 });
  });

  // banda del rol
  let y = top + blockH + 3;
  if (t.front.roleBand.visible) {
    const band = roleBandStyle(t, cred.roleCode, config);
    const bandColor = hex(band.color);
    const ink = isLight(band.color) ? text : WHITE;
    c.rect(7, y, c.w - 14, 13, { color: bandColor });
    if (band.icon !== 'none') c.icon(band.icon, 10, y + 2.5, 8, ink, bandColor);
    const size = c.fit(band.name, fonts.display, c.w - 34, 26, 12);
    c.text(band.name, 7 + (c.w - 14) / 2 + 4, y + 6.5 - (size * 0.72 / MM) / 2, size, fonts.display, ink, { align: 'center' });
    y += 15.5;
  }

  // acceso + acreditación + QR
  const qrSize = Math.min(t.front.qr.sizeMm, 40);
  const qrX = c.w - 7 - qrSize;
  const leftW = qrX - 7 - 2.5;
  const qr = await qrImage(doc, cred.token);
  c.rect(qrX - 1.5, y - 1.5, qrSize + 3, qrSize + 3, { color: WHITE, border, borderWidth: 0.5 });
  c.page.drawImage(qr, { x: c.x(qrX), y: c.top(y + qrSize), width: qrSize * MM, height: qrSize * MM });
  let ly = y;
  if (t.front.access.visible) {
    const h = Math.max(11, qrSize * 0.55);
    c.rect(7, ly, leftW, h, { color: WHITE, border, borderWidth: 0.5 });
    c.icon(t.front.access.icon, 9, ly + 2.4, 6, accent);
    c.text(t.front.access.label, 17, ly + 1.4, 5.5, fonts.displayBold, accent);
    const lines = c.wrap(accessText(t, cred, config), fonts.body, 6.5, leftW - 12, 2);
    lines.forEach((l, i) => c.text(l, 17, ly + 4.6 + i * 3, 6.5, fonts.body, text));
    ly += h + 1.5;
  }
  if (t.front.accreditation.visible) {
    const h = Math.max(9, y + qrSize + 1.5 - ly);
    c.rect(7, ly, leftW, h, { color: WHITE, border, borderWidth: 0.5 });
    c.text(t.front.accreditation.label, 9.5, ly + 1.2, 5, fonts.displayBold, accent);
    c.text(displayCredentialId(cred.id, t.credentialDisplay.prefix), 9.5, ly + 4.2, 8, fonts.displayBold, primary, { maxMm: leftW - 5 });
  }
  const footerY = Math.max(y + qrSize + 3.5, c.h - 15);
  c.text(`v${cred.version}`, c.w - 7, footerY - 3, 4, fonts.body, muted, { align: 'right' });
  await footer(c, assets, t.front.footer.logos, footerY);
  c.clipEnd();
}

// ---------- reverso ----------

async function back(c: Card, assets: AssetCache, cred: PrintableCredential, config: EventConfig) {
  const { t, fonts } = c;
  const primary = hex(t.colors.primary), accent = hex(t.colors.accent), text = hex(t.colors.text), muted = hex(t.colors.muted);
  const border = rgb(0.86, 0.88, 0.92);
  c.clipStart();
  c.rect(0, 0, c.w, c.h, { color: WHITE });
  stripes(c);
  await header(c, assets, config);

  let y = 36;
  const b = t.back;
  // información importante
  if (b.infoBox.items.length) {
    const rowH = 7.2;
    const h = 7.5 + b.infoBox.items.length * rowH + 1;
    c.rect(7, y, c.w - 14, h, { color: WHITE, border, borderWidth: 0.5 });
    c.icon(b.infoBox.icon, 9.5, y + 1.6, 5.5, primary);
    c.text(b.infoBox.title, 17.5, y + 1.6, 8, fonts.display, primary);
    b.infoBox.items.forEach((it, i) => {
      const ry = y + 8 + i * rowH;
      c.icon(it.icon, 10, ry + 0.6, 4.2, primary);
      const lines = c.wrap(it.text, fonts.body, 6, c.w - 14 - 12, 2);
      lines.forEach((l, k) => c.text(l, 17, ry + 0.2 + k * 2.9, lines.length > 1 ? 5.4 : 6, fonts.body, text));
    });
    y += h + 2;
  }
  // contacto de emergencia + EPS
  const cards: { label: string; icon: BadgeIcon; lines: string[] }[] = [];
  if (b.emergencyContact.visible && t.privacy.printEmergency) cards.push({ label: b.emergencyContact.label, icon: b.emergencyContact.icon, lines: cred.person?.emergencyContact ? [cred.person.emergencyContact.name, cred.person.emergencyContact.phone] : ['—'] });
  if (b.eps.visible && t.privacy.printEps) cards.push({ label: b.eps.label, icon: b.eps.icon, lines: cred.person?.eps ? [cred.person.eps.name, cred.person.eps.regime ?? ''].filter(Boolean) : ['—'] });
  if (cards.length) {
    const h = 16;
    const w = (c.w - 14 - (cards.length - 1) * 2) / cards.length;
    cards.forEach((k, i) => {
      const x = 7 + i * (w + 2);
      c.rect(x, y, w, h, { color: WHITE, border, borderWidth: 0.5 });
      c.icon(k.icon, x + 2.5, y + 2.6, 5, accent);
      c.text(k.label, x + 9.5, y + 1.6, 5.4, fonts.displayBold, accent, { maxMm: w - 11 });
      k.lines.forEach((l, j) => c.text(l, x + 9.5, y + 5.6 + j * 3.6, 6.2, j === 0 ? fonts.bodyBold : fonts.body, text, { maxMm: w - 11 }));
    });
    y += h + 2;
  }
  // patrocinadores
  if (b.sponsors.logos.length) {
    const h = 16;
    c.rect(7, y, c.w - 14, h, { color: WHITE, border, borderWidth: 0.5 });
    c.icon(b.sponsors.icon, 9.5, y + 1.6, 4, primary);
    c.text(b.sponsors.title, 15, y + 1.3, 5.6, fonts.displayBold, accent);
    const n = b.sponsors.logos.length;
    const cell = (c.w - 14 - 3) / n;
    for (let i = 0; i < n; i++) {
      const e = await assets.get(b.sponsors.logos[i]);
      c.image(e, 8.5 + i * cell + 0.8, y + 5.5, cell - 1.6, h - 6.5, muted);
    }
    y += h + 2;
  }
  // código de barras
  if (b.barcode.visible) {
    const h = 12;
    c.rect(7, y, c.w - 14, h, { color: WHITE, border, borderWidth: 0.5 });
    const shown = displayCredentialId(cred.id, t.credentialDisplay.prefix);
    try {
      const code = encodeCode128B(shown);
      const availMm = c.w - 14 - 10;
      const module = Math.min(0.33, availMm / code.modules);
      const totalMm = code.modules * module;
      const x0 = 7 + (c.w - 14 - totalMm) / 2;
      for (const bar of code128Bars(code)) c.rect(x0 + bar.x * module, y + 1.5, bar.w * module, 6.3, { color: text });
    } catch { /* ID con caracteres raros: solo texto */ }
    c.text(shown, c.w / 2, y + 8.3, 6, fonts.bodyBold, text, { align: 'center' });
    y += h + 2;
  }
  const footerY = Math.max(y, c.h - 15);
  await footer(c, assets, b.footer.logos, footerY);
  c.clipEnd();
}

// ---------- API ----------

/** Dibuja una credencial completa (anverso y, si está activo, reverso) en el documento. */
export async function drawBadge(doc: PDFDocument, fonts: BadgeFonts, assets: AssetCache, cred: PrintableCredential, config: EventConfig, template: BadgeTemplate, layout: BadgeLayout): Promise<void> {
  const W = template.size.widthMm, H = template.size.heightMm;
  const withBack = template.back.enabled;
  if (layout === 'duplex' && withBack) {
    const page = doc.addPage([2 * W * MM, H * MM]);
    await front(new Card(page, fonts, template, 0, 0, W, H), doc, assets, cred, config);
    await back(new Card(page, fonts, template, W * MM, 0, W, H), assets, cred, config);
    page.drawLine({ start: { x: W * MM, y: 0 }, end: { x: W * MM, y: H * MM }, thickness: 0.3, color: rgb(0.7, 0.7, 0.7), dashArray: [3, 3] });
    return;
  }
  const p1 = doc.addPage([W * MM, H * MM]);
  await front(new Card(p1, fonts, template, 0, 0, W, H), doc, assets, cred, config);
  if (withBack) {
    const p2 = doc.addPage([W * MM, H * MM]);
    await back(new Card(p2, fonts, template, 0, 0, W, H), assets, cred, config);
  }
}

/** PDF con todas las credenciales. Compatible con la firma anterior (template y layout opcionales). */
export async function buildCredentialsPdf(creds: PrintableCredential[], config: EventConfig, opts: BuildOptions = {}): Promise<Uint8Array> {
  const template = opts.template ?? defaultBadgeTemplate();
  const layout = opts.layout ?? 'two-pages';
  const doc = await PDFDocument.create();
  doc.setTitle(`Credenciales ${config.eventId}`);
  doc.setProducer('Tatami Pass');
  const fonts = await loadFonts(doc);
  const assets = new AssetCache(doc, template.assets);
  for (const c of creds) await drawBadge(doc, fonts, assets, c, config, template, layout);
  return doc.save();
}
