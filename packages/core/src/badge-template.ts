/**
 * Plantilla de credencial (ADR-0009): el diseño de la credencial impresa es un
 * JSON serializable que el host guarda en `data/badge-template.json`, el panel
 * edita y `apps/print` dibuja. Aquí viven el tipo, la plantilla por defecto del
 * piloto ("Nacional 2026", fiel a design/referencias/credencial-nacional-2026.png),
 * la validación con mensajes humanos y las funciones puras que resuelven textos
 * a partir de la config del evento y de la persona. Sin IO.
 */
import { parseCredentialId } from './credential-id.js';
import { resolveZones } from './default-config.js';
import type { Credential, EventConfig, Person } from './types.js';

// ---------- tipos ----------

/** Iconos vectoriales que el renderer sabe dibujar (ver apps/print/src/icons.ts). */
export const BADGE_ICONS = ['none', 'kick', 'lock', 'info', 'person', 'calendar', 'id-card', 'ban', 'warning', 'phone', 'cross', 'star', 'whistle', 'camera', 'medical', 'shield', 'mic', 'handshake'] as const;
export type BadgeIcon = (typeof BADGE_ICONS)[number];

/** De dónde sale el valor de un campo del anverso. */
export type BadgeFieldSource = 'person.name' | 'person.document' | 'person.club' | 'person.delegation' | 'credential.category' | 'credential.role' | 'custom';

export const BADGE_FIELD_SOURCES: { value: BadgeFieldSource; label: string }[] = [
  { value: 'person.name', label: 'Nombre completo' },
  { value: 'person.document', label: 'Documento de identidad' },
  { value: 'person.club', label: 'Club / academia' },
  { value: 'person.delegation', label: 'Delegación (departamento o región)' },
  { value: 'credential.category', label: 'Categoría de edad' },
  { value: 'credential.role', label: 'Rol de acceso' },
  { value: 'custom', label: 'Texto fijo' }
];

export interface BadgeField {
  /** Identificador estable dentro de la plantilla (p. ej. `name`). */
  key: string;
  /** Etiqueta pequeña en mayúsculas sobre el valor. */
  label: string;
  source: BadgeFieldSource;
  /** Solo si `source = custom`. */
  customText?: string;
  /** Color de la etiqueta: `primary`, `accent` o un hex. */
  labelColor: 'primary' | 'accent' | string;
  visible: boolean;
}

export interface BadgeAsset {
  name: string;
  /** `image/png`, `image/jpeg` o `image/svg+xml`. */
  mime: 'image/png' | 'image/jpeg' | 'image/svg+xml';
  dataBase64: string;
}

