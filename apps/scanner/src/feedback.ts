/**
 * Sonido + vibración distintos para OK / NO / ALERTA (§12).
 * Los patrones se renderizan una vez a AudioBuffer (ver lib/tones.ts) y se
 * reproducen al instante; no hay archivos externos que cachear.
 */
import { PATTERNS, VIBRATION, renderPattern, type FeedbackKind } from './lib/tones.js';

let ctx: AudioContext | undefined;
const buffers = new Map<FeedbackKind, AudioBuffer>();
const SAMPLE_RATE = 22050;

function audioContext(): AudioContext | undefined {
  try {
    const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return undefined;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return undefined;
  }
}

function bufferFor(kind: FeedbackKind, ac: AudioContext): AudioBuffer {
  let b = buffers.get(kind);
  if (!b) {
    const samples = renderPattern(PATTERNS[kind], SAMPLE_RATE);
    b = ac.createBuffer(1, samples.length, SAMPLE_RATE);
    b.copyToChannel(samples, 0);
    buffers.set(kind, b);
  }
  return b;
}

/** Llamar en el primer gesto del usuario (iOS exige interacción para desbloquear audio). */
export function primeAudio(): void {
  const ac = audioContext();
  if (!ac) return;
  for (const kind of Object.keys(PATTERNS) as FeedbackKind[]) bufferFor(kind, ac);
}

export function feedback(kind: FeedbackKind): void {
  try {
    const ac = audioContext();
    if (ac) {
      const src = ac.createBufferSource();
      src.buffer = bufferFor(kind, ac);
      src.connect(ac.destination);
      src.start();
    }
  } catch {
    /* sin audio */
  }
  try {
    navigator.vibrate?.(VIBRATION[kind]);
  } catch {
    /* sin vibración */
  }
}
