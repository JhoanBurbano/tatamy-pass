import { describe, expect, it } from 'vitest';
import { PATTERNS, VIBRATION, patternDurationMs, peak, renderPattern } from '../src/lib/tones.js';

describe('patrones de audio generados', () => {
  it('OK, NO, ALERTA, ORDEN y EMERGENCIA tienen duración y patrón distintos', () => {
    const durations = Object.values(PATTERNS).map(patternDurationMs);
    expect(new Set(durations).size).toBe(5);
    expect(PATTERNS.alert.filter((s) => s.freq > 0).length).toBe(3);
    expect(PATTERNS.no[0].freq).toBeLessThan(PATTERNS.ok[0].freq);
    expect(new Set(Object.values(VIBRATION).map((v) => JSON.stringify(v))).size).toBe(5);
  });

  it('renderiza PCM con el número de muestras esperado y sin saturar', () => {
    for (const kind of ['ok', 'no', 'alert'] as const) {
      const pcm = renderPattern(PATTERNS[kind], 22050);
      expect(pcm.length).toBe(Math.round((patternDurationMs(PATTERNS[kind]) / 1000) * 22050));
      const p = peak(pcm);
      expect(p).toBeGreaterThan(0.2);
      expect(p).toBeLessThanOrEqual(1);
      // empieza y termina en silencio (envolvente sin clics)
      expect(Math.abs(pcm[0])).toBeLessThan(0.01);
      expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(0.05);
    }
  });

  it('los silencios del patrón son ceros', () => {
    const pcm = renderPattern([{ freq: 440, ms: 10 }, { freq: 0, ms: 10 }, { freq: 440, ms: 10 }], 1000);
    expect(pcm.length).toBe(30);
    expect(Array.from(pcm.slice(10, 20)).every((v) => v === 0)).toBe(true);
  });
});