export interface BadgeTemplate {
  /** Identificador corto de la plantilla, p. ej. `nacional-2026`. */
  id: string;
  name: string;
  /** Versión del formato de plantilla (hoy 1). */
  version: 1;
  /** Tamaño de la tarjeta en milímetros (por defecto 100 × 150, vertical). */
  size: { widthMm: number; heightMm: number };
  colors: {
    /** Azul marino: títulos, textos fuertes. */
    primary: string;
    /** Rosa/magenta: año, etiquetas destacadas, banda del rol por defecto. */
    accent: string;
    text: string;
    muted: string;
    stripe1: string;
    stripe2: string;
    stripe3: string;
    gold: string;
    /** Color de la banda del rol cuando `front.roleBand.useRoleColor = false`. */
    roleBandDefault: string;
  };
  fonts: {
    /** Condensada bold para títulos y banda del rol. */
    display: { name: string; fallback: string };
    body: { name: string; fallback: string };
  };
  header: {
    /** Número grande con contorno (edición del campeonato), p. ej. `21`. */
    badgeNumber: string;
    title: string;
    subtitle: string;
    /** Vacío = se toma del año de `startDate`. */
    year: string;
    city: string;
    /** Vacío = "14 AL 16 DE NOVIEMBRE DE 2026" calculado desde la config. */
    dateLine: string;
    showSkyline: boolean;
    /** Id del asset con la silueta (SVG o PNG) o `null`. */
    skylineAsset: string | null;
  };
  background: {
    stripes: boolean;
    /** Ángulo de las franjas en grados (positivo = suben hacia la derecha). */
    angle: number;
    /** 0–1. */
    opacity: number;
    /** Imagen de fondo opcional (asset id). */
    imageAsset: string | null;
  };
  /** Cómo se muestra el ID corto. `prefix` reemplaza `TP-2026` en lo impreso (el dígito verificador se conserva). */
  credentialDisplay: { prefix: string | null };
  front: {
    fields: BadgeField[];
    photo: { visible: boolean; widthMm: number; heightMm: number };
    roleBand: {
      visible: boolean;
      /** Usa `color` del rol en event.config.json; si no, `colors.roleBandDefault`. */
      useRoleColor: boolean;
      /** Roles cuya banda siempre usa `colors.roleBandDefault` aunque `useRoleColor` sea true (p. ej. COMP en rosa). */
      defaultColorRoles: string[];
      /** Icono por código de rol; `*` = resto. */
      icons: Record<string, BadgeIcon>;
    };
    access: { visible: boolean; label: string; icon: BadgeIcon; /** Vacío = nombres de las zonas permitidas. */ text: string };
    accreditation: { visible: boolean; label: string };
    qr: { sizeMm: number };
    footer: { logos: string[] };
  };
  back: {
    enabled: boolean;
    infoBox: { title: string; icon: BadgeIcon; items: { icon: BadgeIcon; text: string }[] };
    emergencyContact: { visible: boolean; label: string; icon: BadgeIcon };
    eps: { visible: boolean; label: string; icon: BadgeIcon };
    sponsors: { title: string; icon: BadgeIcon; logos: string[] };
    barcode: { visible: boolean; symbology: 'code128' };
    footer: { logos: string[] };
  };
  assets: Record<string, BadgeAsset>;
  /**
   * Qué datos personales se imprimen (Ley 1581): aunque la persona los haya dado, el
   * administrador decide si van en el plástico. Por defecto todo en `true` para el piloto.
   */
  privacy: { printDocument: boolean; printEps: boolean; printEmergency: boolean };
}

/** Lo que el renderer necesita de una persona (el host lo arma desde `persons` según `privacy`). */
export interface BadgePersonData {
  documentNumber?: string;
  delegation?: string;
  emergencyContact?: { name: string; phone: string };
  eps?: { name: string; regime?: string };
}

// ---------- assets placeholder (SVG tipográficos; no son logos reales) ----------

const svg = (s: string) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'));

function logoPlaceholder(lines: string[], color = '#0F2A6B'): BadgeAsset {
  const fs = (l: string, base: number) => Math.min(base, Math.floor(330 / Math.max(l.length, 1)));
  const text = lines.map((l, i) => `<text x="100" y="${lines.length === 1 ? 46 : 32 + i * 24}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${fs(l, lines.length === 1 ? 26 : 18)}" fill="${color}">${l}</text>`).join('');
  return { name: lines.join(' '), mime: 'image/svg+xml', dataBase64: svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><rect x="1" y="1" width="198" height="78" rx="8" fill="none" stroke="${color}" stroke-opacity="0.35" stroke-dasharray="4 3"/>${text}</svg>`) };
}

/** Silueta sencilla de una torre con cúpula (recuerda la torre de la catedral de Popayán). Placeholder. */
function skylinePlaceholder(): BadgeAsset {
  const path = 'M10 200 L10 150 L40 150 L40 120 L60 120 L60 150 L80 150 L80 90 L95 90 L95 60 L110 40 L125 60 L125 90 L140 90 L140 150 L160 150 L160 110 L175 110 L175 150 L200 150 L200 200 Z M100 90 L120 90 L120 110 L100 110 Z';
  return { name: 'Silueta (placeholder)', mime: 'image/svg+xml', dataBase64: svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 200"><path d="${path}" fill="#0F2A6B" fill-opacity="0.12"/></svg>`) };
}

