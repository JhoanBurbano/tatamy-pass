import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function go(fd: FormData) {
  'use server';
  const code = String(fd.get('code') ?? '').trim().toUpperCase();
  redirect(code ? `/estado/${encodeURIComponent(code)}` : '/estado');
}

export default function EstadoPage() {
  return (
    <div className="card belt" style={{ maxWidth: 520, margin: '20px auto' }}>
      <div className="eyebrow">Inscripción</div>
      <h1 className="title" style={{ marginTop: 6 }}>Consulta el estado</h1>
      <p className="subtitle">Escribe el código que recibiste al inscribirte (también va en el correo). Tiene la forma N26-XXXXXX.</p>
      <form action={go} className="stack" style={{ marginTop: 16 }}>
        <label><span className="label">Código de inscripción</span><input className="input mono" name="code" placeholder="N26-ABC234" autoCapitalize="characters" required style={{ fontSize: 20, letterSpacing: '.06em' }} /></label>
        <button className="btn primary" type="submit">Ver estado</button>
      </form>
    </div>
  );
}
