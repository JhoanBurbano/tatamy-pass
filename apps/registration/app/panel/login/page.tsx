import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/guard';
import { getRepos } from '@/lib/db';
import { LoginForm } from './form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect('/panel/inscripciones');
  const { next } = await searchParams;
  const repos = await getRepos();
  const noUsers = (await repos.users.count()) === 0;
  return (
    <div className="login-wrap">
      <div className="card belt">
        <div className="eyebrow">Panel de coordinación</div>
        <h1 className="title" style={{ marginTop: 6 }}>Entrar</h1>
        <p className="subtitle">Con el correo y la contraseña que te dio el coordinador.</p>
        {noUsers && (
          <div className="notice warn">
            Todavía no hay usuarios. Define <code>ADMIN_EMAIL</code> y <code>ADMIN_PASSWORD</code> en el entorno y reinicia (o corre <code>npm run migrate</code>): se crea el primer administrador.
          </div>
        )}
        <LoginForm next={next ?? ''} />
      </div>
    </div>
  );
}
