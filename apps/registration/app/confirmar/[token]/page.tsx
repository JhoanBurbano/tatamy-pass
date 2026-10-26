import Link from 'next/link';
import { getRepos } from '@/lib/db';
import { confirmOffer } from '@/lib/waitlist';

export const dynamic = 'force-dynamic';

/** Enlace del correo de lista de espera: confirma el cupo (válido 48 h). */
export default async function ConfirmarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const repos = await getRepos();
  const res = await confirmOffer({ repos }, token);
  return (
    <div className="card belt" style={{ maxWidth: 560, margin: '20px auto' }}>
      {res.ok ? (
        <>
          <h1 className="title">Cupo confirmado</h1>
          <p className="subtitle">Listo, {res.registration.firstName}. Tu inscripción pasa a revisión del coordinador; te avisamos por correo cuando esté aprobada.</p>
          <Link className="btn primary" href={`/estado/${res.registration.code}`} style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}>Ver estado · {res.registration.code}</Link>
        </>
      ) : (
        <>
          <h1 className="title">{res.reason === 'EXPIRED' ? 'Este enlace venció' : 'Este enlace no sirve'}</h1>
          <p className="subtitle">{res.message}</p>
          <Link className="btn secondary" href="/" style={{ display: 'inline-block', marginTop: 16, textDecoration: 'none' }}>Ir al formulario</Link>
        </>
      )}
    </div>
  );
}
