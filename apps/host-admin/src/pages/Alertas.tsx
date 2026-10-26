import { useState } from 'react';
import { api, ago, dateTime, hhmm } from '../api.js';
import { Card, Confirm, Empty, ErrorBox, PageHead, REASON_NAMES, Spinner, Tag, errorText, usePoll, useToast } from '../ui.jsx';
import { isReadOnly, type Session } from '../App.jsx';

interface Alert {
  id: string; kind: 'DUPLICATE' | 'MANUAL' | 'OFFLINE'; at: string; credentialId: string | null; deviceId: string | null;
  detail: { device?: string; zone?: string; reason?: string; by?: string; pending?: number; reasonCode?: string };
  status: 'OPEN' | 'RESOLVED'; resolvedAt: string | null; resolvedBy: string | null; note: string | null;
  credential: { id: string; displayName: string; roleCode: string } | null;
}

const KIND: Record<Alert['kind'], { title: string; tone: 'bad' | 'warn' | 'info'; icon: string }> = {
  DUPLICATE: { title: 'Credencial usada en dos puertas', tone: 'bad', icon: '!' },
  MANUAL: { title: 'Ingreso manual', tone: 'info', icon: 'M' },
  OFFLINE: { title: 'Scanner sin conexión', tone: 'warn', icon: '✕' }
};

function describe(a: Alert): string {
  const who = a.credential ? `${a.credential.displayName} (${a.credential.roleCode})` : a.credentialId ?? 'credencial desconocida';
  switch (a.kind) {
    case 'DUPLICATE': return `${who} se escaneó en ${a.detail.device ?? a.deviceId} (${a.detail.zone}) a las ${hhmm(a.at)} y ya se había usado en otra puerta hace menos de 2 min.`;
    case 'MANUAL': return `${who} entró por ingreso manual en ${a.detail.device ?? a.deviceId} (${a.detail.zone}) a las ${hhmm(a.at)}${a.detail.reason ? ` · motivo: ${a.detail.reason}` : ''}${a.detail.by ? ` · autorizó ${a.detail.by}` : ''}.`;
    case 'OFFLINE': return `${a.detail.device ?? a.deviceId} (${a.detail.zone}) sin reportar desde las ${hhmm(a.at)} (${ago(a.at)}). Sigue validando offline${a.detail.pending ? ` · ${a.detail.pending} pendientes por enviar` : ''}.`;
  }
}

interface Denied {
  date: string; total: number; byReason: Record<string, number>;
  byGate: Array<{ deviceId: string; name: string; zone: string; zoneName: string; denied: number; today: number }>;
  recent: Array<{ id: string; at: string; zone: string; reasonCode: string; device: string; credentialId: string | null; credential: { id: string; displayName: string; roleCode: string } | null }>;
}

