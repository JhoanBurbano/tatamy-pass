/**
 * Modos de la puerta (§3) y bloqueo anti-doble-lectura de 2 s (§1).
 */
import { describe, expect, it } from 'vitest';
import { directionFor, modeLabel, needsDirectionPrompt, normalizeMode } from '../src/lib/mode.js';
import { createDedupe } from '../src/lib/camera-select.js';
import { DOUBLE_READ_MS } from '../src/screens/Scan.js';

describe('modos de la puerta', () => {
  it('Entrada y Salida fijan la dirección aunque se pida otra', () => {
    expect(directionFor('IN')).toBe('IN');
    expect(directionFor('IN', 'OUT')).toBe('IN');
    expect(directionFor('OUT')).toBe('OUT');
    expect(directionFor('OUT', 'IN')).toBe('OUT');
  });
  it('Entrada + Salida pregunta: sin elección no hay dirección', () => {
    expect(needsDirectionPrompt('BOTH')).toBe(true);
    expect(needsDirectionPrompt('IN')).toBe(false);
    expect(directionFor('BOTH')).toBeUndefined();
    expect(directionFor('BOTH', 'OUT')).toBe('OUT');
  });
  it('dispositivos enrolados antes de tener modo quedan en Entrada', () => {
    expect(normalizeMode(undefined)).toBe('IN');
    expect(normalizeMode('cualquiera')).toBe('IN');
    expect(normalizeMode('BOTH')).toBe('BOTH');
    expect(modeLabel('BOTH')).toBe('Entrada + Salida');
    expect(modeLabel(undefined)).toBe('Entrada');
  });
});

describe('anti-doble-lectura', () => {
  it('la ventana del scanner es de 2 s', () => {
    expect(DOUBLE_READ_MS).toBe(2000);
  });
  it('el mismo token no se procesa dos veces en 2 s, otro token sí', () => {
    const d = createDedupe(DOUBLE_READ_MS);
    expect(d.accept('TP1.x.y', 10_000)).toBe(true);
    expect(d.accept('TP1.x.y', 11_999)).toBe(false);
    expect(d.accept('TP1.x.y', 12_000)).toBe(true);
    expect(d.accept('TP1.z.w', 12_100)).toBe(true);
  });
});
