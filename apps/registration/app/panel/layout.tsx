import type { ReactNode } from 'react';
import { currentUser } from '@/lib/auth/guard';
import { getRepos } from '@/lib/db';
import { logoutAction } from './actions';
import { NavLinks } from './nav';

export const dynamic = 'force-dynamic';

const ROLE_LABEL = { admin: 'Administrador', coord: 'Coordinador', club: 'Inscriptor' } as const;

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) return <div className="main">{children}</div>;
  const repos = await getRepos();
  const [pending, waitlist, dups] = user.role === 'club'
    ? [0, 0, 0]
    : [(await repos.registrations.list({ status: 'PENDING', limit: 5000 })).length, (await repos.registrations.waitlist()).length, (await repos.registrations.duplicateCandidates()).length];
  const delegation = user.delegationId ? await repos.users.delegationById(user.delegationId) : undefined;
  return (
    <div className="panel">
      <aside className="side">
        <div className="who">
          <strong>{user.name || user.email}</strong>
          <span className="small muted">{ROLE_LABEL[user.role]}{delegation ? ` · ${delegation.name}` : ''}</span>
        </div>
        <NavLinks role={user.role} counts={{ pending, waitlist, dups }} />
        <div className="logout">
          <form action={logoutAction}><button className="btn ghost sm block" type="submit">Cerrar sesión</button></form>
        </div>
      </aside>
      <div className="panel-main">{children}</div>
    </div>
  );
}