export function Alertas({ session }: { session: Session }) {
  const { toast } = useToast();
  const canResolve = !isReadOnly(session.user.role) && session.mode !== 'standby';
  const denied = usePoll((signal) => api<Denied>('/alerts/denied?limit=30', { signal }), 10_000);
  const [showDenied, setShowDenied] = useState(false);
  const [tab, setTab] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [filter, setFilter] = useState<'' | Alert['kind']>('');
  const list = usePoll((signal) => api<{ items: Alert[]; open: number }>(`/alerts?status=${tab}`, { signal }), 5000, [tab]);
  const [resolving, setResolving] = useState<Alert | null>(null);
  const [busy, setBusy] = useState(false);
  const resolve = async (note: string) => {
    if (!resolving) return;
    setBusy(true);
    try { await api(`/alerts/${encodeURIComponent(resolving.id)}/resolve`, { method: 'POST', body: { note } }); toast('Alerta resuelta.'); setResolving(null); list.refresh(); }
    catch (e) { toast(errorText(e), 'error'); } finally { setBusy(false); }
  };
  const items = (list.data?.items ?? []).filter((a) => !filter || a.kind === filter);
  return (
    <>
      <PageHead title="Alertas" sub="Duplicados, ingresos manuales con motivo y scanners sin conexión más de 5 minutos. Resuélvelas con una nota de lo que se decidió. Abajo, los intentos denegados por puerta."
        right={<span className="inline">
          <button className={`btn sm ${tab === 'OPEN' ? 'pri' : ''}`} onClick={() => setTab('OPEN')}>Abiertas{list.data ? ` (${list.data.open})` : ''}</button>
          <button className={`btn sm ${tab === 'RESOLVED' ? 'pri' : ''}`} onClick={() => setTab('RESOLVED')}>Resueltas</button>
          <select value={filter} onChange={(e) => setFilter(e.target.value as '' | Alert['kind'])} aria-label="Tipo" style={{ width: 'auto', minHeight: 32, padding: '4px 8px' }}>
            <option value="">Todos los tipos</option><option value="DUPLICATE">Duplicados</option><option value="MANUAL">Ingresos manuales</option><option value="OFFLINE">Sin conexión</option>
          </select>
        </span>} />
      <ErrorBox text={list.error} />
      <Card>
        {list.loading && !list.data ? <Spinner /> : items.length === 0 ? <Empty>{tab === 'OPEN' ? 'Sin alertas activas.' : 'Todavía no hay alertas resueltas.'}</Empty> : items.map((a) => {
          const k = KIND[a.kind];
          return (
            <div className={`alert-item ${a.status === 'RESOLVED' ? 'resolved' : k.tone}`} key={a.id}>
              <i aria-hidden>{k.icon}</i>
              <div className="body">
                <div style={{ fontWeight: 700 }}>{k.title}{a.credentialId ? <> · <b>{a.credentialId}</b></> : null}</div>
                <div>{describe(a)}</div>
                {a.status === 'RESOLVED' && <div className="small">Resuelta {dateTime(a.resolvedAt)} por {a.resolvedBy}: “{a.note}”</div>}
              </div>
              {a.status === 'OPEN' && canResolve && <div className="actions"><button className="btn sm" onClick={() => setResolving(a)}>Resolver</button></div>}
            </div>
          );
        })}
      </Card>
      <Card className="flush" title={denied.data ? `${denied.data.total} intentos denegados hoy` : 'Intentos denegados hoy'} right={denied.data && denied.data.total > 0 ? <button className="btn sm" onClick={() => setShowDenied((v) => !v)}>{showDenied ? 'Ocultar casos' : 'Ver últimos casos'}</button> : undefined}>
        {denied.data && (
          <div className="muted small" style={{ padding: '0 18px' }}>
            Un rechazo no es una alerta: es la app haciendo su trabajo. Mira esta tabla si una puerta rechaza mucho más que las demás.
            {denied.data.total > 0 && <> · {Object.entries(denied.data.byReason).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${REASON_NAMES[r] ?? r}: ${n}`).join(' · ')}</>}
          </div>
        )}
        <div className="tbl">
          {!denied.data ? <Spinner /> : denied.data.byGate.length === 0 ? <Empty>No hay scanners enrolados.</Empty> : (
            <table>
              <thead><tr><th>Puerta</th><th>Zona</th><th className="r">Ingresos hoy</th><th className="r">Denegados</th><th className="r">% denegados</th></tr></thead>
              <tbody>{denied.data.byGate.map((g) => {
                const pct = g.today + g.denied > 0 ? Math.round((g.denied / (g.today + g.denied)) * 100) : 0;
                return (
                  <tr key={g.deviceId}><td style={{ fontWeight: 600 }}>{g.name}</td><td>{g.zoneName}</td><td className="r">{g.today}</td><td className="r">{g.denied}</td>
                    <td className="r"><Tag tone={pct > 25 ? 'bad' : pct > 10 ? 'warn' : 'ok'}>{pct} %</Tag></td></tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
        {showDenied && denied.data && (
          <div className="tbl" style={{ borderTop: '1px solid var(--line)' }}>
            {denied.data.recent.length === 0 ? <Empty>Sin rechazos hoy.</Empty> : (
              <table>
                <thead><tr><th>Hora</th><th>Puerta</th><th>Credencial</th><th>Motivo</th></tr></thead>
                <tbody>{denied.data.recent.map((e) => (
                  <tr key={e.id}><td>{hhmm(e.at)}</td><td>{e.device} <span className="muted">({e.zone})</span></td>
                    <td>{e.credential ? <><b className="mono">{e.credential.id}</b> · {e.credential.displayName}</> : <span className="muted">{e.credentialId ?? 'código ilegible'}</span>}</td>
                    <td><Tag tone="bad">{REASON_NAMES[e.reasonCode] ?? e.reasonCode}</Tag></td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </Card>
      <Confirm open={!!resolving} title="Resolver alerta" body={resolving ? describe(resolving) : ''} confirmLabel="Resolver" withNote placeholder="Qué se revisó y qué se decidió (p. ej. “foto y documento coinciden, se dejó pasar”)" busy={busy}
        onCancel={() => setResolving(null)} onConfirm={resolve} />
    </>
  );
}