// ---------- plantilla por defecto del piloto ----------

export const DEFAULT_INFO_ITEMS: { icon: BadgeIcon; text: string }[] = [
  { icon: 'person', text: 'Uso personal e intransferible.' },
  { icon: 'calendar', text: 'Válida únicamente durante el evento.' },
  { icon: 'id-card', text: 'Presentar esta acreditación para el ingreso a las sedes.' },
  { icon: 'ban', text: 'Prohibida su reproducción total o parcial.' },
  { icon: 'warning', text: 'En caso de pérdida, reportar de inmediato al comité organizador.' }
];

/** Plantilla "Nacional 2026": reproduce el diseño de referencia del piloto con logos placeholder. */
export function defaultBadgeTemplate(): BadgeTemplate {
  return {
    id: 'nacional-2026',
    name: 'Nacional 2026',
    version: 1,
    size: { widthMm: 100, heightMm: 150 },
    colors: { primary: '#0F2A6B', accent: '#E6007E', text: '#101828', muted: '#6B7280', stripe1: '#0F2A6B', stripe2: '#E6007E', stripe3: '#D9DEE7', gold: '#C9A227', roleBandDefault: '#E6007E' },
    fonts: { display: { name: 'Barlow Condensed', fallback: 'Helvetica-Bold' }, body: { name: 'Barlow', fallback: 'Helvetica' } },
    header: { badgeNumber: '21', title: 'CAMPEONATO NACIONAL', subtitle: 'TAEKWON-DO ITF', year: '', city: 'POPAYÁN', dateLine: '', showSkyline: true, skylineAsset: 'skyline' },
    background: { stripes: true, angle: 55, opacity: 0.9, imageAsset: null },
    credentialDisplay: { prefix: null },
    front: {
      fields: [
        { key: 'name', label: 'NOMBRE COMPLETO', source: 'person.name', labelColor: 'primary', visible: true },
        { key: 'document', label: 'DOCUMENTO', source: 'person.document', labelColor: 'primary', visible: true },
        { key: 'club', label: 'ACADEMIA', source: 'person.club', labelColor: 'primary', visible: true },
        { key: 'delegation', label: 'DELEGACIÓN', source: 'person.delegation', labelColor: 'accent', visible: true }
      ],
      photo: { visible: true, widthMm: 30, heightMm: 42 },
      roleBand: { visible: true, useRoleColor: true, defaultColorRoles: ['COMP'], icons: { COMP: 'kick', COACH: 'whistle', JUR: 'shield', VIP: 'star', SPON: 'handshake', PRESS: 'camera', MED: 'medical', STAFF: 'id-card', GEN: 'person', ACOMP: 'person', '*': 'id-card' } },
      access: { visible: true, label: 'ACCESO:', icon: 'lock', text: '' },
      accreditation: { visible: true, label: 'ACREDITACIÓN No.' },
      qr: { sizeMm: 30 },
      footer: { logos: ['logo-itf', 'logo-federacion', 'logo-alcaldia', 'logo-secretaria'] }
    },
    back: {
      enabled: true,
      infoBox: { title: 'INFORMACIÓN IMPORTANTE', icon: 'info', items: DEFAULT_INFO_ITEMS.map((i) => ({ ...i })) },
      emergencyContact: { visible: true, label: 'CONTACTO DE EMERGENCIA', icon: 'phone' },
      eps: { visible: true, label: 'EPS', icon: 'cross' },
      sponsors: { title: 'PATROCINADORES', icon: 'star', logos: ['sponsor-1', 'sponsor-2', 'sponsor-3', 'sponsor-4'] },
      barcode: { visible: true, symbology: 'code128' },
      footer: { logos: ['logo-itf', 'logo-federacion', 'logo-alcaldia', 'logo-secretaria'] }
    },
    assets: {
      skyline: skylinePlaceholder(),
      'logo-itf': logoPlaceholder(['ITF', 'International Taekwon-Do Federation']),
      'logo-federacion': logoPlaceholder(['Federación', 'Colombiana ITF']),
      'logo-alcaldia': logoPlaceholder(['Alcaldía de', 'Popayán']),
      'logo-secretaria': logoPlaceholder(['Secretaría de', 'Deporte y Recreación']),
      'sponsor-1': logoPlaceholder(['Patrocinador 1'], '#101828'),
      'sponsor-2': logoPlaceholder(['Patrocinador 2'], '#101828'),
      'sponsor-3': logoPlaceholder(['Patrocinador 3'], '#101828'),
      'sponsor-4': logoPlaceholder(['Patrocinador 4'], '#101828')
    },
    privacy: { printDocument: true, printEps: true, printEmergency: true }
  };
}

