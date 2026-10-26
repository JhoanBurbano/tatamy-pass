/**
 * Codificador Code 128 (subconjunto B) sin dependencias. Devuelve la secuencia de
 * anchos de barras y espacios (en módulos) para que el renderer dibuje el código
 * del ID corto en el reverso de la credencial. Solo acepta ASCII imprimible
 * (32–126): es lo que lleva un ID como `TP-2026-00428-C`.
 */

/** Patrones de los 107 símbolos (anchos barra/espacio alternados, 11 módulos; STOP = 13). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

const START_B = 104;
const STOP = 106;

export interface Code128 {
  /** Valores de símbolo (START B, datos, verificación, STOP). */
  symbols: number[];
  /** Anchos alternados barra, espacio, barra… en módulos; empieza con barra. */
  widths: number[];
  /** Módulos totales (sin zonas de silencio). */
  modules: number;
  /** Símbolo de verificación (mod 103). */
  check: number;
}

/** Valores Code 128 B del texto; lanza si hay un carácter fuera de ASCII 32–126. */
export function code128BValues(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Code 128 B no admite el carácter "${ch}". Usa solo letras, números y signos básicos.`);
    out.push(c - 32);
  }
  return out;
}

/** Símbolo de verificación: (START + Σ posición·valor) mod 103. */
export function code128Checksum(start: number, values: number[]): number {
  let sum = start;
  values.forEach((v, i) => { sum += v * (i + 1); });
  return sum % 103;
}

/** Codifica `text` en Code 128 B. Texto vacío → error. */
export function encodeCode128B(text: string): Code128 {
  if (!text) throw new Error('No hay texto para el código de barras.');
  const values = code128BValues(text);
  const check = code128Checksum(START_B, values);
  const symbols = [START_B, ...values, check, STOP];
  const widths: number[] = [];
  for (const s of symbols) for (const w of PATTERNS[s]) widths.push(Number(w));
  return { symbols, widths, modules: widths.reduce((a, b) => a + b, 0), check };
}

/**
 * Convierte el código en rectángulos listos para dibujar: `x` y `w` en módulos
 * desde el borde izquierdo (sin zona de silencio). Solo barras (los espacios se omiten).
 */
export function code128Bars(code: Code128): { x: number; w: number }[] {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  code.widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return bars;
}
