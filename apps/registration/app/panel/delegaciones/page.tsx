import { requireUser } from '@/lib/auth/guard';
import { getRepos } from '@/lib/db';
import { createDelegationAction, deleteDelegationAction, deleteUserAction, inviteUserAction, resendInviteAction } from '../actions';
import { Flash, fmt, PageHead, type Search } from '../ui';

export const dynamic = 'force-dynamic';

const ROLE_LABEL = { admin: 'Administrador', coord: 'Coordinador', club: 'Inscriptor' } as const;

export default async function DelegacionesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser(['admin', 'coord']);
  const sp = await searchParams;
  const repos = await getRepos();
  const delegations = await repos.users.delegations();
  const users = await repos.users.all();
  const byClub = new Map((await repos.registrations.countBy('club')).map((c) => [c.key.toLowerCase(), c.n]));

  return (
    <>
      <PageHead title="Clubes e inscriptores" subtitle="Clubes y academias que inscriben. Crea el club y luego invita a su inscriptor por correo: solo verá y editará las inscripciones de su club, hasta el cierre." />
      <Flash sp={sp} />
      <div className="cards">
        <div className="card">
          <h2 style={{ fontSize: 18 }}>Nuevo club</h2>
          <form action={createDelegationAction} className="grid">
            <label><span className="label">Club / academia</span><input className="input" name="name" required placeholder="Academia Caucana de Taekwondo ITF" /></label>
            <label><span className="label">Ciudad (opcional)</span><input className="input" name="city" placeholder="Popayán" /></label>
            <div style={{ alignSelf: 'end' }}><button className="btn primary" type="submit">Crear</button></div>
          </form>
        </div>
        <div className="card">
          <h2 style={{ fontSize: 18 }}>Invitar inscriptor o coordinador</h2>
          <form action={inviteUserAction} className="grid">
            <label><span className="label">Correo</span><input className="input" name="email" type="email" required /></label>
            <label><span className="label">Nombre</span><input className="input" name="name" /></label>
            <label><span className="label">Rol</span>
              <select className="input" name="role" defaultValue="club">
                <option value="club">Inscriptor (solo su delegación)</option>
                {me.role === 'admin' && <><option value="coord">Coordinador</option><option value="admin">Administrador</option></>}
              </select>
            </label>
            <label><span className="label">Club (para inscriptores)</span>
              <select className="input" name="delegationId" defaultValue=""><option value="">—</option>{delegations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            </label>
            <div style={{ alignSelf: 'end' }}><button className="btn primary" type="submit">Enviar invitación</button></div>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 18 }}>Clubes ({delegations.length})</h2>
        {delegations.length === 0 ? <p className="small muted" style={{ marginTop: 8 }}>Ninguno todavía. Las inscripciones con club escrito a mano siguen funcionando; crear el club permite invitar a su inscriptor.</p> : (
          <table>
            <thead><tr><th>Nombre</th><th>Ciudad</th><th>Inscripciones</th><th>Inscriptores</th><th></th></tr></thead>
            <tbody>
              {delegations.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.city ?? '—'}</td>
                  <td>{byClub.get(d.name.toLowerCase()) ?? 0}</td>
                  <td className="small">{users.filter((u) => u.delegationId === d.id).map((u) => u.email).join(', ') || '—'}</td>
                  <td>{me.role === 'admin' && <form action={deleteDelegationAction}><input type="hidden" name="id" value={d.id} /><button className="btn ghost sm" type="submit">Borrar</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 18 }}>Usuarios del panel ({users.length})</h2>
        <table>
          <thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Club</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => {
              const pendingInvite = !u.passwordHash;
              const expired = pendingInvite && (!u.inviteExpiresAt || new Date(u.inviteExpiresAt).getTime() < Date.now());
              return (
                <tr key={u.id}>
                  <td>{u.email}</td><td>{u.name}</td><td>{ROLE_LABEL[u.role]}</td>
                  <td>{delegations.find((d) => d.id === u.delegationId)?.name ?? '—'}</td>
                  <td>{pendingInvite ? <span className={`badge ${expired ? 'bad' : 'warn'}`}>{expired ? 'Invitación vencida' : 'Invitación pendiente'}</span> : <span className="badge ok">Activo</span>}</td>
                  <td className="small muted">{fmt(u.lastLoginAt)}</td>
                  <td>
                    <div className="row">
                      <form action={resendInviteAction}><input type="hidden" name="id" value={u.id} /><button className="btn secondary sm" type="submit">{pendingInvite ? 'Reenviar invitación' : 'Enviar enlace de contraseña'}</button></form>
                      {me.role === 'admin' && u.id !== me.id && <form action={deleteUserAction}><input type="hidden" name="id" value={u.id} /><button className="btn ghost sm" type="submit">Borrar</button></form>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