// ---------- validación ----------

export interface TemplateError { path: string; message: string }

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Tamaño máximo de un asset decodificado (1 MB). */
export const MAX_ASSET_BYTES = 1024 * 1024;

function isObj(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }

/** Valida una plantilla y devuelve errores con mensajes humanos (vacío = válida). */
export function validateBadgeTemplate(input: unknown): TemplateError[] {
  const errors: TemplateError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!isObj(input)) { err('', 'La plantilla debe ser un objeto JSON.'); return errors; }
  const t = input as Partial<BadgeTemplate>;
  if (!t.id || typeof t.id !== 'string' || !/^[a-z0-9-]{2,40}$/.test(t.id)) err('id', 'Pon un identificador corto en minúsculas, números y guiones (p. ej. nacional-2026).');
  if (!t.name || typeof t.name !== 'string' || t.name.trim().length < 2) err('name', 'Escribe un nombre para la plantilla.');
  if (t.version !== 1) err('version', 'Esta versión de Tatami Pass solo entiende plantillas versión 1.');
  if (!isObj(t.size) || !(t.size.widthMm >= 50 && t.size.widthMm <= 210) || !(t.size.heightMm >= 50 && t.size.heightMm <= 297)) err('size', 'El tamaño debe estar entre 50 × 50 mm y 210 × 297 mm (una hoja carta/A4).');
  if (!isObj(t.colors)) err('colors', 'Faltan los colores.');
  else for (const k of ['primary', 'accent', 'text', 'muted', 'stripe1', 'stripe2', 'stripe3', 'gold', 'roleBandDefault'] as const) {
    if (!HEX.test(String(t.colors[k] ?? ''))) err(`colors.${k}`, 'El color debe ser hexadecimal de 6 dígitos, como #0F2A6B.');
  }
  if (!isObj(t.fonts) || !isObj(t.fonts.display) || !isObj(t.fonts.body)) err('fonts', 'Faltan las fuentes (display y body).');
  if (!isObj(t.header)) err('header', 'Falta la cabecera.');
  else {
    if (typeof t.header.title !== 'string' || !t.header.title.trim()) err('header.title', 'Escribe el título de la cabecera (p. ej. CAMPEONATO NACIONAL).');
    if (typeof t.header.badgeNumber !== 'string' || t.header.badgeNumber.length > 4) err('header.badgeNumber', 'El número de la edición tiene máximo 4 caracteres.');
    if (t.header.showSkyline && t.header.skylineAsset && !t.assets?.[t.header.skylineAsset]) err('header.skylineAsset', 'La silueta apunta a una imagen que no existe. Súbela o desactívala.');
  }
  if (!isObj(t.background)) err('background', 'Falta el fondo.');
  else {
    if (typeof t.background.opacity !== 'number' || t.background.opacity < 0 || t.background.opacity > 1) err('background.opacity', 'La opacidad de las franjas va de 0 a 1.');
    if (typeof t.background.angle !== 'number' || t.background.angle < -89 || t.background.angle > 89) err('background.angle', 'El ángulo de las franjas va de -89 a 89 grados.');
    if (t.background.imageAsset && !t.assets?.[t.background.imageAsset]) err('background.imageAsset', 'La imagen de fondo apunta a un archivo que no existe.');
  }
  if (!isObj(t.credentialDisplay)) err('credentialDisplay', 'Falta credentialDisplay.');
  else if (t.credentialDisplay.prefix !== null && !/^[A-Z0-9]{2,12}$/.test(String(t.credentialDisplay.prefix))) err('credentialDisplay.prefix', 'El prefijo impreso lleva solo mayúsculas y números, de 2 a 12 caracteres (p. ej. CNITF2026), o déjalo vacío.');
  if (!isObj(t.front)) err('front', 'Falta el anverso.');
  else {
    const f = t.front as BadgeTemplate['front'];
    if (!Array.isArray(f.fields)) err('front.fields', 'Los campos del anverso deben ser una lista.');
    else {
      if (f.fields.length > 6) err('front.fields', 'Máximo 6 campos en el anverso: no caben más junto a la foto.');
      const keys = new Set<string>();
      f.fields.forEach((fld, i) => {
        if (!fld || typeof fld.key !== 'string' || !fld.key) err(`front.fields[${i}].key`, 'Cada campo necesita una clave.');
        else if (keys.has(fld.key)) err(`front.fields[${i}].key`, `La clave "${fld.key}" está repetida.`);
        else keys.add(fld.key);
        if (typeof fld?.label !== 'string') err(`front.fields[${i}].label`, 'Escribe la etiqueta del campo.');
        if (!BADGE_FIELD_SOURCES.some((s) => s.value === fld?.source)) err(`front.fields[${i}].source`, 'Elige de dónde sale el valor del campo.');
        if (fld?.labelColor && fld.labelColor !== 'primary' && fld.labelColor !== 'accent' && !HEX.test(fld.labelColor)) err(`front.fields[${i}].labelColor`, 'El color de la etiqueta es primary, accent o un hex.');
      });
    }
    if (!isObj(f.photo) || !(f.photo.widthMm >= 15 && f.photo.widthMm <= 60) || !(f.photo.heightMm >= 15 && f.photo.heightMm <= 70)) err('front.photo', 'La foto mide entre 15 y 60 mm de ancho y entre 15 y 70 mm de alto.');
    if (!isObj(f.roleBand)) err('front.roleBand', 'Falta la banda del rol.');
    else for (const [role, icon] of Object.entries(f.roleBand.icons ?? {})) if (!BADGE_ICONS.includes(icon)) err(`front.roleBand.icons.${role}`, `No conozco el icono "${icon}".`);
    if (!isObj(f.access) || typeof f.access.label !== 'string') err('front.access', 'Falta la tarjeta de acceso.');
    if (!isObj(f.accreditation) || typeof f.accreditation.label !== 'string') err('front.accreditation', 'Falta la tarjeta de acreditación.');
    if (!isObj(f.qr) || !(f.qr.sizeMm >= 18 && f.qr.sizeMm <= 60)) err('front.qr.sizeMm', 'El QR mide entre 18 y 60 mm; por debajo de 18 mm los scanners fallan.');
    if (!isObj(f.footer) || !Array.isArray(f.footer.logos)) err('front.footer.logos', 'Los logos del pie deben ser una lista.');
    else {
      if (f.footer.logos.length > 6) err('front.footer.logos', 'Máximo 6 logos en el pie.');
      f.footer.logos.forEach((id, i) => { if (!t.assets?.[id]) err(`front.footer.logos[${i}]`, `El logo "${id}" no existe. Súbelo o quítalo de la lista.`); });
    }
  }
  if (!isObj(t.back)) err('back', 'Falta el reverso.');
  else {
    const b = t.back as BadgeTemplate['back'];
    if (!isObj(b.infoBox) || !Array.isArray(b.infoBox.items)) err('back.infoBox', 'Falta el recuadro de información importante.');
    else {
      if (b.infoBox.items.length > 8) err('back.infoBox.items', 'Máximo 8 líneas de información: más no caben en el reverso.');
      b.infoBox.items.forEach((it, i) => {
        if (typeof it?.text !== 'string' || !it.text.trim()) err(`back.infoBox.items[${i}].text`, 'Escribe el texto de la línea o quítala.');
        else if (it.text.length > 110) err(`back.infoBox.items[${i}].text`, 'Cada línea tiene máximo 110 caracteres.');
        if (!BADGE_ICONS.includes(it?.icon)) err(`back.infoBox.items[${i}].icon`, `No conozco el icono "${String(it?.icon)}".`);
      });
    }
    if (!isObj(b.sponsors) || !Array.isArray(b.sponsors.logos)) err('back.sponsors', 'Faltan los patrocinadores.');
    else {
      if (b.sponsors.logos.length > 6) err('back.sponsors.logos', 'Máximo 6 logos de patrocinadores.');
      b.sponsors.logos.forEach((id, i) => { if (!t.assets?.[id]) err(`back.sponsors.logos[${i}]`, `El logo "${id}" no existe. Súbelo o quítalo de la lista.`); });
    }
    if (!isObj(b.barcode) || b.barcode.symbology !== 'code128') err('back.barcode', 'El código de barras solo puede ser code128.');
    if (!isObj(b.footer) || !Array.isArray(b.footer.logos)) err('back.footer.logos', 'Los logos del pie del reverso deben ser una lista.');
    else b.footer.logos.forEach((id, i) => { if (!t.assets?.[id]) err(`back.footer.logos[${i}]`, `El logo "${id}" no existe. Súbelo o quítalo de la lista.`); });
  }
  if (!isObj(t.assets)) err('assets', 'Faltan los assets (puede ser un objeto vacío).');
  else for (const [id, a] of Object.entries(t.assets)) {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) err(`assets.${id}`, 'El id del archivo lleva solo minúsculas, números y guiones.');
    if (!isObj(a) || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(String(a.mime))) err(`assets.${id}.mime`, 'Solo se aceptan PNG, JPG o SVG.');
    if (!isObj(a) || typeof a.dataBase64 !== 'string' || !a.dataBase64) err(`assets.${id}.dataBase64`, 'El archivo está vacío.');
    else if (a.dataBase64.length * 0.75 > MAX_ASSET_BYTES) err(`assets.${id}.dataBase64`, 'El archivo pesa más de 1 MB. Reduce la imagen antes de subirla.');
  }
  if (!isObj(t.privacy)) err('privacy', 'Falta la sección de privacidad.');
  else for (const k of ['printDocument', 'printEps', 'printEmergency'] as const) if (typeof t.privacy[k] !== 'boolean') err(`privacy.${k}`, 'Indica sí o no.');
  return errors;
}

