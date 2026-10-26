import { useEffect, useState } from 'react';
import { api, dateTime, download, num } from '../api.js';
import { Card, Empty, ErrorBox, Field, PageHead, Spinner, Tag, errorText, useToast } from '../ui.jsx';
import type { Session } from '../App.jsx';

interface Rec { seq: number; at: string; actor: string; action: string; payload: unknown; prevHash: string; hash: string }
interface Page { records: Rec[]; total: number; verification: { ok: true; length: number } | { ok: false; brokenAt: number; reason: string }; actions?: string[] }

const ACTIONS: Record<string, string> = {
  LOGIN: 'Inicio de sesión', ENROLL_TOKEN_CREATED: 'Código de enrolamiento creado', DEVICE_ENROLLED: 'Scanner enrolado', DEVICE_ZONE_CHANGED: 'Zona de scanner cambiada', DEVICE_DISABLED: 'Scanner desactivado', DEVICE_ENABLED: 'Scanner activado',
  CREDENTIAL_REVOKED: 'Credencial anulada', CREDENTIAL_REISSUED: 'Credencial re-emitida', CREDENTIAL_DELIVERED: 'Credencial entregada', CREDENTIAL_PDF: 'PDF de credencial', PRINT_BATCH_CREATED: 'Lote creado', PRINT_BATCH_PDF: 'PDF de lote', PRINT_BATCH_PRINTED: 'Lote impreso',
  ALERT_RESOLVED: 'Alerta resuelta', CONFIG_UPDATED: 'Configuración guardada', BACKUP_SNAPSHOT: 'Copia de seguridad', BACKUP_RESTORED: 'Copia restaurada', CLOUD_PULL: 'Actualización desde la nube',
  USER_CREATED: 'Usuario creado', USER_DISABLED: 'Usuario desactivado', USER_ENABLED: 'Usuario activado', USER_PASSWORD_RESET: 'Contraseña restablecida', AUDIT_EXPORTED: 'Auditoría exportada',
  PROMOTED: 'Equipo promovido a principal', PII_PURGED: 'Datos personales purgados', PII_ENCRYPTED: 'Datos personales cifrados', SEED_COMPLETED: 'Datos de prueba cargados',
  CREDENTIAL_ISSUED_MANUAL: 'Credencial emitida en sitio', CREDENTIAL_TOKEN_VIEWED: 'QR/token consultado', PRINT_BATCH_DELIVERED: 'Lote entregado', DEVICE_RENAMED: 'Scanner renombrado',
  BACKUP_VERIFIED: 'Copia verificada', CLOUD_INTERVAL_CHANGED: 'Intervalo de nube cambiado'
};

export function Auditoria({ session }: { session: Session }) {
  void session;
  const { toast } = useToast();
  const LIMIT = 50;
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; message: string; count: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (off = offset) => {
    try {
      const p = new URLSearchParams({ offset: String(off), limit: String(LIMIT) });
      if (action) p.set('action', action);
      if (actor.trim()) p.set('actor', actor.trim());
      setPage(await api<Page>(`/audit?${p}`)); setOffset(off); setError(null);
    } catch (e) { setError(errorText(e)); }
  };
  useEffect(() => { void load(0); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [action]);

  const doVerify = async () => {
    setBusy('verify');
    try { setVerify(await api('/audit/verify')); } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const exportAs = async (format: 'csv' | 'json') => {
    setBusy(format);
    try {
      const r = await download(`/audit/export?format=${format}`, `auditoria.${format}`);
      toast(`Archivo descargado. Huella SHA-256: ${r.sha256?.slice(0, 16)}… (guárdala junto al archivo).`);
    } catch (e) { toast(errorText(e), 'error'); } finally { setBusy(null); }
  };
  const v = page?.verification;

  return (
    <>
      <PageHead title="Auditoría" sub="Registro encadenado por hash: cada registro incluye la huella del anterior. Verifícalo al cierre de cada día."
        right={<span className="inline">
          <button className="btn" disabled={busy === 'verify'} onClick={() => void doVerify()}>Verificar cadena</button>
          <button className="btn" disabled={busy === 'csv'} onClick={() => void exportAs('csv')}>Exportar CSV</button>
          <button className="btn" disabled={busy === 'json'} onClick={() => void exportAs('json')}>Exportar JSON</button>
        </span>} />
      <ErrorBox text={error} />
      {verify && <div className={verify.ok ? 'ok-box' : 'error-box'}>{verify.message}</div>}
      {v && !v.ok && !verify && <div className="error-box">El registro fue alterado a partir del número {v.brokenAt}. No modifiques nada y avisa al Administrador.</div>}
      <p className="muted small">Este archivo contiene datos del evento. Si lo compartes, hazlo por un canal seguro; la huella SHA-256 que muestra el panel permite comprobar que no se modificó. (Cifrado ZIP con contraseña: no implementado; se entrega export plano + huella.)</p>
      <Card className="flush" title={page ? `${num(page.total)} registros` : 'Registros'} right={
        <form className="inline" onSubmit={(e) => { e.preventDefault(); void load(0); }} style={{ padding: '0 18px' }}>
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Acción" style={{ width: 'auto', minHeight: 32, padding: '4px 8px' }}>
            <option value="">Todas las acciones</option>{(page?.actions ?? Object.keys(ACTIONS)).map((k) => <option key={k} value={k}>{ACTIONS[k] ?? k}</option>)}
          </select>
          <Field label=""><input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="usuario" style={{ minHeight: 32, padding: '4px 8px', width: 140 }} aria-label="Usuario" /></Field>
          <button className="btn sm">Filtrar</button>
        </form>}>
        <div className="tbl">
          {!page ? <Spinner /> : page.records.length === 0 ? <Empty>Sin registros con ese filtro.</Empty> : (
            <table>
              <thead><tr><th>#</th><th>Cuándo</th><th>Quién</th><th>Qué</th><th>Detalle</th><th>Huella</th></tr></thead>
              <tbody>
                {page.records.map((r) => (
                  <tr key={r.seq} className="click" onClick={() => setOpen(open === r.seq ? null : r.seq)}>
                    <td className="r">{r.seq}</td>
                    <td>{dateTime(r.at)}</td>
                    <td>{r.actor}</td>
                    <td><Tag tone="info">{ACTIONS[r.action] ?? r.action}</Tag></td>
                    <td style={{ maxWidth: 420, whiteSpace: open === r.seq ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} className="mono small">{open === r.seq ? JSON.stringify(r.payload, null, 2) : JSON.stringify(r.payload)}</td>
                    <td className="mono small muted" title={r.hash}>{r.hash.slice(0, 10)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {page && page.total > LIMIT && (
          <div className="pager" style={{ padding: '10px 18px' }}>
            <span>{offset + 1}–{Math.min(offset + LIMIT, page.total)} de {num(page.total)} (más recientes primero)</span>
            <span className="inline">
              <button className="btn sm" disabled={offset === 0} onClick={() => void load(Math.max(0, offset - LIMIT))}>Anterior</button>
              <button className="btn sm" disabled={offset + LIMIT >= page.total} onClick={() => void load(offset + LIMIT)}>Siguiente</button>
            </span>
          </div>
        )}
      </Card>
    </>
  );
}
