import { describe, expect, it } from 'vitest';
import { code128BValues, code128Bars, code128Checksum, encodeCode128B } from '../src/code128.js';

describe('Code 128 B', () => {
  it('calcula el símbolo de verificación del ejemplo clásico PJJ123C (55)', () => {
    const values = code128BValues('PJJ123C');
    expect(values).toEqual([48, 42, 42, 17, 18, 19, 35]);
    expect(code128Checksum(104, values)).toBe(55);
    const code = encodeCode128B('PJJ123C');
    expect(code.check).toBe(55);
    expect(code.symbols[0]).toBe(104);
    expect(code.symbols.at(-1)).toBe(106);
  });

  it('la estructura es START + datos + check + STOP con 11 módulos por símbolo y 13 el STOP', () => {
    const text = 'TP-2026-00428-C';
    const code = encodeCode128B(text);
    expect(code.symbols).toHaveLength(text.length + 3);
    expect(code.modules).toBe(11 * (text.length + 2) + 13);
    // empieza y termina con barra (número impar de anchos)
    expect(code.widths.length % 2).toBe(1);
    const bars = code128Bars(code);
    expect(bars[0]).toEqual({ x: 0, w: 2 });
    expect(bars.at(-1)!.x + bars.at(-1)!.w).toBe(code.modules);
    expect(bars).toHaveLength((code.widths.length + 1) / 2);
  });

  it('rechaza texto vacío y caracteres fuera de ASCII imprimible', () => {
    expect(() => encodeCode128B('')).toThrow(/No hay texto/);
    expect(() => encodeCode128B('Ñ')).toThrow(/no admite/);
    expect(() => encodeCode128B('a\nb')).toThrow(/no admite/);
  });
});
