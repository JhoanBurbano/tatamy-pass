/**
 * Lee una orden en voz alta con `speechSynthesis` (voz es-CO si existe, si no
 * cualquier español). Si el navegador no tiene voces, no pasa nada: queda el tono.
 */
export function pickSpanishVoice(voices: Array<{ lang: string; name?: string }>): { lang: string } | undefined {
  const norm = (l: string) => l.toLowerCase().replace('_', '-');
  return voices.find((v) => norm(v.lang) === 'es-co') ?? voices.find((v) => norm(v.lang).startsWith('es-')) ?? voices.find((v) => norm(v.lang) === 'es');
}

export function speak(text: string): void {
  try {
    const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    const Utter = (globalThis as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance;
    if (!synth || !Utter) return;
    const u = new Utter(text);
    u.lang = 'es-CO';
    u.rate = 0.95;
    const voice = pickSpanishVoice(synth.getVoices());
    if (voice) u.voice = voice as SpeechSynthesisVoice;
    synth.cancel();
    synth.speak(u);
  } catch {
    /* sin voz */
  }
}
