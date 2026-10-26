/**
 * Ingreso manual (§4): ID corto con dígito verificador validado en el cliente
 * y motivo del catálogo + texto.
 */
import { describe, expect, it } from 'vitest';
import { formatCredentialId } from '@tatami/core';
import { checkManualId, checkReason, EXCEPTION_REASONS, MANUAL_ENTRY_REASONS } from '../src/lib/manual.js';

describe('ID corto en el cliente', () => {
  const valid = formatCredentialId('TP-2026', 123); // TP-2026-00123-C
  it('acepta el ID correcto en cualquier formato humano', () => {
    for (const raw of [valid, valid.toLowerCase(), 'tp 2026 00123 c', 'TP202600123C', ' tp-2026-00123-c ']) {
      const r = checkManualId(raw);
      expect(r.ok, raw).toBe(true);
      if (r.ok) { expect(r.id).toBe('TP-2026-00123-C'); expect(r.seq).toBe(123); }
    }
  });
  it('detecta un dígito mal escrito por el verificador', () => {
    const r = checkManualId('TP-2026-00124-C');
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.state).toBe('check'); expect(r.error).toContain('no coincide'); }
    const t = checkManualId('TP-2026-01023-C'); // transposición
    expect(t.ok).toBe(false);
  });
  it('distingue "aún falta" de "no es un ID"', () => {
    expect(checkManualId('').ok).toBe(false);
    const inc = checkManualId('TP-2026-001');
    expect(!inc.ok && inc.state).toBe('incomplete');
    const fmt = checkManualId('hola mundo 123');
    expect(!fmt.ok && fmt.state).toBe('format');
    const fmt2 = checkManualId('TPX2026-00123-C');
    expect(!fmt2.ok && fmt2.state).toBe('format');
  });
});

describe('motivo: catálogo + texto', () => {
  it('exige elegir una opción', () => {
    expect(checkReason(undefined, MANUAL_ENTRY_REASONS).ok).toBe(false);
    expect(checkReason({ code: 'NOPE', text: '' }, MANUAL_ENTRY_REASONS).ok).toBe(false);
  });
  it('las opciones normales no necesitan texto; "Otro" sí (≥ 5 caracteres)', () => {
    const r = checkReason({ code: 'QR_UNREADABLE', text: '' }, MANUAL_ENTRY_REASONS);
    expect(r).toEqual({ ok: true, reason: 'QR no se lee', reasonCode: 'QR_UNREADABLE' });
    const withText = checkReason({ code: 'QR_UNREADABLE', text: ' rayado ' }, MANUAL_ENTRY_REASONS);
    expect(withText.ok && withText.reason).toBe('QR no se lee: rayado');
    expect(checkReason({ code: 'OTHER', text: 'abc' }, MANUAL_ENTRY_REASONS).ok).toBe(false);
    const other = checkReason({ code: 'OTHER', text: 'documento verificado' }, EXCEPTION_REASONS);
    expect(other).toEqual({ ok: true, reason: 'Otro: documento verificado', reasonCode: 'OTHER' });
  });
  it('los catálogos son los del manual por rol', () => {
    expect(MANUAL_ENTRY_REASONS.map((r) => r.label)).toEqual(['QR no se lee', 'Credencial provisional', 'Autorizado por supervisor', 'Planilla (modo degradado)', 'Otro']);
    expect(EXCEPTION_REASONS.map((r) => r.label)).toEqual(['Salió sin escanear', 'Error de puerta', 'Autorización del Coordinador', 'Otro']);
  });
});
