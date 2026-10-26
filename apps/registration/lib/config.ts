import { readFileSync, existsSync } from 'node:fs';
import { createDefaultConfig, type EventConfig } from '@tatami/core';
import type { Repos } from './repo';
import type { EventSettings, FormSettings } from './repo/types';

let base: EventConfig | undefined;

/**
 * Config base del evento: `EVENT_CONFIG_JSON` (Vercel) → `EVENT_CONFIG_PATH` /
 * `../host/event.config.json` (dev) → valores por defecto del core.
 * Sobre esa base el panel guarda sus cambios en la tabla `event_settings` (ver `eventConfig`).
 */
export function baseEventConfig(): EventConfig {
  if (base) return base;
  if (process.env.EVENT_CONFIG_JSON) {
    base = { ...createDefaultConfig(), ...(JSON.parse(process.env.EVENT_CONFIG_JSON) as Partial<EventConfig>) };
    return base;
  }
  const path = process.env.EVENT_CONFIG_PATH ?? '../host/event.config.json';
  base = existsSync(path) ? { ...createDefaultConfig(), ...(JSON.parse(readFileSync(path, 'utf8')) as Partial<EventConfig>) } : createDefaultConfig();
  return base;
}

export interface LoadedEvent {
  config: EventConfig;
  form: FormSettings;
  /** Estado de la ventana de inscripciones ahora mismo. */
  window: { open: boolean; reason?: string };
}

export function applySettings(baseConfig: EventConfig, settings: EventSettings): EventConfig {
  const c = settings.config;
  const config: EventConfig = { ...baseConfig };
  if (c.name) config.name = c.name;
  if (c.startDate) config.startDate = c.startDate;
  if (c.endDate) config.endDate = c.endDate;
  if (c.companions) config.companions = { ...config.companions, ...c.companions };
  if (c.totalCapacity !== undefined) config.totalCapacity = c.totalCapacity;
  if (c.roles) config.roles = config.roles.map((r) => { const o = c.roles!.find((x) => x.code === r.code); return o ? { ...r, ...o } : r; });
  if (c.ageCategories) {
    // categorías del panel reemplazan la lista (permite agregar/quitar)
    config.ageCategories = c.ageCategories.map((x) => ({ ...x }));
  }
  return config;
}

export function registrationWindow(form: FormSettings, now = new Date()): LoadedEvent['window'] {
  const t = now.getTime();
  if (form.opensAt && t < new Date(form.opensAt).getTime()) return { open: false, reason: `Las inscripciones abren el ${fmtDate(form.opensAt)}.` };
  if (form.closesAt && t > new Date(form.closesAt).getTime()) return { open: false, reason: `Las inscripciones cerraron el ${fmtDate(form.closesAt)}. Si necesitas inscribir a alguien, escribe al coordinador.` };
  return { open: true };
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' }); } catch { return iso; }
}

/** Config efectiva del evento = base + ajustes guardados desde el panel. */
export async function eventConfig(repos: Repos): Promise<LoadedEvent> {
  const settings = await repos.settings.eventSettings();
  return { config: applySettings(baseEventConfig(), settings), form: settings.form, window: registrationWindow(settings.form) };
}