// ---------- textos a partir de la config ----------

const MONTHS = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/** "14 AL 16 DE NOVIEMBRE DE 2026" (o "30 DE OCTUBRE AL 2 DE NOVIEMBRE DE 2026"; un solo día: "14 DE NOVIEMBRE DE 2026"). */
export function eventDateLine(startDate: string, endDate: string): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endDate);
  if (!a) return '';
  const [, y1, m1, d1] = a;
  const day = (d: string) => String(Number(d));
  if (!b || startDate === endDate) return `${day(d1)} DE ${MONTHS[Number(m1) - 1]} DE ${y1}`;
  const [, y2, m2, d2] = b;
  if (y1 === y2 && m1 === m2) return `${day(d1)} AL ${day(d2)} DE ${MONTHS[Number(m1) - 1]} DE ${y1}`;
  if (y1 === y2) return `${day(d1)} DE ${MONTHS[Number(m1) - 1]} AL ${day(d2)} DE ${MONTHS[Number(m2) - 1]} DE ${y1}`;
  return `${day(d1)} DE ${MONTHS[Number(m1) - 1]} DE ${y1} AL ${day(d2)} DE ${MONTHS[Number(m2) - 1]} DE ${y2}`;
}

export interface BadgeTexts { badgeNumber: string; title: string; subtitle: string; year: string; city: string; dateLine: string }

