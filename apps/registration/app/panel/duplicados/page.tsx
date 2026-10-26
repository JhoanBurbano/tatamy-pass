import Link from 'next/link';
import { requireUser } from '@/lib/auth/guard';
import { getRepos } from '@/lib/db';
import type { Registration } from '@/lib/repo/types';
import { markDistinctAction, mergeAction } from '../actions';
import { Avatar, Empty, Flash, fmt, fullName, PageHead, StatusBadge, type Search } from '../ui';

export const dynamic = 'force-dynamic';

function Side({ r, companions }: { r: Registration; companions: number }) {
  return (
    <dl className="side-by">
      <div className="row"><Avatar r={r} /><div><Link href={`/panel/inscripciones/${r.id}`}>{fullName(r)}</Link><div className="small muted mono">{r.code}</div></div></div>
      <dt>Estado</dt><dd><StatusBadge status={r.status} /></dd>
      <dt>Nacimiento · documento</dt><dd>{r.birthDate || '—'} · {r.documentNumber ?? '—'}</dd>
      <dt>Club · rol</dt><dd>{r.club ?? '—'} · {r.roleCode}{r.categoryCode ? ` (${r.categoryCode})` : ''}</dd>
      <dt>Correo</dt><dd>{r.email ?? '—'}</dd>
      <dt>Origen · acompañantes</dt><dd>{r.source} · {companions}</dd>
      <dt>Recibida</dt><dd>{fmt(r.createdAt)}</dd>
    </dl>
  );
}

export default async function DuplicadosPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser(['admin', 'coord']);
  const sp = await searchParams;
  const repos = await getRepos();
  const pairs = await repos.registrations.duplicateCandidates();
  const counts = new Map<string, number>();
  for (const p of pairs) for (const r of [p.a, p.b]) if (!counts.has(r.id)) counts.set(r.id, (await repos.registrations.companionsOf(r.id)).length);

  return (
    <>
      <PageHead title="Posibles duplicados" subtitle="Misma persona inscrita dos veces: por documento, o por nombre y fecha de nacimiento con el club escrito distinto. Fusionar conserva la primera y completa sus datos con la segunda." />
      <Flash sp={sp} />
      {pairs.length === 0 ? <Empty title="Sin duplicados pendientes">Ojalá siga así.</Empty> : (
        <div className="stack">
          {pairs.map(({ a, b, reason }) => (
            <div className="card" key={`${a.id}|${b.id}`}>
              <div className="row between">
                <span className={`badge ${reason === 'document' ? 'bad' : 'warn'}`}>{reason === 'document' ? `Mismo documento ${a.documentNumber}` : 'Mismo nombre y fecha de nacimiento'}</span>
                <div className="row">
                  <form action={mergeAction}><input type="hidden" name="into" value={a.id} /><input type="hidden" name="from" value={b.id} /><button className="btn primary sm" type="submit">Fusionar (conservar la primera)</button></form>
                  <form action={mergeAction}><input type="hidden" name="into" value={b.id} /><input type="hidden" name="from" value={a.id} /><button className="btn secondary sm" type="submit">Conservar la segunda</button></form>
                  <form action={markDistinctAction}><input type="hidden" name="a" value={a.id} /><input type="hidden" name="b" value={b.id} /><button className="btn ghost sm" type="submit">Son personas distintas</button></form>
                </div>
              </div>
              <div className="pair" style={{ marginTop: 12 }}>
                <Side r={a} companions={counts.get(a.id) ?? 0} />
                <Side r={b} companions={counts.get(b.id) ?? 0} />
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
