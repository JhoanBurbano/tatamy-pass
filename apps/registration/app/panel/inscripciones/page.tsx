import Link from 'next/link';
import { requireUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import type { RegistrationStatus } from '@/lib/repo/types';
import { approveAction, approveAllValidatedAction, rejectAction } from '../actions';
import { Avatar, Empty, Flash, fmt, fullName, PageHead, q, StatusBadge, type Search } from '../ui';

export const dynamic = 'force-dynamic';

const STATUSES: RegistrationStatus[] = ['PENDING', 'WAITLIST', 'OFFERED', 'APPROVED', 'REJECTED', 'EXPIRED'];
const STATUS_NAMES: Record<RegistrationStatus, string> = { PENDING: 'Validadas (pendientes)', WAITLIST: 'Lista de espera', OFFERED: 'Cupo ofrecido', APPROVED: 'Aprobadas', REJECTED: 'Rechazadas', EXPIRED: 'Oferta vencida' };

export default async function InscripcionesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const manage = user.role !== 'club';
  const filters = {
    status: (q(sp, 'status') || (manage ? 'PENDING' : 'ALL')) as RegistrationStatus | 'ALL',
    roleCode: q(sp, 'role') || undefined, categoryCode: q(sp, 'category') || undefined, club: manage ? q(sp, 'club') || undefined : undefined,
    search: q(sp, 'q') || undefined, delegationId: manage ? undefined : user.delegationId
  };
  if (!manage && !user.delegationId) {
    return <><PageHead title="Inscripciones" /><Empty title="Tu usuario no tiene club asignado">Pide al coordinador que te asocie a tu club o academia.</Empty></>;
  }
  const rows = await repos.registrations.list({ ...filters, limit: 500 });
  const clubs = manage ? (await repos.registrations.countBy('club')).map((c) => c.key).filter(Boolean) : [];
  const roleName = (code: string) => config.roles.find((r) => r.code === code)?.name ?? code;
  const catName = (code?: string) => config.ageCategories.find((c) => c.code === code)?.name ?? code ?? '—';
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === 'string' && v && !['ok', 'error'].includes(k)) as [string, string][]).toString();
  const returnTo = `/panel/inscripciones${qs ? `?${qs}` : ''}`;

  return (
    <>
      <PageHead title="Inscripciones" subtitle={manage ? 'Revisa, aprueba o rechaza. Los acompañantes siguen el estado del participante.' : 'Las inscripciones de tu club y su estado. Puedes corregir datos hasta el cierre.'}>
        {!manage && <><Link className="btn primary sm" href="/" target="_blank" rel="noopener">Inscribir a alguien ↗</Link><Link className="btn ghost sm" href="/panel/cupos">Ver cupos</Link></>}
        {manage && filters.status === 'PENDING' && rows.length > 0 && (
          <form action={approveAllValidatedAction}>
            <input type="hidden" name="roleCode" value={filters.roleCode ?? ''} /><input type="hidden" name="categoryCode" value={filters.categoryCode ?? ''} /><input type="hidden" name="club" value={filters.club ?? ''} />
            <button className="btn primary sm" type="submit">Aprobar todas las validadas ({rows.length})</button>
          </form>
        )}
      </PageHead>
      <Flash sp={sp} />
      <form className="filters card" method="get" style={{ padding: 16 }}>
        <label><span className="label">Estado</span>
          <select className="input sm" name="status" defaultValue={filters.status}>
            <option value="ALL">Todas</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_NAMES[s]}</option>)}
          </select>
        </label>
        <label><span className="label">Rol</span>
          <select className="input sm" name="role" defaultValue={filters.roleCode ?? ''}><option value="">Todos</option>{config.roles.filter((r) => r.code !== 'ACOMP').map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
        </label>
        <label><span className="label">Categoría</span>
          <select className="input sm" name="category" defaultValue={filters.categoryCode ?? ''}><option value="">Todas</option>{config.ageCategories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
        </label>
        {manage && (
          <label><span className="label">Club</span>
            <select className="input sm" name="club" defaultValue={filters.club ?? ''}><option value="">Todos</option>{clubs.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
        )}
        <label><span className="label">Buscar</span><input className="input sm" name="q" defaultValue={filters.search ?? ''} placeholder="Nombre, documento o código" /></label>
        <button className="btn secondary sm" type="submit">Filtrar</button>
      </form>

      {rows.length === 0 ? (
        <Empty title={filters.search ? `No encontré a nadie con "${filters.search}"` : 'Todavía no hay inscripciones aquí'}>{filters.search ? 'Prueba con el apellido o el código.' : 'Comparte el enlace del formulario con los clubes o cambia los filtros.'}</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th></th><th>Persona</th><th>Rol · categoría</th><th>Club</th><th>Acomp.</th><th>Estado</th><th>Recibida</th>{manage && <th>Acciones</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Avatar r={r} /></td>
                  <td><Link href={`/panel/inscripciones/${r.id}`}>{fullName(r)}</Link><div className="small muted mono">{r.code}{r.documentNumber ? ` · ${r.documentNumber}` : ''}</div></td>
                  <td>{roleName(r.roleCode)}<div className="small muted">{r.roleCode === 'COMP' ? catName(r.categoryCode) : ''}</div></td>
                  <td>{r.club ?? '—'}</td>
                  <td><CompanionCount id={r.id} /></td>
                  <td><StatusBadge status={r.status} />{r.status === 'REJECTED' && r.rejectionReason && <div className="small muted">{r.rejectionReason}</div>}</td>
                  <td className="small muted">{fmt(r.createdAt)}</td>
                  {manage && (
                    <td>
                      {r.status !== 'APPROVED' && r.status !== 'WAITLIST' && (
                        <form action={approveAction} className="inline-form"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} /><button className="btn primary sm" type="submit">Aprobar</button></form>
                      )}
                      {r.status !== 'REJECTED' && (
                        <details className="rej"><summary>Rechazar</summary>
                          <form action={rejectAction} className="inline-form" style={{ marginTop: 6 }}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} />
                            <input className="input sm" name="reason" placeholder="Motivo (lo ve la persona)" required style={{ width: 200 }} /><button className="btn danger sm" type="submit">Rechazar</button>
                          </form>
                        </details>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length >= 500 && <p className="small muted" style={{ marginTop: 8 }}>Se muestran las primeras 500. Usa los filtros para acotar.</p>}
    </>
  );
}

async function CompanionCount({ id }: { id: string }) {
  const repos = await getRepos();
  const n = (await repos.registrations.companionsOf(id)).length;
  return <>{n || '—'}</>;
}