/** Textos de cabecera efectivos: lo escrito en la plantilla o, si está vacío, lo calculado desde la config. */
export function badgeTextsFromConfig(template: BadgeTemplate, config: Pick<EventConfig, 'startDate' | 'endDate' | 'name'>): BadgeTexts {
  const h = template.header;
  return {
    badgeNumber: h.badgeNumber, title: h.title, subtitle: h.subtitle,
    year: h.year.trim() || config.startDate.slice(0, 4),
    city: h.city,
    dateLine: h.dateLine.trim() || eventDateLine(config.startDate, config.endDate)
  };
}

/** `TP-2026-00428-C` + prefijo `CNITF2026` → `CNITF2026-00428-C`. Sin prefijo (o ID no estándar) devuelve el ID tal cual. */
export function displayCredentialId(id: string, prefix: string | null | undefined): string {
  if (!prefix) return id;
  const p = parseCredentialId(id);
  if (!p) return id;
  return `${prefix}-${p.seqPadded}-${p.check}`;
}

/** Texto de la tarjeta "ACCESO": fijo si la plantilla lo define; si no, nombres de las zonas permitidas. */
export function accessText(template: BadgeTemplate, cred: Pick<Credential, 'zones'>, config: EventConfig): string {
  if (template.front.access.text.trim()) return template.front.access.text.trim();
  const allowed = resolveZones(cred.zones, config);
  if (allowed.length && allowed.length === config.zones.length) return 'Todas las zonas';
  const names = allowed.map((z) => config.zones.find((x) => x.code === z)?.name ?? z);
  return names.join(' · ');
}

