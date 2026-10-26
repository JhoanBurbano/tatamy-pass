import { getRepos } from '@/lib/db';
import { DigitalCredential } from './view';

export const dynamic = 'force-dynamic';

/** Página pública (con token opaco) de la credencial digital: estado y QR rotativo. */
export default async function CredencialPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const repos = await getRepos();
  const r = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await repos.registrations.byCredentialToken(token) : undefined;
  if (!r) {
    return (
      <div className="card belt" style={{ maxWidth: 520, margin: '20px auto' }}>
        <h1 className="title">Este enlace no es válido</h1>
        <p className="subtitle">Abre el enlace completo que llegó en el correo de aprobación. Si lo perdiste, escribe al coordinador con tu nombre y club.</p>
      </div>
    );
  }
  return <DigitalCredential token={token} />;
}
