import { requireUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { STATUS_SHORT } from '@/lib/labels';
import type { RegistrationStatus } from '@/lib/repo/types';
import { PageHead } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ReportesPage() {
  const user = await requireUser();
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const scope = user.role === 'club' ? { delegationId: user.delegationId } : {};
  const [byRole, byCategory, byClub, byStatus] = await Promise.all([
    repos.registrations.countBy('role_code', scope), repos.registrations.countBy('category_code', scope), repos.registrations.countBy('club', scope), repos.registrations.countBy('status', scope)
  ]);
  const roleName = (c: string) => config.roles.find((r) => r.code === c)?.name ?? c;
  const catName = (c: string) => config.ageCategories.find((x) => x.code === c)?.name ?? (c || 'Sin categoría');
  const total = byStatus.reduce((a, b) => a + b.n, 0);
  const csvLink = (by: string) => `/panel/reportes/csv?by=${by}`;

  const Block = ({ title, rows, by, label }: { title: string; rows: { key: string; n: number }[]; by: string; label: (k: string) => string }) => (
    <div className="card">
      <div className="row between"><h2 style={{ fontSize: 18 }}>{title}</h2><a className="btn ghost sm" href={csvLink(by)}>Exportar CSV</a></div>
      {rows.length === 0 ? <p className="small muted" style={{ marginTop: 8 }}>Sin datos todavía.</p> : (
        <table><thead><tr><th>{title}</th><th style={{ textAlign: 'right' }}>Inscritos</th><th style={{ width: '40%' }}></th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key}><td>{label(r.key)}</td><td style={{ textAlign: 'right' }}>{r.n}</td><td><div className="capacity-bar"><i style={{ width: `${total ? Math.round((r.n / total) * 100) : 0}%` }} /></div></td></tr>)}</tbody>
        </table>
      )}
    </div>
  );

  return (
    <>
      <PageHead title="Reportes" subtitle={user.role === 'club' ? 'Inscritos de tu delegación (sin contar acompañantes).' : 'Participantes inscritos (sin contar acompañantes). Cada bloque se puede exportar a CSV; el listado completo también.'}>
        <a className="btn primary sm" href={csvLink('all')}>Exportar listado completo (CSV)</a>
      </PageHead>
      <div className="kpis">
        <div className="kpi"><div className="v">{total}</div><div className="l">Inscritos</div></div>
        {byStatus.map((s) => <div className="kpi" key={s.key}><div className="v">{s.n}</div><div className="l">{STATUS_SHORT[s.key as RegistrationStatus] ?? s.key}</div></div>)}
      </div>
      <div className="cards">
        <Block title="Por rol" rows={byRole} by="role" label={roleName} />
        <Block title="Por categoría" rows={byCategory.filter((c) => c.key)} by="category" label={catName} />
        <Block title="Por club" rows={byClub} by="club" label={(k) => k || 'Sin club'} />
      </div>
    </>
  );
}
