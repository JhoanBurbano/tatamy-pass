import Link from 'next/link';
import { requireUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { revokeAction, unrevokeAction } from '../actions';
import { Avatar, CredentialBadge, Empty, Flash, fmt, fullName, PageHead, q, type Search } from '../ui';

export const dynamic = 'force-dynamic';

type View = 'ALL' | 'PENDING_EXPORT' | 'EXPORTED' | 'ISSUED' | 'PRINTED' | 'DELIVERED' | 'REVOKED';

export default async function CredencialesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser(['admin', 'coord']);
  const sp = await searchParams;
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const view = (q(sp, 'view') || 'ALL') as View;
  const search = q(sp, 'q') || undefined;
  const approved = await repos.registrations.list({ status: 'APPROVED', search, participantsOnly: false, limit: 5000 });
  const rows = approved.filter((r) => {
    if (view === 'ALL') return true;
    if (view === 'REVOKED') return Boolean(r.revokedAt);
    if (r.revokedAt) return false;
    if (view === 'PENDING_EXPORT') return !r.exportedAt && !r.credentialStatus;
    if (view === 'EXPORTED') return Boolean(r.exportedAt) && !r.credentialStatus;
    return r.credentialStatus === view;
  });
  const kpi = {
    total: approved.length,
    pending: approved.filter((r) => !r.exportedAt && !r.credentialStatus && !r.revokedAt).length,
    exported: approved.filter((r) => r.exportedAt && !r.credentialStatus && !r.revokedAt).length,
    issued: approved.filter((r) => (r.credentialStatus === 'ISSUED' || r.credentialStatus === 'PRINTED') && !r.revokedAt).length,
    delivered: approved.filter((r) => r.credentialStatus === 'DELIVERED' && !r.revokedAt).length,
    revoked: approved.filter((r) => r.revokedAt).length
  };
  const reports = await repos.settings.hostReports(5);
  const roleName = (code: string) => config.roles.find((r) => r.code === code)?.name ?? code;
  const qs = new URLSearchParams({ ...(view !== 'ALL' ? { view } : {}), ...(search ? { q: search } : {}) }).toString();
  const returnTo = `/panel/credenciales${qs ? `?${qs}` : ''}`;

  return (
    <>
      <PageHead title="Credenciales" subtitle="Estado por persona: lo que exportó la nube y lo que reporta el host (emitida, impresa, entregada). Anular aquí llega al host en su próxima actualización." />
      <Flash sp={sp} />
      <div className="kpis">
        {([['Aprobadas', kpi.total, 'ALL'], ['Por enviar al host', kpi.pending, 'PENDING_EXPORT'], ['Enviadas', kpi.exported, 'EXPORTED'], ['Emitidas / impresas', kpi.issued, 'ISSUED'], ['Entregadas', kpi.delivered, 'DELIVERED'], ['Anuladas', kpi.revoked, 'REVOKED']] as [string, number, View][]).map(([l, v, k]) => (
          <Link key={k} href={`/panel/credenciales?view=${k}`} className="kpi" style={{ textDecoration: 'none', color: 'inherit', outline: view === k ? '2px solid var(--blue)' : undefined }}><div className="v">{v}</div><div className="l">{l}</div></Link>
        ))}
      </div>
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div className="row between">
          <form method="get" className="row"><input type="hidden" name="view" value={view} /><input className="input sm" name="q" placeholder="Nombre, documento o código" defaultValue={search ?? ''} /><button className="btn secondary sm" type="submit">Buscar</button></form>
          <div className="small muted">Último reporte del host: {reports[0] ? `${fmt(reports[0].receivedAt)} · ${reports[0].credentialsCount} credenciales · ${JSON.stringify(reports[0].summary).slice(0, 120)}` : 'todavía ninguno (POST /api/host-report)'}</div>
        </div>
      </div>
      {rows.length === 0 ? <Empty title="No hay credenciales en esta vista">Aprueba inscripciones y luego el host las trae con "Actualizar desde la nube".</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th></th><th>Persona</th><th>Rol</th><th>Club</th><th>ID credencial</th><th>Estado</th><th>Actualizado</th><th>Acciones</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Avatar r={r} /></td>
                  <td><Link href={`/panel/inscripciones/${r.companionOf ?? r.id}`}>{fullName(r)}</Link><div className="small muted mono">{r.code ?? 'acompañante'}</div></td>
                  <td>{roleName(r.roleCode)}</td>
                  <td>{r.club ?? '—'}</td>
                  <td className="mono">{r.credentialId ?? '—'}</td>
                  <td><CredentialBadge r={r} />{r.revokeReason && <div className="small muted">{r.revokeReason}</div>}</td>
                  <td className="small muted">{fmt(r.credentialUpdatedAt ?? r.exportedAt ?? r.updatedAt)}</td>
                  <td>
                    {r.revokedAt ? (
                      <form action={unrevokeAction} className="inline-form"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} /><button className="btn secondary sm" type="submit">Retirar anulación</button></form>
                    ) : (
                      <details className="rej"><summary>Anular</summary>
                        <form action={revokeAction} className="inline-form" style={{ marginTop: 6 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} />
                          <input className="input sm" name="reason" placeholder="Motivo" required style={{ width: 160 }} /><button className="btn danger sm" type="submit">Anular</button>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
