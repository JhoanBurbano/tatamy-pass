import { api, ago, hhmm, num } from '../api.js';
import { Card, Empty, ErrorBox, Kpi, PageHead, REASON_NAMES, Spinner, Tag, usePoll } from '../ui.jsx';
import type { Session } from '../App.jsx';

interface Live {
  at: string; date: string;
  kpis: { entriesToday: number; accredited: number; ratePerMin: number; peakRatePerMin: number; peakAt: string | null; pendingTotal: number; pendingDevices: number; openAlerts: number; devicesOnline: number; devicesOffline: number };
  gates: Array<{ deviceId: string; name: string; zone: string; zoneName: string; ratePerMin: number; today: number; denied: number; lastScanAt: string | null; lastSeenAt: string | null; pending: number; status: 'ok' | 'warn' | 'off' | 'disabled'; statusText: string }>;
  insideByZone: Array<{ code: string; name: string; inside: number; tracksExit: boolean }>;
  recent: Array<{ id: string; at: string; credentialId: string | null; zone: string; direction: string; decision: string; reasonCode: string; deviceId: string }>;
}

const dayLabel = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'short' });

export function Puertas({ session }: { session: Session }) {
  void session;
  const { data, error, loading } = usePoll((signal) => api<Live>('/live', { signal }), 5000);
  if (loading && !data) return <Spinner />;
  const k = data?.kpis;
  const pendingText = !k ? '' : k.pendingTotal === 0 ? 'nada pendiente' : `${num(k.pendingTotal)} pendientes por enviar · ${k.pendingDevices} ${k.pendingDevices === 1 ? 'dispositivo' : 'dispositivos'}`;
  return (
    <>
      <PageHead
        title={`Puertas en vivo · ${data ? dayLabel.format(new Date(data.at)) : ''} · ${data ? hhmm(data.at) : ''}`}
        sub="Se actualiza cada 5 segundos."
        right={k && (
          <span className={`live ${k.devicesOffline ? 'warn' : ''}`}><i />{k.devicesOnline} {k.devicesOnline === 1 ? 'scanner conectado' : 'scanners conectados'}{k.devicesOffline ? ` · ${k.devicesOffline} sin conexión` : ''}</span>
        )}
      />
      <ErrorBox text={error} />
      {k && (
        <div className="kpis">
          <Kpi label="Ingresos hoy" value={num(k.entriesToday)} small={`de ${num(k.accredited)} acreditados`} />
          <Kpi label="Ritmo actual" value={`${k.ratePerMin} /min`} small={k.peakRatePerMin ? `pico ${k.peakRatePerMin} /min a las ${hhmm(k.peakAt)}` : 'sin pico todavía'} />
          <Kpi label="Pendientes de enviar" value={num(k.pendingTotal)} small={pendingText} tone={k.pendingTotal > 200 ? 'bad' : k.pendingTotal > 50 ? 'warn' : undefined} />
          <Kpi label="Alertas abiertas" value={num(k.openAlerts)} small={k.openAlerts ? <a href="#/alertas">ver alertas</a> : 'sin alertas activas'} tone={k.openAlerts ? 'bad' : undefined} />
        </div>
      )}
      <div className="grid-2">
        <Card className="flush" title="Puertas">
          <div className="tbl">
            {data && data.gates.length === 0 ? <Empty>No hay scanners enrolados. Enrola el primero desde Dispositivos.</Empty> : (
              <table>
                <thead><tr><th>Puerta</th><th>Zona</th><th className="r">Ritmo /min</th><th className="r">Hoy</th><th className="r">Rechazos</th><th>Último escaneo</th><th className="r">Pendientes</th><th>Estado</th></tr></thead>
                <tbody>
                  {data?.gates.map((g) => (
                    <tr key={g.deviceId}>
                      <td><span className="door"><i className={g.status} />{g.name}</span></td>
                      <td>{g.zoneName} <span className="muted small">({g.zone})</span></td>
                      <td className="r">{g.ratePerMin}</td>
                      <td className="r">{num(g.today)}</td>
                      <td className="r">{num(g.denied)}</td>
                      <td>{g.lastScanAt ? `${hhmm(g.lastScanAt)} · ${ago(g.lastScanAt)}` : 'sin escaneos'}</td>
                      <td className="r">{g.pending}</td>
                      <td><Tag tone={g.status === 'ok' ? 'ok' : g.status === 'warn' ? 'warn' : g.status === 'disabled' ? 'bad' : 'off'}>{g.statusText}</Tag></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        <div className="stack">
          <Card title="Dentro ahora" right={<span className="muted small">entradas − salidas</span>}>
            {data?.insideByZone.filter((z) => z.tracksExit).map((z) => (
              <div className="line-item" key={z.code}><span>{z.name}</span><span className="num" style={{ fontWeight: 700 }}>{num(z.inside)}</span></div>
            ))}
            <p className="muted small">Gradería y stands no controlan salida, por eso no aparecen.</p>
          </Card>
          <Card title="Últimos escaneos">
            {data && data.recent.length === 0 && <Empty>Los reportes aparecen cuando empiecen los escaneos.</Empty>}
            {data?.recent.slice(0, 10).map((e) => (
              <div className="line-item" key={e.id}>
                <span><b className="mono">{e.credentialId ?? '—'}</b> <span className="muted">· {e.zone}</span></span>
                <span><Tag tone={e.decision === 'ALLOW' ? 'ok' : e.decision === 'DENY' ? 'bad' : 'warn'}>{REASON_NAMES[e.reasonCode] ?? e.reasonCode}</Tag> <span className="muted small">{hhmm(e.at)}</span></span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
