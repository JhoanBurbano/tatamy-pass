/**
 * Búsqueda local de credenciales cuando el QR no se puede leer: por ID corto
 * (tolerante a errores de tipeo) o por nombre (sin tildes, por palabras).
 */
import type { Credential } from '@tatami/core';

export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** `TP-2026-00123-C`, `00123`, `123` → 123; `null` si no parece un ID. */
export function seqFromQuery(q: string): number | null {
  const compact = q.toUpperCase().replace(/[\s\-_.]/g, '');
  const m = /^(?:[A-Z]{2}\d{4})?(\d{1,5})[0-9A-Z]?$/.exec(compact);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function searchCredentials(all: Credential[], query: string, limit = 8): Credential[] {
  const q = fold(query);
  if (!q) return [];
  const seq = seqFromQuery(query);
  const words = q.split(/\s+/).filter(Boolean);
  const scored: { c: Credential; s: number }[] = [];
  for (const c of all) {
    let s = 0;
    if (seq !== null) {
      if (c.seq === seq) s += 100;
      else if (String(c.seq).padStart(5, '0').startsWith(String(seq).padStart(1, '0')) && query.replace(/\D/g, '').length >= 3) s += 10;
    }
    const name = fold(c.displayName);
    const club = fold(c.club ?? '');
    if (words.length && words.every((w) => name.includes(w))) s += 50 + (name.startsWith(words[0]) ? 10 : 0);
    else if (words.length > 1 && words.filter((w) => name.includes(w)).length >= Math.ceil(words.length / 2)) s += 20;
    else if (words.length && words.every((w) => club.includes(w))) s += 5;
    if (s > 0) scored.push({ c, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.c.displayName.localeCompare(b.c.displayName)).slice(0, limit).map((x) => x.c);
}

export function initials(displayName: string): string {
  return displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}
