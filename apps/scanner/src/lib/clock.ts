/**
 * Deriva de reloj entre el dispositivo y el host. El contrato tolera ±5 min
 * en QR rotativos (§8); por encima de eso se avisa al operador.
 */
export const MAX_SKEW_MS = 5 * 60_000;

/** Desfase estimado (host − dispositivo) compensando la mitad del viaje de red. */
export function estimateSkewMs(serverTimeIso: string, sentAtMs: number, receivedAtMs: number): number {
  const server = Date.parse(serverTimeIso);
  if (Number.isNaN(server)) return 0;
  const midpoint = sentAtMs + (receivedAtMs - sentAtMs) / 2;
  return Math.round(server - midpoint);
}

export function clockOutOfSync(skewMs: number | undefined, maxMs = MAX_SKEW_MS): boolean {
  return skewMs !== undefined && Math.abs(skewMs) > maxMs;
}

export function describeSkew(skewMs: number): string {
  const minutes = Math.round(Math.abs(skewMs) / 60_000);
  const dir = skewMs > 0 ? 'atrasado' : 'adelantado';
  return `Reloj del dispositivo ${dir} ${minutes} min respecto al host`;
}
