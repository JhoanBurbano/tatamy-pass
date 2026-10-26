import { getRepos } from '@/lib/db';
import { ActivateForm } from './form';

export const dynamic = 'force-dynamic';

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const repos = await getRepos();
  const user = await repos.users.byInviteToken(token);
  const valid = user && user.inviteExpiresAt && new Date(user.inviteExpiresAt).getTime() > Date.now();
  return (
    <div className="login-wrap">
      <div className="card belt">
        <div className="eyebrow">Panel de coordinación</div>
        <h1 className="title" style={{ marginTop: 6 }}>Activa tu acceso</h1>
        {!valid ? (
          <div className="notice bad" style={{ marginTop: 16 }}>Esta invitación no es válida o ya venció. Pide una nueva al coordinador.</div>
        ) : (
          <>
            <p className="subtitle">Hola, {user!.name}. Crea la contraseña para <strong>{user!.email}</strong>.</p>
            <ActivateForm token={token} />
          </>
        )}
      </div>
    </div>
  );
}
