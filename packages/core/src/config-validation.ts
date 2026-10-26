/**
 * Validación de `event.config.json` antes de guardarlo desde el panel (§5 de 00-DECISIONES).
 * Puro: devuelve una lista de errores en español humano; vacía = config válida.
 * No normaliza ni corrige: el panel muestra los errores y el admin decide.
 */
import type { EventConfig } from './types.js';

export interface ConfigError {
  /** Ruta tipo `roles[2].capacity` para que el panel marque el campo. */
  path: string;
  message: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,11}$/;

function isNullableCount(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0);
}

/** Devuelve los problemas encontrados. Lista vacía = válida. */
export function validateEventConfig(input: unknown): ConfigError[] {
  const errors: ConfigError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  if (!input || typeof input !== 'object') return [{ path: '', message: 'La configuración debe ser un objeto.' }];
  const c = input as Partial<EventConfig>;

  if (!c.eventId || !/^[a-z0-9_-]+$/i.test(c.eventId)) err('eventId', 'El id del evento solo admite letras, números, guion y guion bajo.');
  if (!c.name?.trim()) err('name', 'El evento necesita un nombre.');
  if (!c.idPrefix || !/^[A-Z0-9-]+$/.test(c.idPrefix)) err('idPrefix', 'El prefijo de IDs solo admite mayúsculas, números y guiones (p. ej. TP-2026).');
  if (!c.startDate || !ISO_DATE.test(c.startDate)) err('startDate', 'La fecha de inicio debe tener formato AAAA-MM-DD.');
  if (!c.endDate || !ISO_DATE.test(c.endDate)) err('endDate', 'La fecha de fin debe tener formato AAAA-MM-DD.');
  if (c.startDate && c.endDate && ISO_DATE.test(c.startDate) && ISO_DATE.test(c.endDate) && c.endDate < c.startDate) {
    err('endDate', 'La fecha de fin no puede ser anterior a la de inicio.');
  }
  if (typeof c.utcOffsetMinutes !== 'number' || !Number.isInteger(c.utcOffsetMinutes) || Math.abs(c.utcOffsetMinutes) > 14 * 60) {
    err('utcOffsetMinutes', 'El desfase horario debe ser un número entero de minutos (Colombia = -300).');
  }

  // zonas
  const zoneCodes = new Set<string>();
  if (!Array.isArray(c.zones) || c.zones.length === 0) err('zones', 'Define al menos una zona.');
  else c.zones.forEach((z, i) => {
    if (!z || typeof z !== 'object') return err(`zones[${i}]`, 'Zona inválida.');
    if (!z.code || !CODE.test(z.code)) err(`zones[${i}].code`, 'El código de zona va en mayúsculas, sin espacios (p. ej. T).');
    else if (zoneCodes.has(z.code)) err(`zones[${i}].code`, `La zona ${z.code} está repetida.`);
    else zoneCodes.add(z.code);
    if (!z.name?.trim()) err(`zones[${i}].name`, 'La zona necesita un nombre.');
    if (typeof z.tracksExit !== 'boolean') err(`zones[${i}].tracksExit`, 'Indica si la zona controla salida (sí/no).');
  });

  // roles
  const roleCodes = new Set<string>();
  if (!Array.isArray(c.roles) || c.roles.length === 0) err('roles', 'Define al menos un rol de acceso.');
  else c.roles.forEach((r, i) => {
    if (!r || typeof r !== 'object') return err(`roles[${i}]`, 'Rol inválido.');
    if (!r.code || !CODE.test(r.code)) err(`roles[${i}].code`, 'El código del rol va en mayúsculas, sin espacios (p. ej. COMP).');
    else if (roleCodes.has(r.code)) err(`roles[${i}].code`, `El rol ${r.code} está repetido.`);
    else roleCodes.add(r.code);
    if (!r.name?.trim()) err(`roles[${i}].name`, 'El rol necesita un nombre.');
    if (!Array.isArray(r.zones) || r.zones.length === 0) err(`roles[${i}].zones`, 'El rol necesita al menos una zona (o * para todas).');
    else r.zones.forEach((z) => { if (z !== '*' && !zoneCodes.has(z)) err(`roles[${i}].zones`, `La zona ${z} no existe.`); });
    if (Array.isArray(r.antiPassbackZones)) r.antiPassbackZones.forEach((z) => { if (z !== '*' && !zoneCodes.has(z)) err(`roles[${i}].antiPassbackZones`, `La zona ${z} no existe.`); });
    else err(`roles[${i}].antiPassbackZones`, 'Las zonas con anti-passback deben ser una lista (puede estar vacía).');
    if (!isNullableCount(r.capacity)) err(`roles[${i}].capacity`, 'El cupo debe ser un número entero o "sin límite".');
    if (r.days !== null && (!Array.isArray(r.days) || r.days.some((d) => !ISO_DATE.test(d)))) err(`roles[${i}].days`, 'Los días válidos deben ser fechas AAAA-MM-DD o "todos los días".');
    if (Array.isArray(r.days) && c.startDate && c.endDate) {
      r.days.forEach((d) => { if (d < c.startDate! || d > c.endDate!) err(`roles[${i}].days`, `El día ${d} está fuera del evento.`); });
    }
    if (!r.color || !HEX_COLOR.test(r.color)) err(`roles[${i}].color`, 'El color debe ser hexadecimal de 6 dígitos (p. ej. #1C4FD1).');
    if (typeof r.requiresPhoto !== 'boolean') err(`roles[${i}].requiresPhoto`, 'Indica si el rol requiere foto.');
    if (typeof r.allowsDigital !== 'boolean') err(`roles[${i}].allowsDigital`, 'Indica si el rol admite credencial digital.');
  });

  // categorías de edad
  const catCodes = new Set<string>();
  if (!Array.isArray(c.ageCategories)) err('ageCategories', 'Las categorías de edad deben ser una lista.');
  else {
    c.ageCategories.forEach((cat, i) => {
      if (!cat || typeof cat !== 'object') return err(`ageCategories[${i}]`, 'Categoría inválida.');
      if (!cat.code || !CODE.test(cat.code)) err(`ageCategories[${i}].code`, 'El código de la categoría va en mayúsculas, sin espacios.');
      else if (catCodes.has(cat.code)) err(`ageCategories[${i}].code`, `La categoría ${cat.code} está repetida.`);
      else catCodes.add(cat.code);
      if (!cat.name?.trim()) err(`ageCategories[${i}].name`, 'La categoría necesita un nombre.');
      if (typeof cat.minAge !== 'number' || !Number.isInteger(cat.minAge) || cat.minAge < 0) err(`ageCategories[${i}].minAge`, 'La edad mínima debe ser un entero ≥ 0.');
      if (cat.maxAge !== null && (typeof cat.maxAge !== 'number' || !Number.isInteger(cat.maxAge) || cat.maxAge < (cat.minAge ?? 0))) err(`ageCategories[${i}].maxAge`, 'La edad máxima debe ser un entero mayor o igual a la mínima, o "sin límite".');
      if (!isNullableCount(cat.capacity)) err(`ageCategories[${i}].capacity`, 'El cupo debe ser un número entero o "sin límite".');
    });
    const sorted = [...c.ageCategories].filter((x) => x && Number.isInteger(x.minAge)).sort((a, b) => a.minAge - b.minAge);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      if (prev.maxAge !== null && typeof prev.maxAge === 'number' && sorted[i].minAge <= prev.maxAge) {
        err('ageCategories', `Las categorías ${prev.code} y ${sorted[i].code} se solapan en edad.`);
        break;
      }
    }
  }

  // acompañantes y aforo
  if (!c.companions || typeof c.companions !== 'object') err('companions', 'Faltan los límites de acompañantes.');
  else {
    if (!isNullableCount(c.companions.perParticipant)) err('companions.perParticipant', 'Acompañantes por participante: entero o "sin límite".');
    if (!isNullableCount(c.companions.total)) err('companions.total', 'Total de acompañantes: entero o "sin límite".');
  }
  if (!isNullableCount(c.totalCapacity)) err('totalCapacity', 'El aforo total debe ser un entero o "sin límite".');

  for (const [k, label] of [['duplicateWindowSeconds', 'ventana de duplicado'], ['digitalTokenWindowSeconds', 'vida del código digital'], ['clockToleranceSeconds', 'tolerancia de reloj']] as const) {
    const v = c[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) err(k, `La ${label} debe ser un entero de segundos ≥ 0.`);
  }

  // radio (opcional)
  if (c.radio !== undefined) {
    const r = c.radio;
    if (!r || typeof r !== 'object') err('radio', 'La configuración de radio debe ser un objeto con canales y órdenes.');
    else {
      const ids = new Set<string>();
      let emergencies = 0;
      if (!Array.isArray(r.channels) || r.channels.length === 0) err('radio.channels', 'Define al menos un canal de radio.');
      else r.channels.forEach((ch, i) => {
        if (!ch || typeof ch !== 'object') return err(`radio.channels[${i}]`, 'Canal inválido.');
        if (!ch.id || !/^[a-z][a-z0-9_-]{0,23}$/.test(ch.id)) err(`radio.channels[${i}].id`, 'El id del canal va en minúsculas, sin espacios (p. ej. puertas).');
        else if (ids.has(ch.id)) err(`radio.channels[${i}].id`, `El canal ${ch.id} está repetido.`);
        else ids.add(ch.id);
        if (!ch.name?.trim()) err(`radio.channels[${i}].name`, 'El canal necesita un nombre.');
        if (!ch.color || !HEX_COLOR.test(ch.color)) err(`radio.channels[${i}].color`, 'El color del canal debe ser hexadecimal de 6 dígitos.');
        if (!Array.isArray(ch.talk) || ch.talk.length === 0) err(`radio.channels[${i}].talk`, 'Indica qué roles pueden hablar (o * para todos).');
        if (!Array.isArray(ch.listen) || ch.listen.length === 0) err(`radio.channels[${i}].listen`, 'Indica qué roles pueden escuchar (o * para todos).');
        if (typeof ch.priority !== 'number' || !Number.isInteger(ch.priority) || ch.priority < 0) err(`radio.channels[${i}].priority`, 'La prioridad del canal debe ser un entero ≥ 0.');
        if (ch.emergency) emergencies++;
      });
      if (Array.isArray(r.channels) && r.channels.length && emergencies !== 1) err('radio.channels', 'Debe haber exactamente un canal de emergencia.');
      const codes = new Set<string>();
      if (!Array.isArray(r.orders)) err('radio.orders', 'Las órdenes deben ser una lista (puede estar vacía).');
      else r.orders.forEach((o, i) => {
        if (!o || typeof o !== 'object') return err(`radio.orders[${i}]`, 'Orden inválida.');
        if (!o.code || !/^[A-Z][A-Z0-9_]{0,23}$/.test(o.code)) err(`radio.orders[${i}].code`, 'El código de la orden va en mayúsculas, sin espacios (p. ej. OPEN_GATE).');
        else if (codes.has(o.code)) err(`radio.orders[${i}].code`, `La orden ${o.code} está repetida.`);
        else codes.add(o.code);
        if (!o.label?.trim()) err(`radio.orders[${i}].label`, 'La orden necesita un texto.');
        if (o.requiresGate && !/\{n\}/.test(o.label ?? '')) err(`radio.orders[${i}].label`, 'Una orden con puerta debe llevar {n} en el texto.');
      });
      if (typeof r.maxPerChannel !== 'number' || !Number.isInteger(r.maxPerChannel) || r.maxPerChannel < 2 || r.maxPerChannel > 30) err('radio.maxPerChannel', 'El máximo por canal debe ser un entero entre 2 y 30 (la malla P2P no aguanta más).');
    }
  }
  return errors;
}

/** Cupos que quedan por debajo de lo ya emitido (aviso, no error: no anula credenciales). */
export function capacityWarnings(config: EventConfig, issuedByRole: Record<string, number>): string[] {
  const out: string[] = [];
  for (const r of config.roles) {
    const issued = issuedByRole[r.code] ?? 0;
    if (r.capacity !== null && issued > r.capacity) {
      out.push(`Ya hay ${issued} credenciales emitidas para ${r.name}. Bajar el cupo a ${r.capacity} no anula ninguna; solo bloquea nuevas emisiones.`);
    }
  }
  return out;
}
