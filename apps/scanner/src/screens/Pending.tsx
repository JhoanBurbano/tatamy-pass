import { useEffect, useState } from 'react';
import { deviceEventType, isDeviceEvent } from '@tatami/core';
import { db, type LocalScan } from '../db.js';
import { syncClient, type SyncStatus } from '../sync.js';

const TYPE_LABEL: Record<string, string> = {
  scan: 'Escaneo', manual_entry: 'Ingreso manual', exception: 'Excepción', zone_change: 'Cambio de zona', mode_change: 'Cambio de modo', shift_start: 'Inicio de turno', shift_end: 'Fin de turno'
};

function ago(iso: string | undefined, now: number): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `a las ${new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Bandeja de pendientes (§5): contador, lista, reintentar y explicación calmada. */
export function Pending({ status, onClose }: { status: SyncStatus; onClose: () => void }) {
  const [rows, setRows] = useState<LocalScan[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    void db.scans.where('synced').equals(0).reverse().sortBy('seq').then((r) => setRows(r.slice(0, 100)));
  }, [status.pending, status.lastSyncAt]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  async function retry() {
    setRetrying(true);
    try { await syncClient.tick(true); } finally { setRetrying(false); setNow(Date.now()); }
  }

  const online = status.state === 'online';
  const hostLabel = online ? 'Host conectado' : status.state === 'syncing' ? 'Sincronizando…' : 'Sin conexión con el host';

  return (
    <div className="card belt stack" data-testid="pending-screen">
      <div className="row">
        <div className="grow">
          <h1 className="title" style={{ fontSize: 22 }}>Pendientes de enviar</h1>
          <p className="subtitle">
            {status.pending === 0 ? 'Todo está en el host. No hay nada guardado solo en este dispositivo.' : `${status.pending} registro(s) guardados en este dispositivo.`}
          </p>
        </div>
        <div className="count" data-testid="pending-total" aria-label={`${status.pending} pendientes`}>{status.pending}</div>
      </div>

      <div className="host-state" data-testid="host-state" data-state={status.state}>
        <span className={`dot ${status.state}`} aria-hidden />
        <div className="grow">
          <div className="name">{hostLabel}</div>
          <div className="meta">
            Última sync {ago(status.lastSyncAt, now)}
            {status.snapshotAt ? ` · lista de credenciales ${ago(status.snapshotAt, now)} (${status.credentials})` : ' · sin lista de credenciales todavía'}
          </div>
          {status.lastError && !online && <div className="meta" data-testid="host-error-text">{status.lastError}</div>}
        </div>
      </div>

      <p className="muted calm" data-testid="pending-explain">
        {status.pending === 0
          ? 'Sigue escaneando con tranquilidad: cada lectura se guarda primero aquí y se envía sola al host.'
          : online
            ? 'Se están enviando. Si el número no baja en un minuto, toca Reintentar ahora.'
            : 'No pasa nada. El scanner valida con la lista guardada y los registros se envían solos cuando vuelva la conexión. No apagues ni desenroles el dispositivo mientras haya pendientes.'}
      </p>

      <button className="btn secondary" type="button" data-testid="pending-retry" disabled={retrying} onClick={() => void retry()}>{retrying ? 'Reintentando…' : 'Reintentar ahora'}</button>

      {rows.length > 0 && (
        <ul className="list" data-testid="pending-list">
          {rows.map((r) => {
            const type = deviceEventType(r);
            return (
              <li key={r.id}>
                <span>#{r.seq} · {TYPE_LABEL[type] ?? type} · {r.credentialId ?? (isDeviceEvent(r) ? r.zone : 'sin ID')} · {new Date(r.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={`badge ${r.decision}`}>{isDeviceEvent(r) ? 'EVENTO' : r.decision}</span>
              </li>
            );
          })}
        </ul>
      )}
      <button className="btn primary" type="button" data-testid="pending-close" onClick={onClose}>Volver a escanear</button>
    </div>
  );
}
