/**
 * PIN de supervisor sin host (§3 y §4 del encargo). Puro.
 *
 * Fuentes aceptadas, en orden:
 * 1. El dispositivo está enrolado con rol `SUPERVISOR`: su propio PIN autoriza.
 * 2. El snapshot trae PIN de supervisores: `config.supervisorPins`
 *    (`[{ username, pinHash }]`, con `pinHash = sha256("tatami:" + pin)`), o
 *    `config.supervisorPinHash` (uno solo). Son campos opcionales que el host
 *    puede añadir sin tocar la API; si no vienen, no hay PIN local.
 * 3. Si nada de lo anterior aplica, la pantalla ofrece validar con el host
 *    (`POST /auth/login`, ver `sync.ts`).
 *
 * El hash es el mismo que usa el PIN del dispositivo (`sha256Hex("tatami:"+pin)`).
 */
import { sha256Hex, type EventConfig } from '@tatami/core';

export interface SupervisorPinSource {
  username: string;
  pinHash: string;
}

export interface SupervisorConfigExtras {
  supervisorPins?: SupervisorPinSource[];
  supervisorPinHash?: string;
}

export interface LocalSupervisorInput {
  device: { name: string; role: 'CONTROL' | 'SUPERVISOR'; pinHash: string };
  config?: (EventConfig & SupervisorConfigExtras) | undefined;
}

export type SupervisorCheck =
  | { ok: true; by: string; method: 'device' | 'snapshot' }
  | { ok: false; error: string; /** no hay ningún PIN local configurado */ none: boolean };

export function hashPin(pin: string): string {
  return sha256Hex(`tatami:${pin}`);
}

/** PIN de supervisor disponibles localmente. */
export function localSupervisorSources(input: LocalSupervisorInput): SupervisorPinSource[] {
  const out: SupervisorPinSource[] = [];
  if (input.device.role === 'SUPERVISOR') out.push({ username: input.device.name, pinHash: input.device.pinHash });
  const c = input.config;
  if (c?.supervisorPins && Array.isArray(c.supervisorPins)) {
    for (const p of c.supervisorPins) if (p && typeof p.username === 'string' && typeof p.pinHash === 'string') out.push(p);
  }
  if (typeof c?.supervisorPinHash === 'string' && c.supervisorPinHash) out.push({ username: 'supervisor', pinHash: c.supervisorPinHash });
  return out;
}

export function hasLocalSupervisorPin(input: LocalSupervisorInput): boolean {
  return localSupervisorSources(input).length > 0;
}

/** Comprueba un PIN de 6 dígitos contra las fuentes locales. */
export function verifySupervisorPinLocal(pin: string, input: LocalSupervisorInput): SupervisorCheck {
  if (!/^\d{6}$/.test(pin)) return { ok: false, error: 'El PIN de supervisor tiene 6 dígitos.', none: false };
  const sources = localSupervisorSources(input);
  if (sources.length === 0) {
    return { ok: false, none: true, error: 'Este dispositivo no tiene PIN de supervisor guardado. Valida con el host (usuario y contraseña de supervisor).' };
  }
  const h = hashPin(pin);
  const hit = sources.find((s) => s.pinHash === h);
  if (!hit) return { ok: false, none: false, error: 'PIN de supervisor incorrecto.' };
  const method = input.device.role === 'SUPERVISOR' && hit.pinHash === input.device.pinHash ? 'device' : 'snapshot';
  return { ok: true, by: hit.username, method };
}
