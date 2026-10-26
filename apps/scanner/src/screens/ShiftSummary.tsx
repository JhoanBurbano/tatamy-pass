import { useEffect, useState } from 'react';
import { ownScansSince, type DeviceSettings } from '../db.js';
import { describeMode, summarizeShift, type ShiftSummary as Summary } from '../lib/shift.js';
import type { SessionInfo } from '../lib/shift.js';

export const REASON_LABEL: Record<string, string> = {
  OK: 'Entradas', OK_PHOTO_CHECK: 'Entradas (con foto)', OK_EXIT: 'Salidas', OK_MANUAL: 'Autorizados con motivo',
  ANTI_PASSBACK: 'Ya había entrado (anti-passback)', DUPLICATE: 'Posibles duplicados', REVOKED: 'Anuladas', OLD_VERSION: 'Versión anterior',
  ZONE_NOT_ALLOWED: 'Zona no permitida', BAD_SIGNATURE: 'Firma inválida', MALFORMED: 'Código no válido', UNKNOWN_CREDENTIAL: 'No está en la lista',
  EXPIRED: 'Vencidas', NOT_YET_VALID: 'Aún no válidas', DIGITAL_TOKEN_EXPIRED: 'QR digital vencido', UNKNOWN_KEY: 'Clave desconocida', WRONG_EVENT: 'Otro evento',
  DAY_NOT_ALLOWED: 'Día no válido', DIGITAL_NOT_ALLOWED: 'Digital no permitida', NOT_INSIDE: 'No estaba dentro'
};

/** Resumen del turno (§6): al terminar turno o desde el menú. */
export function ShiftSummary({ device, session, title, onClose, closeLabel, onReady }: {
  device: DeviceSettings; session: SessionInfo; title: string; onClose: () => void; closeLabel: string; onReady?: (s: Summary) => void;
}) {
  const [summary, setSummary] = useState<Summary>();

  useEffect(() => {
    void ownScansSince(device.deviceId, new Date(session.shiftStartedAt).toISOString())
      .then((rows) => {
        const s = summarizeShift(rows, { deviceId: device.deviceId, startedAt: session.shiftStartedAt, now: Date.now() });
        setSummary(s);
        onReady?.(s);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.deviceId, session.shiftStartedAt]);

  const fmt = (ms: number) => new Date(ms).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const denied = summary ? Object.entries(summary.deniedByReason).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="card belt stack" data-testid="shift-summary">
      <div>
        <h1 className="title" style={{ fontSize: 24 }}>{title}</h1>
        <p className="subtitle">
          {session.operator ?? device.name} · {device.name} · zona {device.zone} · {describeMode(device.mode)} · {fmt(session.shiftStartedAt)} → {summary ? fmt(summary.endedAt) : '…'}
        </p>
      </div>
      {summary && (
        <>
          <div className="stats">
            <div className="stat ok"><div className="n" data-testid="sum-entries">{summary.entries}</div><div className="l">Entradas</div></div>
            <div className="stat"><div className="n" data-testid="sum-exits">{summary.exits}</div><div className="l">Salidas</div></div>
            <div className="stat no"><div className="n" data-testid="sum-denied">{summary.denied}</div><div className="l">Negados</div></div>
            <div className="stat warn"><div className="n" data-testid="sum-alerts">{summary.alerts}</div><div className="l">Alertas</div></div>
            <div className="stat"><div className="n" data-testid="sum-manual">{summary.manual + summary.exceptions}</div><div className="l">Manuales · {summary.exceptions} excep.</div></div>
            <div className="stat"><div className="n" data-testid="sum-pending">{summary.pending}</div><div className="l">Pendientes de enviar</div></div>
          </div>
          <p className="muted"><span data-testid="sum-scans">{summary.scans}</span> escaneos en total.</p>
          {summary.pending > 0 && <p className="error">Quedan {summary.pending} registros sin enviar al host. Acércate al router un minuto antes de entregar; se envían solos.</p>}
          {denied.length > 0 && (
            <div>
              <span className="label">Negados por motivo</span>
              <ul className="list" data-testid="sum-denied-list">
                {denied.map(([r, n]) => (
                  <li key={r}><span>{REASON_LABEL[r] ?? r}</span><span className="badge DENY">{n}</span></li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <button className="btn primary" type="button" data-testid="summary-close" onClick={onClose}>{closeLabel}</button>
    </div>
  );
}