export interface BadgeFieldValue { key: string; label: string; value: string; labelColor: string }

/** Resuelve los campos visibles del anverso con los datos de la credencial y la persona (ya filtrados por privacidad). */
export function resolveBadgeFields(template: BadgeTemplate, cred: Credential, person: BadgePersonData | undefined, config: EventConfig): BadgeFieldValue[] {
  const color = (c: string) => (c === 'primary' ? template.colors.primary : c === 'accent' ? template.colors.accent : c);
  const out: BadgeFieldValue[] = [];
  for (const f of template.front.fields) {
    if (!f.visible) continue;
    let value = '';
    switch (f.source) {
      case 'person.name': value = cred.displayName; break;
      case 'person.document': value = template.privacy.printDocument ? person?.documentNumber ?? '' : ''; break;
      case 'person.club': value = cred.club ?? ''; break;
      case 'person.delegation': value = person?.delegation ?? ''; break;
      case 'credential.category': value = config.ageCategories.find((c) => c.code === cred.categoryCode)?.name ?? cred.categoryCode ?? ''; break;
      case 'credential.role': value = config.roles.find((r) => r.code === cred.roleCode)?.name ?? cred.roleCode; break;
      case 'custom': value = f.customText ?? ''; break;
    }
    out.push({ key: f.key, label: f.label, value, labelColor: color(f.labelColor) });
  }
  return out;
}

/** Color e icono de la banda del rol. */
export function roleBandStyle(template: BadgeTemplate, roleCode: string, config: EventConfig): { color: string; icon: BadgeIcon; name: string } {
  const role = config.roles.find((r) => r.code === roleCode);
  const band = template.front.roleBand;
  const useDefault = !band.useRoleColor || band.defaultColorRoles.includes(roleCode) || !role?.color;
  return { color: useDefault ? template.colors.roleBandDefault : role!.color, icon: band.icons[roleCode] ?? band.icons['*'] ?? 'none', name: (role?.name ?? roleCode).toUpperCase() };
}

/** Aplica `privacy` a los datos de la persona: lo que no se imprime no llega al renderer. */
export function filterPersonForBadge(template: BadgeTemplate, person: Person | undefined): BadgePersonData | undefined {
  if (!person) return undefined;
  const p = template.privacy;
  return {
    documentNumber: p.printDocument ? person.documentNumber : undefined,
    delegation: person.delegation,
    emergencyContact: p.printEmergency ? person.emergencyContact : undefined,
    eps: p.printEps ? person.eps : undefined
  };
}
