/**
 * "Archivos de audio" generados en memoria: cada patrón (OK / NO / ALERTA) se
 * renderiza una vez a muestras PCM (Float32Array) y luego se reproduce con un
 * AudioBuffer. Sin assets externos. Puro: se prueba en Node.
 */
/** `order` y `emergency` son los avisos de Tatami Radio (docs/34): orden recibida y emergencia. */
export type FeedbackKind = 'ok' | 'no' | 'alert' | 'order' | 'emergency';

export interface ToneSegment {
  /** Hz; 0 = silencio. */
  freq: number;
  /** Duración en ms. */
  ms: number;
  wave?: 'sine' | 'square' | 'saw';
  gain?: number;
}

/** Patrones distinguibles con los ojos cerrados (§12): subida corta, zumbido grave largo, triple pitido. */
export const PATTERNS: Record<FeedbackKind, ToneSegment[]> = {
  ok: [{ freq: 880, ms: 90 }, { freq: 1320, ms: 140 }],
  no: [{ freq: 220, ms: 220, wave: 'square', gain: 0.5 }, { freq: 0, ms: 60 }, { freq: 180, ms: 320, wave: 'square', gain: 0.5 }],
  alert: [{ freq: 660, ms: 110 }, { freq: 0, ms: 70 }, { freq: 660, ms: 110 }, { freq: 0, ms: 70 }, { freq: 880, ms: 160 }],
  // Radio: dos notas ascendentes tipo "mensaje" / sirena de dos tonos alternados, inconfundible.
  order: [{ freq: 740, ms: 120 }, { freq: 0, ms: 40 }, { freq: 988, ms: 180 }],
  emergency: [{ freq: 1200, ms: 180, wave: 'square', gain: 0.45 }, { freq: 800, ms: 180, wave: 'square', gain: 0.45 }, { freq: 1200, ms: 180, wave: 'square', gain: 0.45 }, { freq: 800, ms: 180, wave: 'square', gain: 0.45 }, { freq: 1200, ms: 260, wave: 'square', gain: 0.45 }]
};

export const VIBRATION: Record<FeedbackKind, number | number[]> = {
  ok: 80,
  no: [220, 90, 320],
  alert: [100, 60, 100, 60, 160],
  order: [120, 80, 120],
  emergency: [300, 100, 300, 100, 600]
};

export function patternDurationMs(segments: ToneSegment[]): number {
  return segments.reduce((a, s) => a + s.ms, 0);
}

/** Renderiza un patrón a PCM mono con envolvente corta (sin clics). */
export function renderPattern(segments: ToneSegment[], sampleRate = 22050): Float32Array<ArrayBuffer> {
  const total = Math.round((patternDurationMs(segments) / 1000) * sampleRate);
  const out = new Float32Array(new ArrayBuffer(total * 4));
  let offset = 0;
  for (const seg of segments) {
    const n = Math.round((seg.ms / 1000) * sampleRate);
    if (seg.freq > 0) {
      const gain = seg.gain ?? 0.35;
      const attack = Math.min(Math.round(sampleRate * 0.006), n / 2);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const phase = 2 * Math.PI * seg.freq * t;
        let v: number;
        if (seg.wave === 'square') v = Math.sign(Math.sin(phase)) * 0.6;
        else if (seg.wave === 'saw') v = 2 * ((seg.freq * t) % 1) - 1;
        else v = Math.sin(phase);
        const env = i < attack ? i / attack : i > n - attack ? (n - i) / attack : 1;
        out[offset + i] = v * gain * env;
      }
    }
    offset += n;
  }
  return out;
}

export function peak(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]));
  return p;
}
