import { cloudKeyInfo } from '@/lib/cloud-auth';
import { requireUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { appUrl } from '@/lib/mail';
import { rotateCloudKeyAction } from '../actions';
import { Flash, fmt, PageHead, type Search } from '../ui';
import { CopyButton } from './copy';

export const dynamic = 'force-dynamic';

/** Descargas de aprobados (CSV/JSON) y datos de conexión del host. La clave solo la ve el administrador. */
export default async function ExportarPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser(['admin', 'coord']);
  const sp = await searchParams;
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const approved = await repos.registrations.list({ status: 'APPROVED', participantsOnly: false, limit: 5000 });
  const participants = approved.filter((r) => !r.companionOf).length;
  const pendingExport = approved.filter((r) => !r.exportedAt && !r.revokedAt).length;
  const lastExport = approved.map((r) => r.exportedAt).filter(Boolean).sort().pop();
  const key = await cloudKeyInfo(repos);
  const reports = await repos.settings.hostReports(1);
  const base = appUrl();
  const exportUrl = `${base}/api/export`;
  const curl = key.key ? `curl -s "${exportUrl}?since=" -H "x-tatami-key: ${key.key}" | jq '{count, cursor}'` : '';

  return (
    <>
      <PageHead title="Exportar" subtitle="Lo que se lleva el host (inscripciones aprobadas con sus acompañantes y foto) y archivos para la organización." />
      <Flash sp={sp} />
      <div className="kpis">
        <div className="kpi"><div className="v">{participants}</div><div className="l">Participantes aprobados</div></div>
        <div className="kpi"><div className="v">{approved.length - participants}</div><div className="l">Acompañantes aprobados</div></div>
        <div className="kpi"><div className="v">{pendingExport}</div><div className="l">Pendientes de enviar al host</div></div>
        <div className="kpi"><div className="v" style={{ fontSize: 16 }}>{lastExport ? fmt(lastExport) : 'nunca'}</div><div className="l">Última actualización del host</div></div>
      </div>

      <div className="cards">
        <div className="card">
          <h2 style={{ fontSize: 18 }}>Archivos</h2>
          <p className="small muted" style={{ marginTop: 6 }}>Solo inscripciones <strong>aprobadas</strong> (participantes y acompañantes). Contienen datos personales: compártelos solo con quien los necesite y bórralos al terminar el evento.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <a className="btn primary sm" href="/panel/exportar/csv">Descargar CSV</a>
            <a className="btn secondary sm" href="/panel/exportar/json">Descargar JSON</a>
            <a className="btn ghost sm" href="/panel/reportes">Reportes por rol / club</a>
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>El JSON tiene el mismo formato que recibe el host (`registrations[].companions`, `photoUrl`, `revoked`): sirve para cargarlo a mano si no hay internet en la sede.</p>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 18 }}>Conexión del host</h2>
          <dl className="side-by" style={{ marginTop: 10 }}>
            <dt>Endpoint</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>GET {exportUrl}?since=&lt;cursor&gt;</dd>
            <dt>Cabecera</dt><dd className="mono">x-tatami-key: &lt;clave&gt;</dd>
            <dt>En el host</dt><dd className="mono">TP_CLOUD_URL={base} · TP_CLOUD_KEY=&lt;clave&gt; · TP_CLOUD_INTERVAL_MIN=5</dd>
            <dt>Reporte del host</dt><dd>{reports[0] ? `${fmt(reports[0].receivedAt)} · ${reports[0].credentialsCount} credenciales` : 'todavía ninguno'}</dd>
          </dl>
          {user.role === 'admin' ? (
            <div style={{ marginTop: 14 }}>
              <div className="label">Clave compartida {key.source === 'panel' ? `(generada en el panel${key.rotatedAt ? ` el ${fmt(key.rotatedAt)}` : ''})` : key.source === 'env' ? '(variable TP_CLOUD_KEY)' : ''}</div>
              {key.key ? (
                <>
                  <div className="row"><code className="mono" style={{ background: 'var(--surface-2)', padding: '8px 10px', borderRadius: 10, wordBreak: 'break-all' }}>{key.key}</code><CopyButton text={key.key} /></div>
                  <details style={{ marginTop: 10 }}><summary className="small">Probar con curl</summary><pre className="mono small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--surface-2)', padding: 10, borderRadius: 10 }}>{curl}</pre></details>
                </>
              ) : (
                <div className="notice warn" style={{ marginTop: 6 }}>No hay clave: el host no puede conectarse. Genera una aquí o define <code>TP_CLOUD_KEY</code>.</div>
              )}
              <form action={rotateCloudKeyAction} style={{ marginTop: 12 }}>
                <button className="btn danger sm" type="submit">{key.key ? 'Generar clave nueva (la actual deja de valer)' : 'Generar clave'}</button>
              </form>
              <p className="small muted" style={{ marginTop: 6 }}>Después de rotar, actualiza <code>TP_CLOUD_KEY</code> en el host y reinícialo. Mientras tanto el host verá “clave inválida” y seguirá operando con lo que ya tiene.</p>
            </div>
          ) : (
            <p className="small muted" style={{ marginTop: 14 }}>La clave compartida solo la ve y la rota un administrador.</p>
          )}
        </div>
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>Evento {config.name} · {config.startDate} → {config.endDate}.</p>
    </>
  );
}
