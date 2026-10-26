import { remainingCapacity } from '@tatami/core';
import { requireUser } from '@/lib/auth/guard';
import { eventConfig } from '@/lib/config';
import { getRepos } from '@/lib/db';
import { saveCapacitiesAction } from '../actions';
import { Flash, PageHead, type Search } from '../ui';

export const dynamic = 'force-dynamic';

function Bar({ used, cap }: { used: number; cap: number | null }) {
  if (cap === null) return <div className="small muted">sin límite</div>;
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 100;
  return <div className={`capacity-bar ${used >= cap ? 'full' : ''}`} title={`${used} de ${cap}`}><i style={{ width: `${pct}%` }} /></div>;
}

function Remaining({ used, cap }: { used: number; cap: number | null }) {
  const rem = remainingCapacity(cap, used);
  if (rem === Infinity) return <span className="badge muted">sin límite</span>;
  if (rem <= 0) return <span className="badge bad">cupo lleno</span>;
  if (rem <= Math.max(3, Math.round((cap ?? 0) * 0.1))) return <span className="badge warn">quedan {rem}</span>;
  return <span className="badge ok">quedan {rem}</span>;
}

/** Uso de cupos por rol, categoría, acompañantes y aforo. Admin/coord editan; inscriptores solo ven. */
export default async function CuposPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const repos = await getRepos();
  const { config } = await eventConfig(repos);
  const manage = user.role !== 'club';
  const [used, usedCat, usedCompanions, usedTotal, waitlist] = await Promise.all([
    repos.registrations.countByRole(), repos.registrations.countByCategory(), repos.registrations.countCompanions(), repos.registrations.countActive(), repos.registrations.waitlist()
  ]);
  const waitByRole = new Map<string, number>();
  for (const w of waitlist) waitByRole.set(w.roleCode, (waitByRole.get(w.roleCode) ?? 0) + 1);
  const totalRem = remainingCapacity(config.totalCapacity, usedTotal);

  const content = (
    <>
      <div className="kpis">
        <div className="kpi"><div className="v">{usedTotal}</div><div className="l">Personas con cupo (incluye acompañantes)</div></div>
        <div className="kpi"><div className="v">{config.totalCapacity === null ? '∞' : config.totalCapacity}</div><div className="l">Aforo total</div></div>
        <div className="kpi"><div className="v">{totalRem === Infinity ? '∞' : totalRem}</div><div className="l">Lugares libres</div></div>
        <div className="kpi"><div className="v">{usedCompanions}</div><div className="l">Acompañantes</div></div>
        <div className="kpi"><div className="v">{waitlist.length}</div><div className="l">En lista de espera</div></div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 18 }}>Por tipo de inscripción</h2>
        <p className="small muted">Cuentan las inscripciones pendientes, con cupo ofrecido y aprobadas. Rechazadas y en espera no ocupan cupo.</p>
        <table>
          <thead><tr><th>Rol</th><th>Usados</th><th style={{ width: '28%' }}></th><th>Libres</th><th>En espera</th>{manage && <><th>Cupo</th><th>Sin límite</th></>}</tr></thead>
          <tbody>
            {config.roles.filter((r) => r.code !== 'ACOMP').map((r) => {
              const u = used[r.code] ?? 0;
              return (
                <tr key={r.code}>
                  <td><strong>{r.name}</strong><div className="small muted">{r.code} · zonas {r.zones.join(', ')}</div></td>
                  <td>{u}</td>
                  <td><Bar used={u} cap={r.capacity} /></td>
                  <td><Remaining used={u} cap={r.capacity} /></td>
                  <td>{waitByRole.get(r.code) ?? '—'}</td>
                  {manage && (
                    <>
                      <td><input className="input sm" type="number" min={0} name={`role.${r.code}.capacity`} defaultValue={r.capacity ?? ''} style={{ width: 110 }} aria-label={`Cupo ${r.name}`} /></td>
                      <td><input type="checkbox" name={`role.${r.code}.unlimited`} defaultChecked={r.capacity === null} aria-label={`Sin límite ${r.name}`} /></td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 18 }}>Por categoría (competidores)</h2>
        <table>
          <thead><tr><th>Categoría</th><th>Edades</th><th>Usados</th><th style={{ width: '28%' }}></th><th>Libres</th>{manage && <><th>Cupo</th><th>Sin límite</th></>}</tr></thead>
          <tbody>
            {config.ageCategories.map((c) => {
              const u = usedCat[c.code] ?? 0;
              return (
                <tr key={c.code}>
                  <td><strong>{c.name}</strong><div className="small muted">{c.code}</div></td>
                  <td>{c.minAge}{c.maxAge === null ? ' en adelante' : `–${c.maxAge}`}</td>
                  <td>{u}</td>
                  <td><Bar used={u} cap={c.capacity} /></td>
                  <td><Remaining used={u} cap={c.capacity} /></td>
                  {manage && (
                    <>
                      <td><input className="input sm" type="number" min={0} name={`cat.${c.code}.capacity`} defaultValue={c.capacity ?? ''} style={{ width: 110 }} aria-label={`Cupo ${c.name}`} /></td>
                      <td><input type="checkbox" name={`cat.${c.code}.unlimited`} defaultChecked={c.capacity === null} aria-label={`Sin límite ${c.name}`} /></td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 18 }}>Acompañantes y aforo total</h2>
        <table>
          <thead><tr><th>Límite</th><th>Usados</th><th style={{ width: '28%' }}></th><th>Libres</th>{manage && <><th>Valor</th><th>Sin límite</th></>}</tr></thead>
          <tbody>
            <tr>
              <td><strong>Acompañantes por participante</strong><div className="small muted">Entran a gradería con credencial digital</div></td>
              <td colSpan={3} className="small muted">{config.companions.perParticipant === null ? 'sin límite' : `máximo ${config.companions.perParticipant} por persona`}</td>
              {manage && <><td><input className="input sm" type="number" min={0} name="companions.perParticipant" defaultValue={config.companions.perParticipant ?? ''} style={{ width: 110 }} /></td><td><input type="checkbox" name="companions.perUnlimited" defaultChecked={config.companions.perParticipant === null} /></td></>}
            </tr>
            <tr>
              <td><strong>Total de acompañantes del evento</strong></td>
              <td>{usedCompanions}</td><td><Bar used={usedCompanions} cap={config.companions.total} /></td><td><Remaining used={usedCompanions} cap={config.companions.total} /></td>
              {manage && <><td><input className="input sm" type="number" min={0} name="companions.total" defaultValue={config.companions.total ?? ''} style={{ width: 110 }} /></td><td><input type="checkbox" name="companions.totalUnlimited" defaultChecked={config.companions.total === null} /></td></>}
            </tr>
            <tr>
              <td><strong>Aforo total</strong><div className="small muted">Personas con credencial (todas, incluidos acompañantes)</div></td>
              <td>{usedTotal}</td><td><Bar used={usedTotal} cap={config.totalCapacity} /></td><td><Remaining used={usedTotal} cap={config.totalCapacity} /></td>
              {manage && <><td><input className="input sm" type="number" min={0} name="totalCapacity" defaultValue={config.totalCapacity ?? ''} style={{ width: 110 }} /></td><td><input type="checkbox" name="totalUnlimited" defaultChecked={config.totalCapacity === null} /></td></>}
            </tr>
          </tbody>
        </table>
      </div>
      {manage && <div><button className="btn primary" type="submit">Guardar cupos</button> <span className="small muted" style={{ marginLeft: 10 }}>Bajar un cupo por debajo de lo usado no anula a nadie: solo bloquea nuevas inscripciones.</span></div>}
    </>
  );

  return (
    <>
      <PageHead title="Cupos" subtitle={manage ? 'Uso real frente a los límites. Deja el cupo vacío o marca “sin límite” para no limitar.' : 'Cupos del evento y cuántos lugares quedan.'} />
      <Flash sp={sp} />
      {manage ? <form action={saveCapacitiesAction} className="stack">{content}</form> : <div className="stack">{content}</div>}
    </>
  );
}
