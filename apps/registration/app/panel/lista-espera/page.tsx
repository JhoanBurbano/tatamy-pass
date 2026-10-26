import Link from 'next/link';
import { remainingCapacity } from '@tatami/core';
import { requireUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { sendMail } from '@/lib/mail';
import { expireOffers } from '@/lib/waitlist';
import { promoteWaitlistAction, releaseSlotAction } from '../actions';
import { Empty, Flash, fmt, fullName, PageHead, StatusBadge, type Search } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ListaEsperaPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser(['admin', 'coord']);
  const sp = await searchParams;
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  // Al abrir la página vencen las ofertas caducadas (el cron es opcional).
  const swept = await expireOffers({ repos, config, sendMail });
  const rows = await repos.registrations.waitlist();
  const used = await repos.registrations.countByRole();
  const usedCat = await repos.registrations.countByCategory();

  // Agrupar por rol → categoría
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.roleCode}|${r.roleCode === 'COMP' ? r.categoryCode ?? '' : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return (
    <>
      <PageHead title="Lista de espera" subtitle="Por orden de llegada. Liberar un cupo envía un correo al primero con un enlace válido 48 horas; si no confirma, pasa al siguiente." />
      <Flash sp={sp} />
      {swept.expired.length > 0 && <div className="notice warn" style={{ marginTop: 0, marginBottom: 16 }}>{swept.expired.length} oferta(s) vencieron y el cupo pasó a {swept.offered.length} persona(s).</div>}
      {rows.length === 0 ? <Empty title="Nadie en lista de espera" /> : (
        <div className="stack">
          {[...groups.entries()].map(([key, list]) => {
            const [roleCode, categoryCode] = key.split('|');
            const role = config.roles.find((r) => r.code === roleCode);
            const cat = config.ageCategories.find((c) => c.code === categoryCode);
            const remRole = remainingCapacity(role?.capacity ?? null, used[roleCode] ?? 0);
            const remCat = cat ? remainingCapacity(cat.capacity, usedCat[cat.code] ?? 0) : Infinity;
            const rem = Math.min(remRole, remCat);
            return (
              <div className="card" key={key}>
                <div className="row between">
                  <div>
                    <h2 style={{ fontSize: 18 }}>{role?.name ?? roleCode}{cat ? ` · ${cat.name}` : ''}</h2>
                    <div className="small muted">{list.length} en espera · cupos libres ahora: {rem === Infinity ? 'sin límite' : rem}</div>
                  </div>
                  <form action={releaseSlotAction}>
                    <input type="hidden" name="roleCode" value={roleCode} /><input type="hidden" name="categoryCode" value={categoryCode} />
                    <button className="btn primary sm" type="submit">Liberar un cupo → avisar al primero</button>
                  </form>
                </div>
                {rem <= 0 && <div className="notice info small">No hay cupo libre según la configuración: si liberas igual, la persona ofrecida contará por encima del cupo. Sube el cupo en Evento o rechaza otra inscripción primero.</div>}
                <table>
                  <thead><tr><th>#</th><th>Persona</th><th>Club</th><th>Correo</th><th>Estado</th><th>En espera desde</th><th></th></tr></thead>
                  <tbody>
                    {list.map((r, i) => (
                      <tr key={r.id}>
                        <td>{i + 1}</td>
                        <td><Link href={`/panel/inscripciones/${r.id}`}>{fullName(r)}</Link></td>
                        <td>{r.club ?? '—'}</td>
                        <td>{r.email ?? <span className="badge warn">sin correo</span>}</td>
                        <td><StatusBadge status={r.status} />{r.status === 'OFFERED' && <div className="small muted">vence {fmt(r.offerExpiresAt)}</div>}</td>
                        <td className="small muted">{fmt(r.createdAt)}</td>
                        <td><form action={promoteWaitlistAction}><input type="hidden" name="id" value={r.id} /><button className="btn ghost sm" type="submit" title="Sin esperar confirmación por correo">Pasar a pendiente</button></form></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
