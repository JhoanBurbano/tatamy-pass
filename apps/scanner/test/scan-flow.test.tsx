// @vitest-environment jsdom
/**
 * Flujo Escanear → Resultado con Testing Library (jsdom no tiene cámara: se
 * usa la vía manual con ID corto, que pasa por el mismo motor que la cámara).
 * Cubre: verde con nombre grande/rol/zona/hora y cierre automático a los 3 s,
 * rojo que no se cierra solo, excepción con PIN de supervisor, y modo
 * Entrada + Salida que pregunta la dirección.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultConfig, formatCredentialId, generateKeyPair, type Credential } from '@tatami/core';
import { pendingScans, replaceSnapshot, resetDevice, setSetting, type DeviceSettings } from '../src/db.js';
import { hashPin } from '../src/lib/supervisor.js';
import { Scan } from '../src/screens/Scan.js';

const key = generateKeyPair('kui');
const config = { ...createDefaultConfig(), signingKeys: [{ kid: key.kid, publicKeyHex: key.publicKeyHex }] };
const EVENT_NOW = Date.parse('2026-11-20T14:30:00.000Z');
const base: DeviceSettings = { hostUrl: 'http://host.test', deviceId: 'dev_ui', deviceToken: 'tok', name: 'P4-TATAMI', zone: 'T', mode: 'IN', role: 'SUPERVISOR', pinHash: hashPin('246810'), enrolledAt: '' };
const juan: Credential = {
  id: formatCredentialId(config.idPrefix, 123), seq: 123, eventId: config.eventId, personId: 'p123', displayName: 'Juan Pérez', club: 'Academia Caucana', roleCode: 'COMP',
  zones: ['G', 'W', 'T', 'P'], validFrom: config.startDate, validTo: config.endDate, version: 1, status: 'DELIVERED', kid: key.kid, issuedAt: '', updatedAt: ''
};

beforeEach(async () => {
  await resetDevice();
  await setSetting('device', base);
  await replaceSnapshot({ config, credentials: [juan], revocations: [], serverTime: new Date(EVENT_NOW).toISOString() });
  await setSetting('clockSkewMs', EVENT_NOW - Date.now());
});
afterEach(() => cleanup());

async function typeIdAndValidate(id: string) {
  fireEvent.click(screen.getByTestId('open-manual'));
  fireEvent.change(screen.getByTestId('manual-input'), { target: { value: id } });
  expect(screen.getByTestId('id-check')).toHaveAttribute('data-state', 'ok');
  await waitFor(() => expect(screen.getByTestId('manual-person')).toBeTruthy());
  fireEvent.click(screen.getByTestId('validate-selected'));
  await waitFor(() => expect(screen.getByTestId('result')).toBeTruthy());
}

describe('Escanear → Resultado', () => {
  it('verde: nombre grande, rol con color, club, zona y hora; "Siguiente" se cierra solo a los 3 s', async () => {
    const onScanned = vi.fn();
    render(<Scan device={base} config={config} operator="Ana" onScanned={onScanned} />);
    expect(screen.getByTestId('scan-screen')).toHaveAttribute('data-mode', 'IN');
    expect(screen.getByTestId('mode-banner').textContent).toContain('Entrada');

    await typeIdAndValidate('tp 2026 00123 c');
    const result = screen.getByTestId('result');
    expect(result).toHaveAttribute('data-decision', 'ALLOW');
    expect(screen.getByTestId('result-title').textContent).toBe('Adelante, Juan');
    expect(screen.getByTestId('result-name').textContent).toBe('Juan Pérez');
    expect(screen.getByTestId('result-role').textContent).toBe('Competidor');
    expect(screen.getByTestId('result-role').getAttribute('style')).toContain('rgb(28, 79, 209)');
    expect(screen.getByTestId('result-club').textContent).toContain('Academia Caucana');
    expect(screen.getByTestId('result-zone-time').textContent).toBe('Entrada · Tatamis · 9:30');
    expect(screen.getByTestId('photo-initials').textContent).toBe('JP');
    expect(onScanned).toHaveBeenCalledTimes(1);

    // Cierre automático: a los 2 s sigue (cuenta regresiva en el botón); a los 3 s vuelve a la cámara.
    const shownAt = Date.now();
    await new Promise((r) => setTimeout(r, 2000));
    expect(screen.queryByTestId('result')).toBeTruthy();
    expect(screen.getByTestId('result-next').textContent).toMatch(/Siguiente · [012]/);
    await waitFor(() => expect(screen.queryByTestId('result')).toBeNull(), { timeout: 2500 });
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(2900);
    expect(screen.getByTestId('scan-screen')).toBeTruthy();
  });

  it('rojo no se cierra solo; "Autorizar (supervisor)" pide PIN y motivo y deja un evento exception', async () => {
    render(<Scan device={base} config={config} operator="Ana" onScanned={() => undefined} />);
    await typeIdAndValidate(juan.id);
    fireEvent.click(screen.getByTestId('result-next'));
    // Mismo ID antes de 2 s: bloqueo anti-doble-lectura (no se procesa).
    fireEvent.click(screen.getByTestId('open-manual'));
    fireEvent.change(screen.getByTestId('manual-input'), { target: { value: juan.id } });
    await waitFor(() => expect(screen.getByTestId('manual-person')).toBeTruthy());
    fireEvent.click(screen.getByTestId('validate-selected'));
    expect(screen.queryByTestId('result')).toBeNull();
    expect(screen.getByTestId('double-read')).toBeTruthy();
    expect(await pendingScans()).toHaveLength(1);
    fireEvent.click(screen.getByTestId('manual-cancel'));
    await new Promise((r) => setTimeout(r, 2100));
    // Segunda entrada a Tatamis sin salida → anti-passback.
    await typeIdAndValidate(juan.id);
    expect(screen.getByTestId('result')).toHaveAttribute('data-reason', 'ANTI_PASSBACK');

    await new Promise((r) => setTimeout(r, 3500));
    expect(screen.getByTestId('result')).toHaveAttribute('data-decision', 'DENY');

    fireEvent.click(screen.getByTestId('result-override'));
    expect(screen.getByTestId('supervisor-auth')).toBeTruthy();
    for (const d of '000000') fireEvent.click(screen.getByTestId(`sup-key-${d}`));
    expect(screen.getByTestId('sup-error').textContent).toContain('incorrecto');
    for (const d of '246810') fireEvent.click(screen.getByTestId(`sup-key-${d}`));
    expect(screen.getByTestId('reason-sheet')).toBeTruthy();
    expect(screen.getByTestId('reason-confirm')).toBeDisabled();
    fireEvent.click(screen.getByTestId('reason-LEFT_WITHOUT_SCAN'));
    fireEvent.click(screen.getByTestId('reason-confirm'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveAttribute('data-reason', 'OK_MANUAL'));
    expect(screen.getByTestId('result-body').textContent).toContain('Salió sin escanear');

    const q = await pendingScans();
    const ex = q.find((e) => e.reasonCode === 'OK_MANUAL');
    expect(ex?.manual).toEqual({ type: 'exception', reasonCode: 'LEFT_WITHOUT_SCAN', authorizedBy: 'P4-TATAMI', overrides: 'ANTI_PASSBACK', reason: 'Salió sin escanear', by: 'Ana' });
  });

  it('ingreso manual con motivo del catálogo queda como manual_entry evaluado por las reglas', async () => {
    render(<Scan device={base} config={config} operator="Ana" onScanned={() => undefined} />);
    fireEvent.click(screen.getByTestId('open-manual'));
    fireEvent.change(screen.getByTestId('manual-input'), { target: { value: 'TP-2026-00124-C' } });
    expect(screen.getByTestId('id-check')).toHaveAttribute('data-state', 'check');
    expect(screen.getByTestId('manual-selected')).toBeDisabled();
    fireEvent.change(screen.getByTestId('manual-input'), { target: { value: 'TP-2026-00123-C' } });
    await waitFor(() => expect(screen.getByTestId('manual-person')).toBeTruthy());
    fireEvent.click(screen.getByTestId('manual-selected'));
    fireEvent.click(screen.getByTestId('reason-OTHER'));
    expect(screen.getByTestId('reason-confirm')).toBeDisabled();
    fireEvent.change(screen.getByTestId('reason-input'), { target: { value: 'credencial rayada' } });
    fireEvent.click(screen.getByTestId('reason-confirm'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveAttribute('data-decision', 'ALLOW'));
    const [e] = await pendingScans();
    expect(e.manual).toEqual({ type: 'manual_entry', reasonCode: 'OTHER', reason: 'Otro: credencial rayada', by: 'Ana' });
  });

  it('modo Entrada + Salida pregunta la dirección con dos botones grandes', async () => {
    render(<Scan device={{ ...base, mode: 'BOTH' }} config={config} operator="Ana" onScanned={() => undefined} />);
    expect(screen.getByTestId('scan-screen')).toHaveAttribute('data-direction', 'ASK');
    fireEvent.click(screen.getByTestId('open-manual'));
    fireEvent.change(screen.getByTestId('manual-input'), { target: { value: juan.id } });
    await waitFor(() => expect(screen.getByTestId('manual-person')).toBeTruthy());
    fireEvent.click(screen.getByTestId('validate-selected'));
    expect(screen.getByTestId('direction-prompt')).toBeTruthy();
    fireEvent.click(screen.getByTestId('pick-out'));
    await waitFor(() => expect(screen.getByTestId('result')).toBeTruthy());
    // Salir sin haber entrado: la regla decide (NOT_INSIDE), pero la dirección elegida se respeta.
    const [e] = await pendingScans();
    expect(e.direction).toBe('OUT');
  });
});
